const puppeteer = require('puppeteer');
const fs = require('fs');

const TARGET_URL = 'https://www.bigwinboard.com/community-big-wins/';
const OUTPUT_FILE = 'pragmatic_play_wins.json';

// Включаем только Pragmatic Play
const INCLUDED_PROVIDER = 'Pragmatic Play';

// Extract wins from page - все данные в карточках!
async function extractWinsFromPage(page, includedProvider) {
  return await page.evaluate((included) => {
    const cards = document.querySelectorAll('article.bwb-card');
    const results = [];

    cards.forEach(card => {
      const titleEl = card.querySelector('.bwb-title');
      const providerEl = card.querySelector('.bwb-provider');
      const multiplierEl = card.querySelector('.bwb-xbet');
      const timeEl = card.querySelector('time.bwb-time');

      const provider = providerEl?.innerText?.trim() || '';

      // Включаем только указанного провайдера
      if (provider !== included) {
        return;
      }

      // Replay URL из атрибута data-embed
      const replayUrl = card.getAttribute('data-embed') || '';

      // Дата из атрибута datetime
      const releaseDate = timeEl?.getAttribute('datetime') || '';

      results.push({
        title: titleEl?.innerText?.trim() || '',
        provider: provider,
        multiplier: multiplierEl?.innerText?.trim() || '',
        replayUrl: replayUrl,
        releaseDate: releaseDate,
        pageUrl: titleEl?.getAttribute('href') || '',
        id: card.getAttribute('data-pid') || ''
      });
    });

    return results;
  }, includedProvider);
}

// Check if there's a next page
async function getNextPageUrl(page) {
  return await page.evaluate(() => {
    // Используем формат /page/N/
    const currentPath = window.location.pathname;
    const match = currentPath.match(/\/page\/(\d+)\/?/);
    const currentPageNum = match ? parseInt(match[1]) : 1;

    // Проверяем есть ли карточки на текущей странице
    const cards = document.querySelectorAll('.bwb-card');
    if (cards.length === 0) return null;

    // Следующая страница
    const nextPageNum = currentPageNum + 1;
    return `https://www.bigwinboard.com/community-big-wins/page/${nextPageNum}/`;
  });
}

async function scrapeWins() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    let allWins = [];
    let currentUrl = TARGET_URL;
    let pageNum = 1;
    const MAX_PAGES = 50;

    while (currentUrl && pageNum <= MAX_PAGES) {
      console.log(`\n📄 Page ${pageNum}: ${currentUrl}`);

      await page.goto(currentUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      try {
        await page.waitForSelector('.bwb-card', { timeout: 10000 });
      } catch (e) {
        console.log('No cards found on this page, stopping pagination.');
        break;
      }

      // Извлекаем все данные с карточек
      const wins = await extractWinsFromPage(page, INCLUDED_PROVIDER);
      console.log(`   Found ${wins.length} Pragmatic Play wins`);

      // Показываем результаты
      wins.forEach(w => {
        const replay = w.replayUrl ? '✓' : '✗';
        console.log(`     ${replay} ${w.title.substring(0, 35)} | ${w.multiplier} | ${w.releaseDate.split('T')[0]}`);
      });

      allWins = allWins.concat(wins);

      // Переходим к следующей странице
      pageNum++;
      currentUrl = `https://www.bigwinboard.com/community-big-wins/page/${pageNum}/`;

      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\n📊 Total: ${allWins.length} Pragmatic Play wins from ${pageNum - 1} pages`);

    // Фильтруем только с replay URL
    const winsWithReplay = allWins.filter(w => w.replayUrl);
    console.log(`🎮 Wins with replay URL: ${winsWithReplay.length}`);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allWins, null, 2), 'utf-8');
    console.log(`💾 Results saved to ${OUTPUT_FILE}`);

    return allWins;
  } catch (error) {
    console.error('Error during scraping:', error.message);
    throw error;
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }
}

scrapeWins()
  .then(wins => {
    console.log('\n--- Sample Results ---');
    wins.filter(w => w.replayUrl).slice(0, 5).forEach((win, i) => {
      console.log(`\n[${i + 1}] ${win.title}`);
      console.log(`    Provider: ${win.provider}`);
      console.log(`    Multiplier: ${win.multiplier}`);
      console.log(`    Release Date: ${win.releaseDate}`);
      console.log(`    Replay URL: ${win.replayUrl}`);
    });
  })
  .catch(err => {
    console.error('Scraping failed:', err);
    process.exit(1);
  });
