// Определяем режим работы
const isDockerMode = process.env.DOCKER_MODE === 'true' || process.env.HEADLESS === 'true';
// GPU mode - включается автоматически при наличии NVIDIA GPU или вручную через env
const isGpuMode = process.env.GPU_MODE === 'true' || process.env.NVIDIA_VISIBLE_DEVICES !== undefined;

// Теперь и Docker и Local используют puppeteer-stream (Docker через Xvfb)
const puppeteerStream = require('puppeteer-stream');
const puppeteerLaunch = puppeteerStream.launch;
const getStream = puppeteerStream.getStream;

if (isDockerMode) {
    if (isGpuMode) {
        console.log('🐳🎮 Docker mode: puppeteer-stream + Xvfb + NVIDIA GPU acceleration!');
    } else {
        console.log('🐳 Docker mode: puppeteer-stream + Xvfb (software rendering)');
    }
} else {
    console.log('🖥️  Local mode: puppeteer-stream (with audio)');
}

const { execSync } = require('child_process');
const fs = require('fs');

// Viewport настройки (как в replay_cleaner_synced.js)
const VIEWPORT_WIDTH = 390;
const VIEWPORT_HEIGHT = 844;
const DEVICE_SCALE_FACTOR = 3; // High quality 3x density
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const MAX_RECORD_DURATION = 300_000; // 5 минут максимум (deprecated - used by waitForDemoEnd)
const FIXED_RECORD_DURATION = 80_000; // 1 минута 20 секунд (80 секунд)

/**
 * Возвращает аргументы Chrome в зависимости от режима GPU
 * При наличии NVIDIA GPU используется аппаратное ускорение
 * Без GPU используется software rendering
 */
function getChromeArgs() {
    // Базовые аргументы для всех режимов
    const baseArgs = [
        '--autoplay-policy=no-user-gesture-required',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--hide-scrollbars',
        '--disable-infobars',
        '--disable-notifications',
        '--disable-popup-blocking',
        '--disable-translate',
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
    ];

    if (isGpuMode) {
        // === NVIDIA GPU MODE ===
        // Аппаратное ускорение для canvas и WebGL через Vulkan/EGL
        console.log('🎮 GPU Mode: Hardware accelerated canvas rendering');
        return [
            ...baseArgs,
            // WebGL и GPU ускорение
            '--enable-webgl',
            '--enable-webgl2',
            '--enable-gpu',
            '--enable-gpu-rasterization',
            '--enable-accelerated-2d-canvas',
            '--enable-accelerated-video-decode',
            '--enable-accelerated-video-encode',
            // Vulkan backend для максимальной производительности
            '--use-gl=egl',
            '--use-vulkan',
            '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan,UseSkiaRenderer,CanvasOopRasterization',
            // Игнорировать блокировки GPU
            '--ignore-gpu-blocklist',
            '--ignore-gpu-blacklist',
            // Отключить throttling для максимальной производительности
            '--disable-frame-rate-limit',
            '--disable-gpu-vsync',
            // Canvas optimizations
            '--force-gpu-rasterization',
            '--enable-zero-copy',
            '--enable-native-gpu-memory-buffers',
        ];
    } else {
        // === SOFTWARE RENDERING MODE ===
        // Для Mac или систем без NVIDIA GPU
        console.log('💻 Software Mode: CPU-based rendering');
        return [
            ...baseArgs,
            // Software rendering
            '--disable-gpu',
            '--disable-gpu-compositing',
            '--disable-software-rasterizer',
            // Но WebGL нужен для canvas игр
            '--enable-webgl',
            '--use-gl=swiftshader',
            '--enable-features=UseSkiaRenderer',
        ];
    }
}

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

    // Визуализация кликов удалена

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
// function showClickHitbox removed

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
    // Debug: сохраняем скриншот перед кликами (удалено)

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
                // Сохраняем финальный скриншот при успехе (удалено)

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
        // Debug: сохраняем скриншот каждые 30 кликов (удалено)
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

/**
 * Основная функция для обработки одного реплея
 * @param {string} url - URL реплея
 * @param {object} browser - инстанс puppeteer browser
 */
async function processReplay(url, browser) {
    let stream = null;
    let recordFile = null;
    const timestamp = Date.now();
    const recordingsDir = './recordings';
    const tempWebm = `${recordingsDir}/temp_recording_${timestamp}.webm`;

    let page = null;

    try {
        page = await browser.newPage();
        await page.setUserAgent(USER_AGENT);

        console.log(`[2/6] Переходим на ${url}...`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await delay(5000);

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
        } catch (e) { }

        console.log('[3/6] Включаем звук СРАЗУ после загрузки...');
        await enableSound(page);

        if (!fs.existsSync(recordingsDir)) {
            fs.mkdirSync(recordingsDir, { recursive: true });
        }

        console.log('[4/6] Начинаем запись...');
        stream = await getStream(page, {
            audio: true,
            video: true,
            frameSize: 16, // 60 FPS
            videoBitsPerSecond: 4000000, // Reduced for less CPU load
            mimeType: 'video/webm;codecs=vp8'
        });
        recordFile = fs.createWriteStream(tempWebm);
        stream.pipe(recordFile);
        console.log('    🎬 Recording started (with audio)');

        const slotName = await getSlotName(page);
        console.log('\n========================================');
        console.log(`🎰 СЛОТ: ${slotName}`);
        console.log('========================================\n');

        async function stopAndSave() {
            console.log('\n🛑 Завершение записи...');
            const safeSlotName = slotName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);

            try {
                stream.destroy();
                if (recordFile) recordFile.end();
            } catch (e) {
                console.log('Error closing stream:', e.message);
            }

            await delay(1000);

            const finalOutputFile = `${recordingsDir}/${safeSlotName}_${timestamp}.webm`;
            const finalMp4File = `${recordingsDir}/${safeSlotName}_${timestamp}.mp4`;

            if (fs.existsSync(tempWebm) && fs.statSync(tempWebm).size > 0) {
                fs.renameSync(tempWebm, finalOutputFile);
                console.log(`\n✅ Видео сохранено: ${finalOutputFile}`);

                console.log('🔄 Конвертация в MP4 (forced 30fps)...');
                try {
                    // -crf 20 (Better quality), -b:v 6M (Target bitrate)
                    execSync(`ffmpeg -y -i "${finalOutputFile}" -c:v libx264 -preset ultrafast -crf 20 -c:a aac -b:a 128k -r 60 "${finalMp4File}"`, { stdio: 'inherit' });
                    console.log(`✅ MP4 создан: ${finalMp4File}`);

                    // Удаляем исходный webm файл чтобы не занимать место
                    try {
                        fs.unlinkSync(finalOutputFile);
                        console.log(`🗑️ Удален исходный WEBM: ${finalOutputFile}`);
                    } catch (e) {
                        console.error('Ошибка удаления WEBM:', e.message);
                    }

                } catch (e) {
                    console.error('❌ Ошибка конвертации в MP4:', e.message);
                }
            } else {
                console.log('❌ Файл записи пуст или не существует');
            }
        }

        console.log(`[6/6] Ожидание фиксированной записи (${FIXED_RECORD_DURATION / 1000} сек)...`);

        const startTime = Date.now();
        const checkInterval = 1000;

        while (Date.now() - startTime < FIXED_RECORD_DURATION) {
            await delay(checkInterval);
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const remaining = Math.ceil((FIXED_RECORD_DURATION - (Date.now() - startTime)) / 1000);

            if (elapsed % 5 === 0) {
                console.log(`  [${elapsed}s / ${FIXED_RECORD_DURATION / 1000}s] Осталось: ${remaining}s`);
            }
        }

        await stopAndSave();
        return true;

    } catch (error) {
        console.error('Ошибка при обработке реплея:', error.message || error);
        if (fs.existsSync(tempWebm)) {
            try { fs.unlinkSync(tempWebm); } catch (e) { }
        }
        return false;
    } finally {
        if (page) {
            await page.close().catch(() => { });
        }
    }
}

/**
 * Главная точка входа
 */
async function main() {
    // В Docker используем headless: "new" режим
    const isDockerMode = process.env.DOCKER_MODE === 'true' || process.env.HEADLESS === 'true';
    const isBatchMode = process.env.BATCH_MODE === 'true';
    const headlessMode = isDockerMode ? 'new' : false;
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || null;

    console.log(`[1/6] Запускаем браузер (headless: ${headlessMode})...`);
    if (isDockerMode) {
        console.log('🐳 Docker режим: headless: "new" с GPU ускорением');
    }

    const launchOptions = {
        headless: headlessMode,
        protocolTimeout: 120000,
        defaultViewport: {
            width: VIEWPORT_WIDTH,
            height: VIEWPORT_HEIGHT,
            deviceScaleFactor: DEVICE_SCALE_FACTOR,
            isMobile: true,
            hasTouch: true
        },
        args: getChromeArgs(),
        ignoreDefaultArgs: ['--mute-audio', '--enable-automation']
    };

    if (executablePath) launchOptions.executablePath = executablePath;
    else launchOptions.channel = 'chrome';

    launchOptions.args.push('--allowlisted-extension-id=jjndjgheafjngoipoacpjgeicjeomjli');

    const browser = await puppeteerLaunch(launchOptions);

    try {
        if (isBatchMode) {
            console.log('\n🚀 ЗАПУЩЕН BATCH MODE (обработка списка wins.json)\n');
            const JSON_FILE = 'pragmatic_play_wins.json';

            if (!fs.existsSync(JSON_FILE)) {
                console.error(`❌ Файл ${JSON_FILE} не найден!`);
                process.exit(1);
            }

            const data = fs.readFileSync(JSON_FILE, 'utf-8');
            const wins = JSON.parse(data);
            const replays = wins.filter(w => w.replayUrl);

            console.log(`Найдено ${replays.length} реплеев для обработки.`);

            const recordingsDir = './recordings';
            if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir);

            for (let i = 0; i < replays.length; i++) {
                const item = replays[i];
                console.log(`\n============== [${i + 1}/${replays.length}] ==============`);
                console.log(`Обработка: ${item.title}`);
                console.log(`URL: ${item.replayUrl}`);

                // Проверка на существование (простая проверка)
                const safeTitle = item.title.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
                // Ищем любой mp4, который начинается с этого имени
                const exists = fs.readdirSync(recordingsDir).some(f => f.startsWith(safeTitle) && f.endsWith('.mp4'));

                if (exists) {
                    console.log(`✅ Видео для "${item.title}" уже существует. Пропускаем.`);
                    continue;
                }

                await processReplay(item.replayUrl, browser);

                // Небольшая пауза между записями для очистки памяти
                if (i < replays.length - 1) {
                    console.log('💤 Пауза 5 секунд...');
                    await delay(5000);
                }
            }
        } else {
            // Одиночный режим (аргумент командной строки)
            const url = process.argv[2] || 'https://www.ppshare.net/oAMzeL77kS';
            await processReplay(url, browser);
        }

    } catch (e) {
        console.error('Fatal execution error:', e);
    } finally {
        console.log('\n🚪 Закрываем браузер...');
        await browser.close();
    }
}

// Запуск
main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
