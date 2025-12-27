// Определяем режим работы
const isDockerMode = process.env.DOCKER_MODE === 'true' || process.env.HEADLESS === 'true';

// Теперь и Docker и Local используют puppeteer-stream (Docker через Xvfb)
const puppeteerStream = require('puppeteer-stream');
const puppeteerLaunch = puppeteerStream.launch;
const getStream = puppeteerStream.getStream;

if (isDockerMode) {
    console.log('🐳 Docker mode: puppeteer-stream + Xvfb (with audio!)');
} else {
    console.log('🖥️  Local mode: puppeteer-stream (with audio)');
}

const { execSync } = require('child_process');
const fs = require('fs');

// Viewport настройки (как в replay_cleaner_synced.js)
const VIEWPORT_WIDTH = 390;
const VIEWPORT_HEIGHT = 844;
const DEVICE_SCALE_FACTOR = 3;
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const MAX_RECORD_DURATION = 300_000; // 5 минут максимум (deprecated - used by waitForDemoEnd)
const FIXED_RECORD_DURATION = 60_000; // 1 минута фиксированная запись

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

    // Визуализация кликов
    await showClickHitbox(page, x, y, description || 'Click');

    await page.mouse.move(x, y, { steps: 5 }); // Быстрое перемещение
    await page.mouse.down();
    await delay(50); // Минимальная задержка для регистрации клика
    await page.mouse.up();
    await delay(100); // Короткая пауза после клика
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Показывает визуальный хитбокс в точке клика
 */
async function showClickHitbox(page, x, y, label = 'Click') {
    await page.evaluate(({ x, y, label }) => {
        // Создаём контейнер для хитбокса
        const hitbox = document.createElement('div');
        hitbox.id = 'click-hitbox-' + Date.now();
        hitbox.style.cssText = `
            position: fixed;
            left: ${x - 25}px;
            top: ${y - 25}px;
            width: 50px;
            height: 50px;
            border: 3px solid red;
            border-radius: 50%;
            background: rgba(255, 0, 0, 0.3);
            pointer-events: none;
            z-index: 999999;
            animation: pulse 0.5s ease-out;
            box-shadow: 0 0 20px rgba(255, 0, 0, 0.5);
        `;

        // Добавляем точку в центре
        const dot = document.createElement('div');
        dot.style.cssText = `
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            width: 10px;
            height: 10px;
            background: red;
            border-radius: 50%;
        `;
        hitbox.appendChild(dot);

        // Добавляем лейбл
        const labelEl = document.createElement('div');
        labelEl.textContent = label;
        labelEl.style.cssText = `
            position: absolute;
            top: -25px;
            left: 50%;
            transform: translateX(-50%);
            background: red;
            color: white;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
            white-space: nowrap;
        `;
        hitbox.appendChild(labelEl);

        // Добавляем координаты
        const coordsEl = document.createElement('div');
        coordsEl.textContent = `(${Math.round(x)}, ${Math.round(y)})`;
        coordsEl.style.cssText = `
            position: absolute;
            bottom: -20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-family: monospace;
        `;
        hitbox.appendChild(coordsEl);

        // Добавляем стиль анимации если его нет
        if (!document.getElementById('hitbox-animation-style')) {
            const style = document.createElement('style');
            style.id = 'hitbox-animation-style';
            style.textContent = `
                @keyframes pulse {
                    0% { transform: scale(0.5); opacity: 1; }
                    100% { transform: scale(1.5); opacity: 0.3; }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(hitbox);

        // Удаляем через 2 секунды
        setTimeout(() => hitbox.remove(), 2000);
    }, { x, y, label });
}

async function getSoundState(page) {
    return await page.evaluate(() => ({
        on: window.BT_SoundTimerOn || 0,
        off: window.BT_SoundTimerOff || 0,
        soundOn: (window.BT_SoundTimerOn || 0) > 0 // Звук есть если on > 0
    }));
}

/**
 * Получает название слота из страницы (улучшенная версия)
 */
async function getSlotName(page) {
    // Ждём загрузки canvas (означает что игра загрузилась)
    try {
        await page.waitForSelector('canvas', { timeout: 10000 });
    } catch (e) {
        console.log('Canvas не найден для получения названия');
    }



    // Небольшая пауза для загрузки переменных игры
    await delay(1000);

    return await page.evaluate(() => {
        // 1. Ищем в глобальных переменных Pragmatic Play
        if (window.GAME_NAME) return window.GAME_NAME;
        if (window.gameName) return window.gameName;
        if (window.gameConfig && window.gameConfig.gameName) return window.gameConfig.gameName;
        if (window.gameConfig && window.gameConfig.name) return window.gameConfig.name;

        // 2. Ищем в объекте конфигурации игры
        if (window.PP && window.PP.gameName) return window.PP.gameName;
        if (window.PP && window.PP.config && window.PP.config.gameName) return window.PP.config.gameName;

        // 3. Ищем в переменных Pragmatic
        if (window.pragmaticConfig && window.pragmaticConfig.gameName) return window.pragmaticConfig.gameName;

        // 4. Ищем в любых объектах с game/slot в имени
        for (const key of Object.keys(window)) {
            try {
                const val = window[key];
                if (val && typeof val === 'object') {
                    if (val.gameName && typeof val.gameName === 'string') return val.gameName;
                    if (val.slotName && typeof val.slotName === 'string') return val.slotName;
                    if (val.name && key.toLowerCase().includes('game') && typeof val.name === 'string') {
                        return val.name;
                    }
                }
            } catch (e) { }
        }

        // 5. Ищем в localStorage/sessionStorage
        try {
            const stored = sessionStorage.getItem('gameName') || localStorage.getItem('gameName');
            if (stored) return stored;
        } catch (e) { }

        // 6. Ищем в meta-тегах
        const metaTitle = document.querySelector('meta[property="og:title"]');
        if (metaTitle && metaTitle.content) return metaTitle.content;

        // 7. Из title если не "Pragmatic replay"
        const title = document.title || '';
        if (title && !title.toLowerCase().includes('pragmatic replay') && !title.toLowerCase().includes('pragmatic play')) {
            return title.replace(/[^a-zA-Z0-9\s]/g, '').trim().substring(0, 50);
        }

        return 'unknown_slot';
    });
}

async function enableSound(page) {
    // ========== БЕСКОНЕЧНЫЕ КЛИКИ ПОКА ЗВУК НЕ ВКЛЮЧИТСЯ ==========
    const SOUND_X = 40;
    const SOUND_Y = 720;
    const CLICK_DELAY = 400;

    console.log(`\n--- Бесконечные клики в позицию звука (${SOUND_X}, ${SOUND_Y}) ---`);
    console.log('Кликаем пока звук не включится...');

    // Debug: сохраняем скриншот перед кликами (только в Docker режиме)
    if (isDockerMode) {
        try {
            await page.screenshot({ path: './recordings/debug_before_clicks.png', fullPage: true });
            console.log('📸 Debug screenshot saved: ./recordings/debug_before_clicks.png');
        } catch (e) {
            console.log('Failed to save debug screenshot:', e.message);
        }
    }

    let clickCount = 0;

    // Бесконечный цикл пока звук не включится
    while (true) {
        clickCount++;

        // Проверяем звук
        try {
            const state = await getSoundState(page);
            if (state.soundOn) {
                console.log(`\n✅ ЗВУК ВКЛЮЧЕН после ${clickCount} кликов!`);

                // Сохраняем финальный скриншот при успехе
                if (isDockerMode) {
                    try {
                        await page.screenshot({ path: './recordings/debug_sound_enabled.png', fullPage: true });
                        console.log('📸 Debug screenshot saved: ./recordings/debug_sound_enabled.png');
                    } catch (e) { }
                }

                return true;
            }
        } catch (e) {
            // Игнорируем ошибки - страница ещё грузится
        }

        // Логируем каждые 10 кликов
        if (clickCount % 10 === 0) {
            console.log(`Клик ${clickCount}: (${SOUND_X}, ${SOUND_Y}) - звук ещё не включен...`);
        }

        try {
            await page.mouse.click(SOUND_X, SOUND_Y);
        } catch (e) {
            // Игнорируем ошибки клика
        }

        await delay(CLICK_DELAY);

        // Debug: сохраняем скриншот каждые 30 кликов
        if (isDockerMode && clickCount % 30 === 0) {
            try {
                await page.screenshot({ path: `./recordings/debug_click_${clickCount}.png`, fullPage: true });
                console.log(`📸 Debug screenshot saved: ./recordings/debug_click_${clickCount}.png`);
            } catch (e) { }
        }
    }
}

/**
 * @deprecated Используйте enableSound вместо этой функции.
 * Старая логика с сеткой пикселей для поиска звука
 */
async function enableSoundGrid(page) {
    await page.waitForSelector('canvas', { timeout: 30000 });
    const canvasBox = await getCanvasBox(page);
    if (!canvasBox) return false;

    const centerX = canvasBox.x + canvasBox.width * 0.5;
    const centerY = canvasBox.y + canvasBox.height * 0.5;
    await realisticClick(page, centerX, centerY, 'Закрываем заставку');

    const SOUND_BUTTON_POSITIONS = [];
    const Y_LEVELS = [720, 740, 760, 780];
    const X_STEP = 20;

    for (const y of Y_LEVELS) {
        for (let x = 20; x < VIEWPORT_WIDTH - 20; x += X_STEP) {
            SOUND_BUTTON_POSITIONS.push({ x, y });
        }
    }

    let state = await getSoundState(page);
    if (state.soundOn) return true;

    for (let i = 0; i < SOUND_BUTTON_POSITIONS.length; i++) {
        state = await getSoundState(page);
        if (state.soundOn) return true;

        const pos = SOUND_BUTTON_POSITIONS[i];
        await realisticClick(page, pos.x, pos.y, `Sound ${i + 1}`);
        await delay(150);
    }

    return (await getSoundState(page)).soundOn;
}

/**
 * Ожидает фиксированное время записи
 * @param {number} durationMs - длительность записи в миллисекундах
 */
async function waitForFixedDuration(durationMs = FIXED_RECORD_DURATION) {
    const seconds = durationMs / 1000;
    console.log(`\n⏳ Запись на ${seconds} секунд (${seconds / 60} мин)...\n`);

    const startTime = Date.now();
    const checkInterval = 5000; // каждые 5 секунд логируем прогресс

    while (Date.now() - startTime < durationMs) {
        await delay(checkInterval);
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const remaining = Math.ceil((durationMs - (Date.now() - startTime)) / 1000);
        console.log(`  [${elapsed}s / ${seconds}s] Осталось: ${remaining}s`);
    }

    console.log(`\n✅ Запись завершена (${seconds}s)`);
    return { success: true, elapsed: seconds };
}

/**
 * @deprecated Используйте waitForFixedDuration вместо этой функции.
 * Ожидает завершения демо по мониторингу звука (старая логика)
 */
async function waitForDemoEnd(page, timeoutMs = 300000) {
    console.log('\n⚠️ [DEPRECATED] waitForDemoEnd - используйте waitForFixedDuration');
    console.log('⏳ Ожидание завершения демо...\n');

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
    // В Docker используем headless: "new" режим
    // Устанавливаем DOCKER_MODE=true или HEADLESS=true для активации
    const isDockerMode = process.env.DOCKER_MODE === 'true' || process.env.HEADLESS === 'true';
    const headlessMode = isDockerMode ? 'new' : false;

    // В Docker используем Chromium из PUPPETEER_EXECUTABLE_PATH
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || null;

    console.log(`[1/6] Запускаем браузер (headless: ${headlessMode})...\n`);
    if (isDockerMode) {
        console.log('🐳 Docker режим: headless: "new" с GPU ускорением');
        console.log(`   Executable: ${executablePath || 'default Chrome'}`);
    }

    const launchOptions = {
        headless: headlessMode,
        protocolTimeout: 120000, // 2 minutes timeout for Docker performance
        defaultViewport: {
            width: VIEWPORT_WIDTH,
            height: VIEWPORT_HEIGHT,
            deviceScaleFactor: DEVICE_SCALE_FACTOR,
            isMobile: true,
            hasTouch: true
        },
        args: [
            '--autoplay-policy=no-user-gesture-required',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--hide-scrollbars',
            '--disable-infobars',
            '--disable-notifications',
            '--disable-popup-blocking',
            '--disable-translate',
            // GPU и WebGL для Docker (canvas рендеринг)
            '--enable-webgl',
            '--enable-gpu',
            '--use-gl=egl',
            '--enable-features=Vulkan,UseSkiaRenderer',
            '--ignore-gpu-blocklist',
            '--disable-software-rasterizer',
            // Для стабильности в Docker
            '--disable-dev-shm-usage',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-breakpad',
            '--disable-component-update',
            '--disable-default-apps',
            '--disable-hang-monitor',
            '--disable-ipc-flooding-protection',
            '--disable-prompt-on-repost',
            '--disable-renderer-backgrounding',
            '--disable-sync',
            '--metrics-recording-only',
            '--no-first-run',
            '--password-store=basic',
            '--use-mock-keychain'
        ],
        ignoreDefaultArgs: ['--mute-audio', '--enable-automation']
    };

    // Docker с Xvfb также использует puppeteer-stream с расширением
    if (executablePath) {
        launchOptions.executablePath = executablePath;
    } else {
        launchOptions.channel = 'chrome';
    }
    // puppeteer-stream extension needed for both Docker and Local
    launchOptions.args.push('--allowlisted-extension-id=jjndjgheafjngoipoacpjgeicjeomjli');

    const browser = await puppeteerLaunch(launchOptions);

    let stream = null;
    let recordFile = null;
    const timestamp = Date.now();
    // Создаём записи сразу в папке recordings (избегаем EXDEV в Docker)
    const recordingsDir = './recordings';
    const tempWebm = `${recordingsDir}/temp_recording_${timestamp}.webm`;

    try {
        const page = await browser.newPage();
        await page.setUserAgent(USER_AGENT);

        console.log(`[2/6] Переходим на ${url}...\\n`);
        // Use domcontentloaded - game pages with heavy JS may take too long for networkidle2
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
        // Give the page time to initialize JavaScript
        await delay(5000);

        // ========== СРАЗУ ИНИЦИАЛИЗИРУЕМ И КЛИКАЕМ ПО ЗВУКУ ==========
        // Инициализируем звуки программно
        try {
            await page.evaluate(() => {
                window.oSoundFXOn = true;
                window.UHT_ForceClickForSounds = false;
                if (window.SoundLoader && typeof window.SoundLoader.InitSounds === 'function') {
                    window.SoundLoader.InitSounds();
                }
                if (window.SoundHelper && typeof window.SoundHelper.OnTouchStart === 'function') {
                    window.SoundHelper.OnTouchStart();
                }
            });
        } catch (e) {
            // Страница ещё не готова - игнорируем
        }

        console.log('[3/6] Включаем звук СРАЗУ после загрузки...');
        await enableSound(page);

        // Создаём папку для записей если не существует
        if (!fs.existsSync(recordingsDir)) {
            fs.mkdirSync(recordingsDir, { recursive: true });
        }


        // ========== ЗАПИСЬ НАЧИНАЕТСЯ ПОСЛЕ ВКЛЮЧЕНИЯ ЗВУКА ==========
        console.log('[4/6] Начинаем запись...');

        // Используем puppeteer-stream для записи (и Docker, и Local)
        stream = await getStream(page, {
            audio: true,
            video: true,
            frameSize: 1000,
            videoBitsPerSecond: 8000000
        });
        recordFile = fs.createWriteStream(tempWebm);
        stream.pipe(recordFile);
        console.log('    🎬 Recording started (with audio)');

        // Получаем название слота
        const slotName = await getSlotName(page);
        console.log('\n========================================');
        console.log(`🎰 СЛОТ: ${slotName}`);
        console.log('========================================\n');

        // Функция для безопасного завершения и сохранения
        async function stopAndSave() {
            console.log('\n🛑 Завершение записи...');

            const safeSlotName = slotName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);

            // Останавливаем stream
            try {
                stream.destroy();
                if (recordFile) recordFile.end();
            } catch (e) {
                console.log('Error closing stream:', e.message);
            }

            await delay(1000);

            // Переименовываем webm в финальное имя
            const finalOutputFile = `${recordingsDir}/${safeSlotName}_${timestamp}.webm`;
            if (fs.existsSync(tempWebm) && fs.statSync(tempWebm).size > 0) {
                fs.renameSync(tempWebm, finalOutputFile);
                console.log(`\n✅ Видео сохранено: ${finalOutputFile}`);
            } else {
                console.log('❌ Файл записи пуст или не существует');
            }
        }

        // Обработка прерывания (Ctrl+C)
        process.removeAllListeners('SIGINT');
        process.on('SIGINT', async () => {
            console.log('\n\n🚨 Обнаружено прерывание! Сохраняем видео перед выходом...');
            await stopAndSave();

            if (browser) {
                await browser.close().catch(() => { });
            }
            process.exit(0);
        });

        console.log('[6/6] Ожидание фиксированной записи (1 мин)...');
        // Используем цикл с проверкой флага для прерывания
        const durationMs = FIXED_RECORD_DURATION;
        const startTime = Date.now();
        const checkInterval = 1000;

        while (Date.now() - startTime < durationMs) {
            await delay(checkInterval);
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const remaining = Math.ceil((durationMs - (Date.now() - startTime)) / 1000);

            // Логируем каждые 5 сек
            if (elapsed % 5 === 0) {
                console.log(`  [${elapsed}s / ${durationMs / 1000}s] Осталось: ${remaining}s`);
            }
        }

        // Нормальное завершение
        await stopAndSave();

    } catch (error) {
        console.error('Ошибка:', error.message || error);
        console.error(error.stack);

        // Удаляем временный файл при ошибке (если не удалось сохранить)
        if (fs.existsSync(tempWebm)) {
            // fs.unlinkSync(tempWebm); // Keep webm for debug if needed, or delete? User wants to save if interrupt.
            // При ошибке лучше не удалять если он есть
        }
    } finally {
        if (browser) {
            try {
                const pages = await browser.pages();
                await Promise.all(pages.map(p => p.close().catch(() => { })));
                await browser.close().catch(() => { });
            } catch (e) {
                console.error('Error closing browser:', e);
            }
        }
        console.log('Готово!');
    }
}

const testUrl = process.argv[2] || 'https://www.ppshare.net/oAMzeL77kS';
parseReplay(testUrl)
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
