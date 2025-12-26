/**
 * Последняя попытка включить звук без кликов
 * Вызываем SoundLoader.InitSounds() и SoundLoader.LoadSounds()
 */

const puppeteer = require('puppeteer');

const TEST_URL = process.argv[2] || 'https://www.pplink.social/ATuDxqTOJj';

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function debugSound() {
    console.log('🔍 Попытка програмной загрузки звуков\n');
    console.log(`URL: ${TEST_URL}\n`);

    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: { width: 1280, height: 720 },
        args: [
            '--autoplay-policy=no-user-gesture-required',
            '--no-sandbox'
        ]
    });

    try {
        const page = await browser.newPage();

        console.log('📄 Загружаем страницу...');
        await page.goto(TEST_URL, { waitUntil: 'networkidle2', timeout: 60000 });

        console.log('⏳ Ждём canvas...');
        await page.waitForSelector('canvas', { timeout: 30000 });
        await delay(4000);

        // ============================================
        // Начальное состояние SoundLoader
        // ============================================
        console.log('\n' + '='.repeat(60));
        console.log('📊 НАЧАЛЬНОЕ СОСТОЯНИЕ SoundLoader');
        console.log('='.repeat(60));

        const initialState = await page.evaluate(() => ({
            initialized: window.SoundLoader?.initialized,
            soundsAreLoaded: window.SoundLoader?.soundsAreLoaded,
            soundsAreBeingLoaded: window.SoundLoader?.soundsAreBeingLoaded,
            numSounds: window.SoundLoader?.numSounds,
            numClips: window.SoundLoader?.numClips,
            audioType: window.SoundLoader?.audioType,
            audioFormat: window.SoundHelper?.audioFormat
        }));

        for (const [k, v] of Object.entries(initialState)) {
            console.log(`  ${k}: ${v}`);
        }

        // ============================================
        // Попытка 1: SoundLoader.InitSounds()
        // ============================================
        console.log('\n' + '='.repeat(60));
        console.log('🔧 ВЫЗОВ SoundLoader.InitSounds()');
        console.log('='.repeat(60));

        const initResult = await page.evaluate(() => {
            if (!window.SoundLoader) return { error: 'SoundLoader не найден' };

            try {
                // Сначала установим флаги
                window.oSoundFXOn = true;
                window.UHT_ForceClickForSounds = false;

                // Попробуем инициализировать
                if (typeof window.SoundLoader.InitSounds === 'function') {
                    window.SoundLoader.InitSounds();
                    return { success: true, method: 'InitSounds()' };
                }
                return { error: 'InitSounds не является функцией' };
            } catch (e) {
                return { error: e.message };
            }
        });

        if (initResult.error) {
            console.log(`  ❌ ${initResult.error}`);
        } else {
            console.log(`  ✅ ${initResult.method} вызван`);
        }

        await delay(2000);

        // Проверяем состояние после InitSounds
        let state = await page.evaluate(() => ({
            initialized: window.SoundLoader?.initialized,
            soundsAreLoaded: window.SoundLoader?.soundsAreLoaded,
            soundsAreBeingLoaded: window.SoundLoader?.soundsAreBeingLoaded,
            numSounds: window.SoundLoader?.numSounds,
            audioFormat: window.SoundHelper?.audioFormat
        }));
        console.log(`  После: initialized=${state.initialized}, loading=${state.soundsAreBeingLoaded}, loaded=${state.soundsAreLoaded}, format=${state.audioFormat}`);

        // ============================================
        // Попытка 2: SoundLoader.LoadSounds()
        // ============================================
        console.log('\n' + '='.repeat(60));
        console.log('🔧 ВЫЗОВ SoundLoader.LoadSounds()');
        console.log('='.repeat(60));

        const loadResult = await page.evaluate(() => {
            if (!window.SoundLoader) return { error: 'SoundLoader не найден' };

            try {
                if (typeof window.SoundLoader.LoadSounds === 'function') {
                    window.SoundLoader.LoadSounds();
                    return { success: true, method: 'LoadSounds()' };
                }
                return { error: 'LoadSounds не является функцией' };
            } catch (e) {
                return { error: e.message };
            }
        });

        if (loadResult.error) {
            console.log(`  ❌ ${loadResult.error}`);
        } else {
            console.log(`  ✅ ${loadResult.method} вызван`);
        }

        // Ждём загрузки
        console.log('\n  ⏳ Ждём загрузки звуков (5 сек)...');
        for (let i = 0; i < 5; i++) {
            await delay(1000);
            state = await page.evaluate(() => ({
                soundsAreBeingLoaded: window.SoundLoader?.soundsAreBeingLoaded,
                soundsAreLoaded: window.SoundLoader?.soundsAreLoaded,
                numSounds: window.SoundLoader?.numSounds,
                audioFormat: window.SoundHelper?.audioFormat
            }));
            console.log(`     [${i + 1}s] loading=${state.soundsAreBeingLoaded}, loaded=${state.soundsAreLoaded}, sounds=${state.numSounds}, format=${state.audioFormat}`);
        }

        // ============================================
        // Попытка 3: OnTouchEnd (имитация завершения тача)
        // ============================================
        console.log('\n' + '='.repeat(60));
        console.log('🔧 ВЫЗОВ SoundLoader.OnTouchEnd()');
        console.log('='.repeat(60));

        const touchEndResult = await page.evaluate(() => {
            if (!window.SoundLoader) return { error: 'SoundLoader не найден' };

            try {
                if (typeof window.SoundLoader.OnTouchEnd === 'function') {
                    window.SoundLoader.OnTouchEnd();
                    return { success: true };
                }
                return { error: 'OnTouchEnd не является функцией' };
            } catch (e) {
                return { error: e.message };
            }
        });

        if (touchEndResult.error) {
            console.log(`  ❌ ${touchEndResult.error}`);
        } else {
            console.log(`  ✅ OnTouchEnd() вызван`);
        }

        await delay(2000);

        // ============================================
        // Попытка 4: SoundHelper методы
        // ============================================
        console.log('\n' + '='.repeat(60));
        console.log('🔧 ВЫЗОВ SoundHelper методов');
        console.log('='.repeat(60));

        const helperResult = await page.evaluate(() => {
            const results = [];

            if (window.SoundHelper) {
                if (typeof window.SoundHelper.OnTouchStart === 'function') {
                    try {
                        window.SoundHelper.OnTouchStart();
                        results.push('OnTouchStart() - OK');
                    } catch (e) {
                        results.push(`OnTouchStart() - ${e.message}`);
                    }
                }

                if (typeof window.SoundHelper.OnIOSTouchEnd === 'function') {
                    try {
                        window.SoundHelper.OnIOSTouchEnd();
                        results.push('OnIOSTouchEnd() - OK');
                    } catch (e) {
                        results.push(`OnIOSTouchEnd() - ${e.message}`);
                    }
                }
            }

            return results;
        });

        helperResult.forEach(r => console.log(`  ${r}`));

        await delay(2000);

        // ============================================
        // Попытка 5: prepareSound
        // ============================================
        console.log('\n' + '='.repeat(60));
        console.log('🔧 ВЫЗОВ prepareSound()');
        console.log('='.repeat(60));

        const prepareResult = await page.evaluate(() => {
            if (typeof window.prepareSound === 'function') {
                try {
                    window.prepareSound();
                    return 'OK';
                } catch (e) {
                    return e.message;
                }
            }
            return 'Функция не найдена';
        });
        console.log(`  prepareSound(): ${prepareResult}`);

        await delay(2000);

        // ============================================
        // Попытка 6: addSounds
        // ============================================
        console.log('\n' + '='.repeat(60));
        console.log('🔧 ВЫЗОВ addSounds()');
        console.log('='.repeat(60));

        const addSoundsResult = await page.evaluate(() => {
            if (typeof window.addSounds === 'function') {
                try {
                    window.addSounds();
                    return 'OK';
                } catch (e) {
                    return e.message;
                }
            }
            return 'Функция не найдена';
        });
        console.log(`  addSounds(): ${addSoundsResult}`);

        await delay(2000);

        // ============================================
        // Финальное состояние
        // ============================================
        console.log('\n' + '='.repeat(60));
        console.log('📊 ФИНАЛЬНОЕ СОСТОЯНИЕ');
        console.log('='.repeat(60));

        const finalState = await page.evaluate(() => ({
            initialized: window.SoundLoader?.initialized,
            soundsAreLoaded: window.SoundLoader?.soundsAreLoaded,
            soundsAreBeingLoaded: window.SoundLoader?.soundsAreBeingLoaded,
            numSounds: window.SoundLoader?.numSounds,
            audioType: window.SoundLoader?.audioType,
            audioFormat: window.SoundHelper?.audioFormat,
            oSoundFXOn: window.oSoundFXOn,
            BT_SoundTimerOn: window.BT_SoundTimerOn || 0,
            BT_SoundTimerOff: window.BT_SoundTimerOff || 0
        }));

        for (const [k, v] of Object.entries(finalState)) {
            console.log(`  ${k}: ${v}`);
        }

        const soundWorking = finalState.BT_SoundTimerOn > 0.5;
        console.log(`\n  🔊 Звук работает: ${soundWorking ? '✅ ДА' : '❌ НЕТ'}`);

        // ============================================
        // Мониторинг
        // ============================================
        console.log('\n' + '='.repeat(60));
        console.log('📈 МОНИТОРИНГ (20 секунд)');
        console.log('='.repeat(60));

        for (let i = 0; i < 20; i++) {
            await delay(1000);
            const s = await page.evaluate(() => ({
                on: window.BT_SoundTimerOn || 0,
                off: window.BT_SoundTimerOff || 0,
                loaded: window.SoundLoader?.soundsAreLoaded,
                format: window.SoundHelper?.audioFormat
            }));
            process.stdout.write(`\r  [${(i + 1).toString().padStart(2)}s] On=${s.on.toFixed(1).padStart(5)} Off=${s.off.toFixed(1).padStart(5)} loaded=${s.loaded} format=${s.format}   `);
        }

        console.log('\n\n✅ Исследование завершено!');
        console.log('Нажми Ctrl+C для выхода.\n');

        await new Promise(() => { });

    } catch (error) {
        console.error('\n❌ Ошибка:', error.message);
        await browser.close();
    }
}

debugSound();
