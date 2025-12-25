const puppeteer = require('puppeteer');
const fs = require('fs');

const TARGET_URL = 'https://www.bigwinboard.com/community-big-wins/';
const OUTPUT_FILE = 'wins.json';

// Get excluded providers from command line arguments
// Usage: node scraper.js "Provider 1" "Provider 2" ...
// Default: "Nolimit City" if no arguments provided
const EXCLUDED_PROVIDERS = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : ['Nolimit City'];

// Extract wins from current page
async function extractWinsFromPage(page, excludedProviders) {
  return await page.evaluate((excluded) => {
    const cards = document.querySelectorAll('.bwb-card');
    const results = [];

    cards.forEach(card => {
      const titleEl = card.querySelector('.bwb-title');
      const providerEl = card.querySelector('.bwb-provider');
      const multiplierEl = card.querySelector('.bwb-xbet');
      const dateEl = card.querySelector('.bwb-time');

      const provider = providerEl?.innerText?.trim() || '';

      // Filter out excluded providers
      if (excluded.includes(provider)) {
        return;
      }

      results.push({
        title: titleEl?.innerText?.trim() || '',
        provider: provider,
        multiplier: multiplierEl?.innerText?.trim() || '',
        date: dateEl?.innerText?.trim() || '',
        link: titleEl?.getAttribute('href') || '',
        id: card.getAttribute('data-pid') || ''
      });
    });

    return results;
  }, excludedProviders);
}

// Check if there's a next page and get its URL
async function getNextPageUrl(page) {
  return await page.evaluate(() => {
    // Look for pagination - find current page and next link
    const paginationLinks = document.querySelectorAll('.pagination a, .bwb-pagination a, a[href*="pg="]');
    const currentPage = document.querySelector('.pagination .current, .bwb-pagination .current, .current-page');

    // Try to find next page link
    for (const link of paginationLinks) {
      const href = link.getAttribute('href');
      if (href && href.includes('pg=')) {
        const match = href.match(/pg=(\d+)/);
        if (match) {
          const pageNum = parseInt(match[1]);
          // Check if this is likely the next page
          const currentMatch = window.location.href.match(/pg=(\d+)/);
          const currentPageNum = currentMatch ? parseInt(currentMatch[1]) : 1;

          if (pageNum === currentPageNum + 1) {
            return href;
          }
        }
      }
    }

    // Alternative: look for "next" or ">" button
    const nextBtn = document.querySelector('a.next, a[rel="next"], .pagination-next a');
    if (nextBtn) {
      return nextBtn.getAttribute('href');
    }

    return null;
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

    // Set a realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    let allWins = [];
    let currentUrl = TARGET_URL;
    let pageNum = 1;
    const MAX_PAGES = 50; // Safety limit

    while (currentUrl && pageNum <= MAX_PAGES) {
      console.log(`\n📄 Page ${pageNum}: ${currentUrl}`);

      await page.goto(currentUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Wait for cards to load
      try {
        await page.waitForSelector('.bwb-card', { timeout: 10000 });
      } catch (e) {
        console.log('No cards found on this page, stopping pagination.');
        break;
      }

      // Extract wins from current page
      const wins = await extractWinsFromPage(page, EXCLUDED_PROVIDERS);
      console.log(`   Found ${wins.length} wins on this page`);

      allWins = allWins.concat(wins);

      // Check for next page
      const nextUrl = await getNextPageUrl(page);

      if (nextUrl && nextUrl !== currentUrl) {
        // Make sure URL is absolute
        currentUrl = nextUrl.startsWith('http')
          ? nextUrl
          : new URL(nextUrl, page.url()).href;
        pageNum++;

        // Small delay to be respectful to the server
        await new Promise(r => setTimeout(r, 1000));
      } else {
        console.log('\n✅ No more pages found.');
        break;
      }
    }

    console.log(`\n📊 Total: ${allWins.length} wins from ${pageNum} pages (filtered out: ${EXCLUDED_PROVIDERS.join(', ')})`);

    // Save to JSON file
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

// Run the scraper
scrapeWins()
  .then(wins => {
    console.log('\n--- Sample Results ---');
    wins.slice(0, 3).forEach((win, i) => {
      console.log(`\n[${i + 1}] ${win.title}`);
      console.log(`    Provider: ${win.provider}`);
      console.log(`    Multiplier: ${win.multiplier}`);
      console.log(`    Date: ${win.date}`);
    });
  })
  .catch(err => {
    console.error('Scraping failed:', err);
    process.exit(1);
  });
