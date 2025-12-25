const puppeteer = require('puppeteer');

const VIEWPORT = {
    width: 1280,
    height: 720
};

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
    await page.mouse.move(x, y, { steps: 10 });
    await delay(100);
    await page.mouse.down();
    await delay(100);
    await page.mouse.up();
    await delay(100);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Получает значения таймеров
 */
async function getSoundState(page) {
    return await page.evaluate(() => ({
        on: window.BT_SoundTimerOn || 0,
        off: window.BT_SoundTimerOff || 0,
        soundOn: (window.BT_SoundTimerOn || 0) > (window.BT_SoundTimerOff || 0)
    }));
}

/**
 * Включает звук в игре с умной логикой
 */
async function enableSound(page) {
    await page.waitForSelector('canvas', { timeout: 30000 });
    console.log('Canvas найден');

    await delay(3000);

    const canvasBox = await getCanvasBox(page);
    console.log(`Canvas: ${canvasBox.width}x${canvasBox.height}`);

    // Шаг 1: Закрываем заставку
    const centerX = canvasBox.x + canvasBox.width * 0.5;
    const centerY = canvasBox.y + canvasBox.height * 0.5;
    await realisticClick(page, centerX, centerY, 'Закрываем заставку');
    await delay(2000);

    // Проверяем состояние после заставки
    let state = await getSoundState(page);
    console.log(`После заставки: on=${state.on.toFixed(2)}, off=${state.off.toFixed(2)} -> ${state.soundOn ? '🔊' : '🔇'}`);

    if (state.soundOn) {
        console.log('✓ Звук уже включён после заставки!');
        return true;
    }

    // Шаг 2: Кликаем на кнопку звука
    const soundX = canvasBox.x + canvasBox.width * 0.145;
    const soundY = canvasBox.y + canvasBox.height * 0.925;

    await realisticClick(page, soundX, soundY, 'Кликаем на звук');
    await delay(1000);

    state = await getSoundState(page);
    console.log(`После звука: on=${state.on.toFixed(2)}, off=${state.off.toFixed(2)} -> ${state.soundOn ? '🔊' : '🔇'}`);

    // Если звук выключился (мы его случайно выключили) - включаем обратно
    if (!state.soundOn && state.off > 0) {
        console.log('Звук выключился, включаем обратно...');
        await realisticClick(page, soundX, soundY, 'Включаем обратно');
        await delay(1000);

        state = await getSoundState(page);
        console.log(`Итого: on=${state.on.toFixed(2)}, off=${state.off.toFixed(2)} -> ${state.soundOn ? '🔊' : '🔇'}`);
    }

    console.log(`\n=== РЕЗУЛЬТАТ: ${state.soundOn ? '🔊 ЗВУК ВКЛЮЧЁН!' : '🔇 звук выключен'} ===`);
    return state.soundOn;
}

async function parseReplay(url) {
    console.log('Запускаем Chrome...');

    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: VIEWPORT,
        args: [
            `--window-size=${VIEWPORT.width},${VIEWPORT.height + 100}`,
            '--autoplay-policy=no-user-gesture-required',
            '--no-sandbox',
        ],
        ignoreDefaultArgs: ['--mute-audio'],
    });

    try {
        const page = await browser.newPage();
        await page.setViewport(VIEWPORT);

        console.log(`Переходим на ${url}...`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        console.log('Страница загружена');

        await enableSound(page);

        console.log('\nОжидание 15 секунд...');
        await delay(15000);

    } catch (error) {
        console.error('Ошибка:', error.message);
    } finally {
        await browser.close();
        console.log('Готово!');
    }
}

const testUrl = process.argv[2] || 'https://www.ppshare.net/oAMzeL77kS';
parseReplay(testUrl);
