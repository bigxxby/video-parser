const puppeteer = require('puppeteer')
const { launch, getStream } = require('puppeteer-stream')
const { execSync } = require('child_process')
const fs = require('fs')

const URL =
  'https://nolimitcity.com/replay/zohugahaponiraheyakumuhasiohopatasipahipetoudayo'
const GAME_ID = 'GatorHunters'
const VIEWPORT_WIDTH = 390
const VIEWPORT_HEIGHT = 844
const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const MAX_RECORD_DURATION = 120_000
const OUTPUT_FILE = 'replay_recording_new.mp4'
const CLICK_X = 200
const CLICK_Y = 660
const START_VOLUME_BTN_X = 30
const START_VOLUME_BTN_Y = 660
const WAIT_TIME_FOR_LOADING_AUDIO = 15_000

const CLEANUP_SCRIPT = `
    const keep = new Set();
    document.querySelectorAll('canvas, iframe').forEach(el => {
        while (el) {
            keep.add(el);
            el = el.parentElement;
        }
    });
    document.body.querySelectorAll('*').forEach(el => {
        if (!keep.has(el) && el.tagName !== 'CANVAS' && el.tagName !== 'IFRAME') {
            el.remove();
        }
    });
`

const DEBUG_LOCALSTORAGE = `
  const originalSetItem = localStorage.setItem.bind(localStorage);
  const forceValues = {
    'masterSoundEnabled': 'true',
    'mute': 'true'
  };
  localStorage.setItem = function(key, value) {
    const suffix = key.split('.').pop();
    if (suffix in forceValues) {
      console.log('[localStorage] BLOCKED:', key, '=', value, '→ forcing', forceValues[suffix]);
      return originalSetItem(key, forceValues[suffix]);
    }
    return originalSetItem(key, value);
  };
`

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Scan settings
const SCAN_STEP = 20
const SCAN_DELAY = 0

// Exclude zones from scanning: [{x, y, width, height}, ...]
const IN_GAME_EXCLUDE_ZONES = [
  { x: 2, y: 695, width: 50, height: 50 }, // volume button
  { x: 202, y: 695, width: 50, height: 50 } // lightning button
]

async function paintExcludeZones(page, zones = IN_GAME_EXCLUDE_ZONES) {
  await page.evaluate(zones => {
    zones.forEach((zone, i) => {
      const div = document.createElement('div')
      div.id = `exclude-zone-${i}`
      div.style.cssText = `
        position: fixed;
        left: ${zone.x}px;
        top: ${zone.y}px;
        width: ${zone.width}px;
        height: ${zone.height}px;
        background: rgba(255, 0, 0, 0.3);
        border: 2px solid red;
        z-index: 99999;
        pointer-events: none;
      `
      document.body.appendChild(div)
    })
  }, zones)
}

async function removeExcludeZones(page) {
  await page.evaluate(() => {
    document
      .querySelectorAll('[id^="exclude-zone-"]')
      .forEach(el => el.remove())
  })
}

async function drawCircle(page, x, y, radius = 10, color = 'red') {
  await page.evaluate(
    ({ x, y, radius, color }) => {
      const div = document.createElement('div')
      div.className = 'debug-circle'
      div.style.cssText = `
        position: fixed;
        left: ${x - radius}px;
        top: ${y - radius}px;
        width: ${radius * 2}px;
        height: ${radius * 2}px;
        background: ${color};
        border-radius: 50%;
        z-index: 99999;
        pointer-events: none;
        opacity: 0.7;
      `
      document.body.appendChild(div)
    },
    { x, y, radius, color }
  )
}

async function isReplayOver(page) {
  return await page.evaluate(() => {
    const h2 = document.querySelector('h2')
    return h2 && h2.textContent.includes('Replay over')
  })
}

async function hasAppError(page) {
  return await page.evaluate(() => {
    const h2 = document.querySelector('h2')
    return h2 && h2.textContent.includes('Application error')
  })
}

async function waitForPageReady(page, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    await page.goto(URL, { waitUntil: 'domcontentloaded' })
    await sleep(1000)

    if (await hasAppError(page)) {
      console.log(
        `    Application error detected, retrying... (${attempt}/${maxRetries})`
      )
      await page.reload()
      await sleep(1000)
    } else {
      return true
    }
  }
  throw new Error('Failed to load page after max retries')
}

function isInExcludeZone(x, y, zones) {
  for (const zone of zones) {
    if (
      x >= zone.x &&
      x < zone.x + zone.width &&
      y >= zone.y &&
      y < zone.y + zone.height
    ) {
      return true
    }
  }
  return false
}

async function getCursor(page) {
  for (const frame of page.frames()) {
    try {
      const cursor = await frame.evaluate(() => {
        const canvas = document.querySelector('canvas')
        return canvas ? getComputedStyle(canvas).cursor : null
      })
      if (cursor) return cursor
    } catch (e) {}
  }
  return null
}

async function scanAndClick(page, options = {}) {
  const {
    width = VIEWPORT_WIDTH,
    height = VIEWPORT_HEIGHT,
    step = SCAN_STEP,
    delay = SCAN_DELAY,
    excludeZones = IN_GAME_EXCLUDE_ZONES
  } = options

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (isInExcludeZone(x, y, excludeZones)) continue

      await page.mouse.move(x, y)
      await sleep(delay)

      const cursor = await getCursor(page)
      if (cursor === 'pointer') {
        await page.mouse.click(x, y)
        return { x, y, clicked: true }
      }
    }
  }

  return { clicked: false }
}

async function clickUnmuteIfMuted(page) {
  // Check if mute is already set in localStorage
  const muteKey = `FANPAGE.${GAME_ID}.mute`
  const muteValue = await page.evaluate(
    key => localStorage.getItem(key),
    muteKey
  )
  console.log(`    localStorage ${muteKey} = ${muteValue}`)

  // contrintuitive but thats how working theirs API
  if (muteValue === 'false') {
    console.log(
      `    Clicking volume button at (${START_VOLUME_BTN_X}, ${START_VOLUME_BTN_Y}) to unmute...`
    )
    await page.mouse.click(START_VOLUME_BTN_X, START_VOLUME_BTN_Y)
    // await drawCircle(page, START_VOLUME_BTN_X, START_VOLUME_BTN_Y)
    await sleep(WAIT_TIME_FOR_LOADING_AUDIO)
  } else {
    console.log('    Already unmuted, skipping volume click')
  }
}

async function waitForClickableAndClick(page, x, y, timeout = 30000) {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    await page.mouse.move(x, y)

    let cursor = null
    for (const frame of page.frames()) {
      try {
        cursor = await frame.evaluate(() => {
          const canvas = document.querySelector('canvas')
          return canvas ? getComputedStyle(canvas).cursor : null
        })
        if (cursor) break
      } catch (e) {}
    }

    if (cursor === 'pointer') {
      console.log(`    Cursor is pointer, clicking...`)
      await page.mouse.click(x, y)
      return true
    }

    await sleep(100)
  }

  console.log(`    Timeout waiting for pointer cursor`)
  return false
}

async function main() {
  console.log('[1/7] Launching browser...')
  const browser = await launch({
    headless: 'new',
    channel: 'chrome',
    userDataDir: './browser_data',
    defaultViewport: {
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true
    },
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--allowlisted-extension-id=jjndjgheafjngoipoacpjgeicjeomjli'
    ]
  })
  console.log('[1/7] Browser launched')

  console.log('[2/7] Creating page...')
  const page = await browser.newPage()
  await page.setUserAgent(USER_AGENT)
  await page.evaluateOnNewDocument(DEBUG_LOCALSTORAGE)
  page.on('console', msg => console.log('[browser]', msg.text()))
  console.log('[2/7] Page created')

  console.log(`[3/7] Opening: ${URL}`)
  await waitForPageReady(page)
  console.log('[3/7] Page ready')
  await sleep(1000)

  console.log('[4/7] Running cleanup...')
  await page.evaluate(CLEANUP_SCRIPT)
  // await paintExcludeZones(page)
  console.log('[4/7] Cleanup done - check exclude zones (red rectangles)')

  // Check if clicked on unmute
  await clickUnmuteIfMuted(page)

  console.log('[6/7] Starting synced recording (video + audio)...')

  // Use puppeteer-stream for BOTH video and audio - they're synced
  const stream = await getStream(page, { audio: true, video: true })
  const recordFile = fs.createWriteStream('temp_recording.webm')
  stream.pipe(recordFile)
  console.log('    Recording started')

  console.log('[5/7] Waiting for first click...')
  await waitForClickableAndClick(page, CLICK_X, CLICK_Y)
  await sleep(1000)
  console.log('[5/7] Clicked')

  await sleep(3000)
  // await removeExcludeZones(page)

  // // Remove replay indicator
  // for (const frame of page.frames()) {
  //   try {
  //     await frame.evaluate(`
  //       document.querySelectorAll('div.replay').forEach(el => {
  //         if (el.textContent.trim() === 'R') el.remove();
  //       });
  //     `)
  //   } catch (e) {}
  // }

  console.log('    Scanning and clicking buttons during playback...')
  const endTime = Date.now() + MAX_RECORD_DURATION
  let clickCount = 0

  while (Date.now() < endTime && !(await isReplayOver(page))) {
    const result = await scanAndClick(page)
    if (result.clicked) {
      console.log(`    Click #${++clickCount}: (${result.x}, ${result.y})`)
      // await sleep(1)
    }
  }

  console.log(`    Total clicks: ${clickCount}`)

  console.log('    Stopping recording...')

  // Gracefully end the stream
  await new Promise(resolve => {
    recordFile.on('finish', resolve)
    stream.end()
  })
  await sleep(500)
  console.log('[6/7] Recording complete')

  console.log('[7/7] Converting and scaling to viewport...')
  // Save original before processing
  fs.copyFileSync(
    'temp_recording.webm',
    OUTPUT_FILE.replace('.mp4', '_original.webm')
  )

  // Scale down from 3x capture to target viewport size
  execSync(
    `ffmpeg -y -i temp_recording.webm -vf "scale=${VIEWPORT_WIDTH}:${VIEWPORT_HEIGHT}" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart ${OUTPUT_FILE}`,
    { stdio: 'inherit' }
  )
  fs.unlinkSync('temp_recording.webm')
  console.log(`Recording saved to ${OUTPUT_FILE}`)

  await browser.close()
  console.log('Done!')
}

main().catch(console.error)
