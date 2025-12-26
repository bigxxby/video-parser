const { launch, getStream } = require('puppeteer-stream');
const { execSync } = require('child_process');
const fs = require('fs');

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

    // Показываем хитбокс перед кликом
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

    // Получаем реальные размеры canvas
    const canvasBox = await getCanvasBox(page);
    if (!canvasBox) {
        console.log('Canvas не найден!');
        return false;
    }
    console.log(`Canvas: ${canvasBox.width}x${canvasBox.height}`);

    // Закрываем заставку кликом в центр
    const centerX = canvasBox.x + canvasBox.width * 0.5;
    const centerY = canvasBox.y + canvasBox.height * 0.5;
    await realisticClick(page, centerX, centerY, 'Закрываем заставку');

    // ========== КЛИКИ ПО НИЖНЕЙ ПАНЕЛИ ==========
    // Фиксированные пиксельные позиции для нижней панели
    // Предполагаемый размер canvas: 1280x720
    // Нижняя панель находится примерно на высоте 665px (Y = canvasBox.y + 665)
    // Размер каждой кнопки примерно 80x50 пикселей

    const BUTTON_HEIGHT = 50; // Фиксированная высота кнопки
    const BUTTON_WIDTH = 80;  // Фиксированная ширина кнопки
    const BOTTOM_PANEL_Y_OFFSET = 665; // Смещение от верха canvas до центра нижней панели

    // Фиксированные X позиции кнопок на нижней панели (от левого края canvas)
    // Эти значения соответствуют типичной раскладке Pragmatic Play:
    // Меню | Турбо | Автоигра | Инфо | Звук | Баланс | Ставка | Спин
    const BOTTOM_PANEL_BUTTONS_X = [
        100,   // Левый край - меню/настройки
        185,   // Звук (основная цель)
        270,   // Турбо
        355,   // Автоигра
        440,   // Инфо
        525,   // Дополнительная зона
        610,   // Ставка -
        695,   // Ставка
        780,   // Ставка +
        865,   // Баланс
        950,   // Спин
        1035,  // Правее спина
        1120,  // Крайний правый
        1180   // Самый правый край
    ];

    const panelY = canvasBox.y + BOTTOM_PANEL_Y_OFFSET;

    console.log('\n--- Сканирование нижней панели для включения звука ---');
    console.log(`Размер кнопки: ${BUTTON_WIDTH}x${BUTTON_HEIGHT}px`);
    console.log(`Y координата панели: ${panelY.toFixed(0)}px`);

    let soundEnabled = false;

    // Два прохода по всем кнопкам
    for (let pass = 1; pass <= 2 && !soundEnabled; pass++) {
        console.log(`\n=== Проход ${pass}/2 ===`);

        for (let i = 0; i < BOTTOM_PANEL_BUTTONS_X.length && !soundEnabled; i++) {
            const buttonX = canvasBox.x + BOTTOM_PANEL_BUTTONS_X[i];

            console.log(`\nКлик ${i + 1}/${BOTTOM_PANEL_BUTTONS_X.length}:`);
            console.log(`  Позиция: X=${buttonX.toFixed(0)}, Y=${panelY.toFixed(0)}`);
            console.log(`  Хитбокс: ${BUTTON_WIDTH}x${BUTTON_HEIGHT}px`);

            await realisticClick(page, buttonX, panelY, `Кнопка ${i + 1}`);

            // Проверяем звук после каждого клика
            const state = await getSoundState(page);
            console.log(`  Звук: on=${state.on.toFixed(1)}, off=${state.off.toFixed(1)}, включен=${state.soundOn}`);

            if (state.soundOn) {
                soundEnabled = true;
                console.log(`\n✅ ЗВУК ВКЛЮЧЕН после клика ${i + 1}!`);
            }
        }
    }

    if (!soundEnabled) {
        console.log('\n⚠️ Звук не был включен после всех кликов');
    }

    console.log('✓ Сканирование завершено');
    return soundEnabled;
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

// Фиксированные размеры canvas
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

async function parseReplay(url) {
    console.log('[1/6] Запускаем Chrome...\n');
    console.log(`Фиксированный размер canvas: ${CANVAS_WIDTH}x${CANVAS_HEIGHT}`);

    const browser = await launch({
        headless: false,
        channel: 'chrome',
        defaultViewport: {
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT
        },
        args: [
            `--window-size=${CANVAS_WIDTH},${CANVAS_HEIGHT + 150}`, // +150 для UI Chrome (табы, адресная строка)
            '--window-position=0,0',
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

        console.log(`[2/6] Переходим на ${url}...\n`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Инициализируем звуковую систему сразу после загрузки страницы
        console.log('Инициализируем звуки программно...');
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
        await delay(2000); // Ждём загрузки звуков

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
        stream = await getStream(page, {
            audio: true,
            video: true,
            frameSize: 1000, // ~1 second chunks
            videoBitsPerSecond: 8000000 // 8 Mbps для качественного видео
        });
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
        // Конвертируем webm в mp4 без изменения размеров
        execSync(
            `ffmpeg -y -i ${tempWebm} -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputFile}"`,
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
