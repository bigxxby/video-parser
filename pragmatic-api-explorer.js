const puppeteer = require('puppeteer');
const fs = require('fs').promises;

/**
 * Класс для работы с API Pragmatic Play для получения данных реплеев
 */
class PragmaticPlayAPI {
    constructor() {
        this.browser = null;
        this.page = null;
    }

    /**
     * Инициализация браузера
     */
    async init() {
        this.browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        this.page = await this.browser.newPage();
    }

    /**
     * Извлечение конфигурации игры из HTML страницы реплея
     * @param {string} replayUrl - URL реплея (например, https://www.pplink.social/ATuDxqTOJj)
     * @returns {Object} Конфигурация игры с эндпоинтами и параметрами
     */
    async extractGameConfig(replayUrl) {
        console.log(`🔍 Анализ URL: ${replayUrl}`);

        await this.page.goto(replayUrl, { waitUntil: 'networkidle2' });

        // Ждем загрузки страницы
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Извлекаем конфигурацию из исходного кода страницы
        const config = await this.page.evaluate(() => {
            // Сначала проверяем window.gameConfig
            if (window.gameConfig) {
                return window.gameConfig;
            }

            // Если нет, ищем в скриптах Html5GameManager.init
            const scripts = Array.from(document.querySelectorAll('script'));

            for (const script of scripts) {
                const text = script.textContent;

                // Ищем Html5GameManager.init вызов
                if (text.includes('Html5GameManager.init')) {
                    // Регулярное выражение для извлечения параметров внутри Html5GameManager.init({...})
                    // Учитывает вложенные скобки для корректного парсинга объекта
                    const initMatch = text.match(/Html5GameManager\.init\(\s*({(?:[^{}]|{[^{}]*})*})\s*\)/);
                    if (initMatch) {
                        try {
                            // Извлекаем параметры
                            const paramsText = initMatch[1]; // initMatch[1] содержит содержимое объекта {...}

                            // Ищем gameConfig параметр, который может быть строкой JSON
                            const gameConfigMatch = paramsText.match(/gameConfig:\s*['"]({[^'"]+})['"]/);
                            if (gameConfigMatch) {
                                // Парсим JSON из строки, обрабатывая экранированные кавычки
                                const gameConfigStr = gameConfigMatch[1]
                                    .replace(/\\'/g, "'")
                                    .replace(/\\"/g, '"');
                                return JSON.parse(gameConfigStr);
                            }

                            // Альтернативный поиск - gameConfig как прямой объект
                            const gameConfigObjMatch = paramsText.match(/gameConfig:\s*({(?:[^{}]|{[^{}]*})*})\s*[,}]/);
                            if (gameConfigObjMatch) {
                                return JSON.parse(gameConfigObjMatch[1]);
                            }
                        } catch (e) {
                            console.error('Error parsing config:', e);
                        }
                    }
                }
            }

            return null;
        });

        if (!config) {
            throw new Error('Не удалось извлечь конфигурацию игры');
        }

        return config;
    }

    /**
     * Получение данных реплея через API
     * @param {string} replayUrl - URL реплея
     * @returns {Object} Данные реплея (init + log)
     */
    async getReplayData(replayUrl) {
        const config = await this.extractGameConfig(replayUrl);

        // Формируем URL для запроса данных реплея
        const apiUrl = `${config.replaySystemUrl}${config.replaySystemContextPath}/api/replay/data`;
        const params = new URLSearchParams({
            token: config.mgckey,
            roundID: config.replayRoundId,
            envID: config.environmentId || '100'
        });

        const fullUrl = `${apiUrl}?${params.toString()}`;
        console.log(`📡 Запрос к API: ${fullUrl}`);

        const response = await this.page.evaluate(async (url) => {
            const res = await fetch(url);
            return await res.json();
        }, fullUrl);

        console.log('✅ Данные реплея получены');
        console.log(`   - Символ игры: ${config.symbol}`);
        console.log(`   - Round ID: ${config.replayRoundId}`);
        console.log(`   - Количество действий: ${response.log ? response.log.length : 0}`);

        return {
            config,
            apiUrl: fullUrl,
            data: response
        };
    }

    /**
     * Получение метаданных игры
     * @param {Object} config - Конфигурация игры
     * @returns {Object} Метаданные игры (правила, математика)
     */
    async getGameMetadata(config) {
        const gameJsonUrl = `${config.gameLoadUrl}/client/game.json`;
        console.log(`📋 Получение метаданных: ${gameJsonUrl}`);

        const metadata = await this.page.evaluate(async (url) => {
            try {
                const res = await fetch(url);
                return await res.json();
            } catch (e) {
                return { error: e.message };
            }
        }, gameJsonUrl);

        return metadata;
    }

    /**
     * Получение ресурсов игры
     * @param {Object} config - Конфигурация игры
     * @returns {Object} Список ресурсов (спрайты, звуки и т.д.)
     */
    async getGameResources(config) {
        const resourcesUrl = `${config.gameLoadUrl}/client/resources.json`;
        console.log(`🎨 Получение ресурсов: ${resourcesUrl}`);

        const resources = await this.page.evaluate(async (url) => {
            try {
                const res = await fetch(url);
                return await res.json();
            } catch (e) {
                return { error: e.message };
            }
        }, resourcesUrl);

        return resources;
    }

    /**
     * Получение всех доступных данных для реплея
     * @param {string} replayUrl - URL реплея
     * @returns {Object} Полные данные реплея
     */
    async getFullReplayInfo(replayUrl) {
        const replayData = await this.getReplayData(replayUrl);
        const metadata = await this.getGameMetadata(replayData.config);
        const resources = await this.getGameResources(replayData.config);

        return {
            ...replayData,
            metadata,
            resources
        };
    }

    /**
     * Закрытие браузера
     */
    async close() {
        if (this.browser) {
            await this.browser.close();
        }
    }
}

/**
 * Пример использования
 */
async function main() {
    const api = new PragmaticPlayAPI();

    try {
        await api.init();

        // Пример 1: Получение только данных реплея
        console.log('\n=== ПРИМЕР 1: Получение данных реплея ===');
        const replayUrl = 'https://www.pplink.social/ATuDxqTOJj';
        const replayData = await api.getReplayData(replayUrl);

        // Сохраняем данные
        await fs.writeFile(
            'replay_data.json',
            JSON.stringify(replayData, null, 2),
            'utf-8'
        );
        console.log('💾 Данные сохранены в replay_data.json');

        // Пример 2: Получение полной информации
        console.log('\n=== ПРИМЕР 2: Получение полной информации ===');
        const fullInfo = await api.getFullReplayInfo(replayUrl);

        await fs.writeFile(
            'full_replay_info.json',
            JSON.stringify(fullInfo, null, 2),
            'utf-8'
        );
        console.log('💾 Полная информация сохранена в full_replay_info.json');

        // Пример 3: Обработка нескольких реплеев из JSON
        console.log('\n=== ПРИМЕР 3: Обработка списка реплеев ===');
        const winsData = JSON.parse(
            await fs.readFile('pragmatic_play_wins.json', 'utf-8')
        );

        const results = [];

        // Обрабатываем первые 3 реплея для примера
        for (let i = 0; i < Math.min(3, winsData.length); i++) {
            const win = winsData[i];
            console.log(`\n📊 Обработка ${i + 1}/${Math.min(3, winsData.length)}: ${win.title}`);

            try {
                const data = await api.getReplayData(win.replayUrl);
                results.push({
                    title: win.title,
                    multiplier: win.multiplier,
                    replayUrl: win.replayUrl,
                    apiUrl: data.apiUrl,
                    gameSymbol: data.config.symbol,
                    roundId: data.config.replayRoundId,
                    spinsCount: data.data.log ? data.data.log.length : 0
                });
            } catch (error) {
                console.error(`❌ Ошибка при обработке ${win.title}:`, error.message);
                results.push({
                    title: win.title,
                    replayUrl: win.replayUrl,
                    error: error.message
                });
            }
        }

        await fs.writeFile(
            'batch_replay_analysis.json',
            JSON.stringify(results, null, 2),
            'utf-8'
        );
        console.log('\n💾 Результаты пакетной обработки сохранены в batch_replay_analysis.json');

    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await api.close();
    }
}

// Запуск если файл вызван напрямую
if (require.main === module) {
    main();
}

module.exports = PragmaticPlayAPI;
