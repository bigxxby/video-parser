const { launch, getStream } = require('puppeteer-stream');
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
    await page.waitForSelector('canvas', { timeout: 30000 });
    console.log('Canvas найден');

    // Получаем реальные размеры canvas
    const canvasBox = await getCanvasBox(page);
    if (!canvasBox) {
        console.log('Canvas не найден!');
        return false;
    }
    console.log(`Canvas: ${canvasBox.width}x${canvasBox.height}`);

    // Закрываем заставку кликом в центр (50% x 50%)
    const centerX = canvasBox.x + canvasBox.width * 0.5;
    const centerY = canvasBox.y + canvasBox.height * 0.5;
    await realisticClick(page, centerX, centerY, 'Закрываем заставку (50%, 50%)');

    // ========== СЕТКА ПИКСЕЛЕЙ ДЛЯ ПОИСКА ЗВУКА ==========
    // Viewport: 390x844, сканируем всю нижнюю часть экрана

    // Генерируем сетку позиций
    const SOUND_BUTTON_POSITIONS = [];
    const Y_LEVELS = [700, 720, 740, 760]; // Чуть ниже
    const X_STEP = 20; // Шаг по X

    for (const y of Y_LEVELS) {
        for (let x = 20; x < VIEWPORT_WIDTH - 20; x += X_STEP) {
            SOUND_BUTTON_POSITIONS.push({ x, y });
        }
    }

    console.log('\n--- Сетка пикселей для поиска звука ---');
    console.log(`Viewport: ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}px`);
    console.log(`Y уровни: ${Y_LEVELS.join(', ')}px`);
    console.log(`Шаг по X: ${X_STEP}px`);
    console.log(`Всего позиций: ${SOUND_BUTTON_POSITIONS.length}`);

    // Проверяем звук ДО начала кликов
    let state = await getSoundState(page);
    if (state.soundOn) {
        console.log('\n✅ Звук УЖЕ включен, пропускаем сканирование');
        return true;
    }

    let soundEnabled = false;

    // Кликаем по фиксированным позициям пока не включим звук
    for (let i = 0; i < SOUND_BUTTON_POSITIONS.length && !soundEnabled; i++) {
        // Проверяем звук ПЕРЕД каждым кликом
        state = await getSoundState(page);
        if (state.soundOn) {
            soundEnabled = true;
            console.log(`\n✅ ЗВУК ВКЛЮЧЕН! Останавливаем.`);
            break;
        }

        const pos = SOUND_BUTTON_POSITIONS[i];
        console.log(`Клик ${i + 1}/${SOUND_BUTTON_POSITIONS.length}: (${pos.x}, ${pos.y})`);

        await realisticClick(page, pos.x, pos.y, `Sound ${i + 1}`);
        await delay(150);
    }

    // Финальная проверка
    if (!soundEnabled) {
        state = await getSoundState(page);
        soundEnabled = state.soundOn;
    }

    if (!soundEnabled) {
        console.log('\n⚠️ Звук не был включен после всех кликов');
    } else {
        console.log('✅ Звук успешно включен');
    }

    console.log('✓ Сканирование завершено');
    return soundEnabled;
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
    console.log('[1/6] Запускаем Chrome с адаптивными размерами...\n');

    const browser = await launch({
        headless: false,
        channel: 'chrome',
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
            '--hide-scrollbars',
            '--disable-infobars',
            '--disable-notifications',
            '--disable-popup-blocking',
            '--disable-translate',
            '--allowlisted-extension-id=jjndjgheafjngoipoacpjgeicjeomjli'
        ],
        ignoreDefaultArgs: ['--mute-audio', '--enable-automation']
    });

    let stream = null;
    let recordFile = null;
    const timestamp = Date.now();
    const tempWebm = `temp_recording_${timestamp}.webm`;

    try {
        const page = await browser.newPage();
        await page.setUserAgent(USER_AGENT);

        console.log(`[2/6] Переходим на ${url}...\n`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Создаём папку для записей
        const recordingsDir = './recordings';
        if (!fs.existsSync(recordingsDir)) {
            fs.mkdirSync(recordingsDir, { recursive: true });
        }

        // Временное имя файла для записи
        const tempName = `recording_${timestamp}`;
        const tempOutputFile = `${recordingsDir}/${tempName}.mp4`;

        // ========== ЗАПИСЬ НАЧИНАЕТСЯ СРАЗУ ПОСЛЕ ЗАГРУЗКИ (МГНОВЕННО) ==========
        console.log('[3/6] Начинаем запись СРАЗУ после загрузки страницы...');
        stream = await getStream(page, {
            audio: true,
            video: true,
            frameSize: 1000,
            videoBitsPerSecond: 8000000
        });
        recordFile = fs.createWriteStream(tempWebm);
        stream.pipe(recordFile);
        console.log('    Запись начата');

        // Теперь, когда запись идет, можно делать все остальное

        // 1. Инициализируем звуки
        console.log('[4/6] Инициализируем звуки программно...');
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

        // 2. Получаем название слота (параллельно с записью)
        // Ждем немного чтобы прогрузился title
        await delay(2000);
        const slotName = await getSlotName(page);
        console.log('\n========================================');
        console.log(`🎰 СЛОТ: ${slotName}`);
        console.log('========================================\n');

        // 3. Включаем звук
        console.log('[5/6] Включаем звук...');
        await enableSound(page);

        // Функция для безопасного завершения и сохранения
        async function stopAndSave() {
            console.log('\n🛑 Завершение записи...');

            if (stream) {
                try {
                    // Force stream end
                    stream.destroy();
                    if (recordFile) recordFile.end();
                } catch (e) {
                    console.log('Error closing stream:', e.message);
                }
            }

            // Wait a bit for file close
            await delay(1000);

            console.log('[7/6] Конвертация в MP4...');
            try {
                // Check if webm exists and has size
                if (fs.existsSync(tempWebm) && fs.statSync(tempWebm).size > 0) {
                    // Масштабирование с 3x до целевого размера viewport (как в replay_cleaner_synced.js)
                    execSync(
                        `ffmpeg -y -i ${tempWebm} -vf "scale=${VIEWPORT_WIDTH}:${VIEWPORT_HEIGHT}" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${tempOutputFile}"`,
                        { stdio: 'inherit' }
                    );

                    // Удаляем временный webm
                    fs.unlinkSync(tempWebm);

                    // Переименовываем в финальное имя
                    const safeSlotName = slotName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
                    const finalOutputFile = `${recordingsDir}/${safeSlotName}_${timestamp}.mp4`;

                    if (fs.existsSync(tempOutputFile)) {
                        fs.renameSync(tempOutputFile, finalOutputFile);
                        console.log(`\n✅ Видео переименовано и сохранено: ${finalOutputFile}`);
                    }
                } else {
                    console.log('❌ Файл записи пуст или не существует');
                }
            } catch (e) {
                console.error('Ошибка конвертации:', e.message);
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
