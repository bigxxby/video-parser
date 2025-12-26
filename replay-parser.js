const { launch, getStream } = require('puppeteer-stream');
const { execSync } = require('child_process');
const fs = require('fs');

const VIEWPORT = {
    width: 1280,
    height: 1200
};

const MAX_RECORD_DURATION = 300_000; // 5 минут максимум

async function getCanvasBox(page) {
    return await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
}

async function realisticClick(page, x, y, description) {
    if (description) {
        console.log(`${description}: X=${x.toFixed(0)}, Y=${y.toFixed(0)}`);
    }
    await page.mouse.move(x, y, { steps: 25 });
    await delay(200);
    await page.mouse.down();
    await delay(300);
    await page.mouse.up();
    await delay(500);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getSoundState(page) {
    return await page.evaluate(() => ({
        on: window.BT_SoundTimerOn || 0,
        off: window.BT_SoundTimerOff || 0,
        soundOn: (window.BT_SoundTimerOn || 0) > (window.BT_SoundTimerOff || 0)
    }));
}

/**
 * Получает название слота из страницы
 */
async function getSlotName(page) {
    return await page.evaluate(() => {
        // Пробуем разные способы получить название
        const title = document.title || '';

        // Ищем в глобальных переменных
        if (window.GAME_NAME) return window.GAME_NAME;
        if (window.gameName) return window.gameName;

        // Из title
        if (title) {
            return title.replace(/[^a-zA-Z0-9\s]/g, '').trim().substring(0, 50);
        }

        return 'unknown_slot';
    });
}

async function enableSound(page) {
    await page.waitForSelector('canvas', { timeout: 30000 });
    console.log('Canvas найден');

    await delay(2000);

    // Программная предзагрузка звуков
    console.log('Инициализируем звуковую систему...');
    await page.evaluate(() => {
        // Устанавливаем флаги
        window.oSoundFXOn = true;
        window.UHT_ForceClickForSounds = false;

        // Инициализируем и загружаем звуки
        if (window.SoundLoader && typeof window.SoundLoader.InitSounds === 'function') {
            window.SoundLoader.InitSounds();
        }

        // Вызываем OnTouchStart для инициализации AudioContext
        if (window.SoundHelper && typeof window.SoundHelper.OnTouchStart === 'function') {
            window.SoundHelper.OnTouchStart();
        }
    });
    console.log('Звуки загружены программно');

    await delay(2000);

    const canvasBox = await getCanvasBox(page);
    console.log(`Canvas: ${canvasBox.width}x${canvasBox.height}`);

    const centerX = canvasBox.x + canvasBox.width * 0.5;
    const centerY = canvasBox.y + canvasBox.height * 0.5;
    await realisticClick(page, centerX, centerY, 'Закрываем заставку');
    await delay(2000);

    let state = await getSoundState(page);
    if (!state.soundOn) {
        const soundX = canvasBox.x + canvasBox.width * 0.145;
        const soundY = canvasBox.y + canvasBox.height * 0.925;
        await realisticClick(page, soundX, soundY, 'Включаем звук');
        await delay(1000);
    }

    console.log('✓ Звук настроен');
    return true;
}

/**
 * Ожидает завершения демо
 */
async function waitForDemoEnd(page, timeoutMs = 300000) {
    console.log('\n⏳ Ожидание завершения демо...\n');

    const startTime = Date.now();
    let lastSoundOn = 0;
    let checkCount = 0;

    while (Date.now() - startTime < timeoutMs) {
        await delay(500);
        checkCount++;

        const state = await getSoundState(page);
        const currentSoundOn = state.on;

        if (checkCount % 20 === 0) {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            console.log(`  [${elapsed}s] BT_SoundTimerOn = ${currentSoundOn.toFixed(1)}`);
        }

        if (lastSoundOn > 20 && currentSoundOn < 5) {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            console.log(`\n🎉 ДЕМО ЗАВЕРШЕНО! (${elapsed}s)`);
            return { success: true, elapsed };
        }

        lastSoundOn = currentSoundOn;
    }

    console.log('\n⏰ Таймаут ожидания демо');
    return { success: false, elapsed: timeoutMs / 1000 };
}

async function parseReplay(url) {
    console.log('[1/6] Запускаем Chrome...\n');

    const browser = await launch({
        headless: false,
        channel: 'chrome',
        defaultViewport: {
            width: VIEWPORT.width,
            height: VIEWPORT.height,
            deviceScaleFactor: 2
        },
        args: [
            `--window-size=${VIEWPORT.width},${VIEWPORT.height + 100}`,
            '--autoplay-policy=no-user-gesture-required',
            '--no-sandbox',
            '--allowlisted-extension-id=jjndjgheafjngoipoacpjgeicjeomjli'
        ],
        ignoreDefaultArgs: ['--mute-audio']
    });

    let stream = null;
    let recordFile = null;
    const timestamp = Date.now();
    const tempWebm = `temp_recording_${timestamp}.webm`;

    try {
        const page = await browser.newPage();
        await page.setViewport(VIEWPORT);

        console.log(`[2/6] Переходим на ${url}...\n`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Получаем название слота
        const slotName = await getSlotName(page);
        console.log(`Слот: ${slotName}`);

        // Создаём папку для записей
        const recordingsDir = './recordings';
        if (!fs.existsSync(recordingsDir)) {
            fs.mkdirSync(recordingsDir, { recursive: true });
        }

        // Файл для выходного видео
        const safeSlotName = slotName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
        const outputFile = `${recordingsDir}/${safeSlotName}_${timestamp}.mp4`;

        console.log('[3/6] Включаем звук...');
        await enableSound(page);

        console.log('[4/6] Начинаем запись видео + аудио...');
        // Начинаем запись через puppeteer-stream
        stream = await getStream(page, { audio: true, video: true });
        recordFile = fs.createWriteStream(tempWebm);
        stream.pipe(recordFile);
        console.log('    Запись начата');

        console.log('[5/6] Ожидание завершения демо...');
        await waitForDemoEnd(page, MAX_RECORD_DURATION);

        // Останавливаем запись
        console.log('    Останавливаем запись...');
        await new Promise(resolve => {
            recordFile.on('finish', resolve);
            stream.end();
        });
        await delay(500);
        console.log('    Запись остановлена');

        console.log('[6/6] Конвертация в MP4...');
        // Конвертируем webm в mp4
        execSync(
            `ffmpeg -y -i ${tempWebm} -vf "scale=${VIEWPORT.width}:${VIEWPORT.height}" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputFile}"`,
            { stdio: 'inherit' }
        );

        // Удаляем временный webm
        if (fs.existsSync(tempWebm)) {
            fs.unlinkSync(tempWebm);
        }

        console.log(`\n✅ Видео сохранено: ${outputFile}`);

    } catch (error) {
        console.error('Ошибка:', error.message || error);
        console.error(error.stack);

        // Завершаем запись при ошибке
        if (stream) {
            try {
                await new Promise(resolve => {
                    if (recordFile) recordFile.on('finish', resolve);
                    stream.end();
                });
            } catch (e) { }
        }

        // Удаляем временный файл
        if (fs.existsSync(tempWebm)) {
            fs.unlinkSync(tempWebm);
        }
    } finally {
        await browser.close();
        console.log('Готово!');
    }
}

const testUrl = process.argv[2] || 'https://www.ppshare.net/oAMzeL77kS';
parseReplay(testUrl);
