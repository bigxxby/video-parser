const puppeteer = require('puppeteer');
const { launch, getStream } = require('puppeteer-stream');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const VIEWPORT = {
    width: 1280,
    height: 720
};

const RECORDINGS_DIR = './recordings';

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

    await delay(3000);

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

/**
 * Конвертирует webm в mp4 через ffmpeg
 */
function convertToMp4(webmPath, mp4Path) {
    return new Promise((resolve, reject) => {
        console.log(`\n🔄 Конвертация в MP4...`);

        const ffmpeg = spawn('ffmpeg', [
            '-y',
            '-i', webmPath,
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            '-c:a', 'aac',
            '-b:a', '128k',
            mp4Path
        ]);

        ffmpeg.stderr.on('data', (data) => {
            // Показываем только прогресс
            const str = data.toString();
            if (str.includes('time=')) {
                const match = str.match(/time=(\d{2}:\d{2}:\d{2})/);
                if (match) {
                    process.stdout.write(`\r  Прогресс: ${match[1]}`);
                }
            }
        });

        ffmpeg.on('close', (code) => {
            console.log('');
            if (code === 0) {
                // Удаляем webm
                fs.unlinkSync(webmPath);
                console.log(`✓ Сохранено: ${mp4Path}`);
                resolve(mp4Path);
            } else {
                reject(new Error(`ffmpeg exited with code ${code}`));
            }
        });

        ffmpeg.on('error', (err) => {
            reject(err);
        });
    });
}

async function parseReplay(url) {
    console.log('Запускаем Chrome...\n');

    // Используем launch из puppeteer-stream
    const browser = await launch({
        defaultViewport: VIEWPORT,
        executablePath: puppeteer.executablePath(),
        args: [
            `--window-size=${VIEWPORT.width},${VIEWPORT.height + 100}`,
            '--autoplay-policy=no-user-gesture-required',
            '--no-sandbox',
        ],
        ignoreDefaultArgs: ['--mute-audio'],
    });

    let stream = null;
    let file = null;

    try {
        const page = await browser.newPage();
        await page.setViewport(VIEWPORT);

        console.log(`Переходим на ${url}...\n`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Получаем название слота
        const slotName = await getSlotName(page);
        const safeName = slotName.replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase();
        const timestamp = Date.now();

        // Создаём папку для записей
        const slotDir = path.join(RECORDINGS_DIR, safeName);
        if (!fs.existsSync(slotDir)) {
            fs.mkdirSync(slotDir, { recursive: true });
        }

        const webmPath = path.join(slotDir, `${timestamp}.webm`);
        const mp4Path = path.join(slotDir, `${timestamp}.mp4`);

        console.log(`📁 Папка: ${slotDir}`);

        // Начинаем запись
        stream = await getStream(page, {
            audio: true,
            video: true,
            frameSize: 1000,
        });

        file = fs.createWriteStream(webmPath);
        stream.pipe(file);
        console.log('🔴 Запись начата\n');

        await enableSound(page);

        const result = await waitForDemoEnd(page);

        // Останавливаем запись
        if (stream) {
            stream.destroy();
        }
        if (file) {
            file.close();
        }

        console.log('\n⏹️ Запись остановлена');

        // Даём время на сохранение файла
        await delay(2000);

        // Конвертируем в mp4
        if (fs.existsSync(webmPath)) {
            await convertToMp4(webmPath, mp4Path);
        }

        if (result.success) {
            console.log('\n✅ Реплей записан успешно!');
        }

    } catch (error) {
        console.error('Ошибка:', error.message);
        if (stream) stream.destroy();
        if (file) file.close();
    } finally {
        await browser.close();
        console.log('Готово!');
    }
}

const testUrl = process.argv[2] || 'https://www.ppshare.net/oAMzeL77kS';
parseReplay(testUrl);
