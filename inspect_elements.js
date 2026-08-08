
const puppeteer = require('puppeteer');
require('dotenv').config();

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(process.env.CONSTATIMMO_URL, { waitUntil: 'networkidle2' });
    
    // Debug: check current page content if login fails
    const body = await page.evaluate(() => document.body.innerText);
    if (body.includes('Connexion') || body.includes('Username')) {
       // Try generic selectors if specific ones fail
       const inputs = await page.$input;
       // Fill based on type or name if possible
    }

    // Use current working login logic from original script as much as possible
    await page.type('#sign_in > div:nth-child(1) > div > input', process.env.CONSTATIMMO_USERNAME).catch(() => {});
    await page.type('#sign_in > div:nth-child(2) > div > input', process.env.CONSTATIMMO_PASSWORD).catch(() => {});
    await page.click('#sign_in > div:nth-child(3) > div.col-xs-4 > button').catch(() => {});
    
    // Wait for main page
    await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
    
    // Re-check for drawer button
    await page.waitForSelector('button[aria-label="open drawer"]', { timeout: 15000 });
    await page.click('button[aria-label="open drawer"]');
    await page.waitForTimeout(1000);

    const [monActivite] = await page.$x("//*[normalize-space(text())='Mon activité']");
    if (monActivite) {
        const maParent = await monActivite.evaluateHandle(n => n.closest('a, li, div') || n);
        await maParent.click();
        await page.waitForTimeout(1000);
    }

    const [mesDispos] = await page.$x("//*[normalize-space(text())='Mes disponibilités']");
    if (mesDispos) {
        const mdParent = await mesDispos.evaluateHandle(n => n.closest('a, li, div') || n);
        await mdParent.click();
        await page.waitForTimeout(5000);
    }

    // Screenshot for manual verification if possible, but here we output info
    const elementsInfo = await page.evaluate(() => {
      const allElements = Array.from(document.querySelectorAll('*'));
      return allElements
        .filter(el => {
          const style = window.getComputedStyle(el);
          const bg = style.backgroundColor;
          const isViolet = bg.includes('103, 58, 183') || bg.includes('123, 31, 162') || bg.includes('156, 39, 176');
          const isFcEvent = el.className && typeof el.className === 'string' && (el.className.includes('fc-event') || el.className.includes('event'));
          return isViolet || isFcEvent;
        })
        .map(el => ({
          tagName: el.tagName,
          className: el.className,
          style: el.getAttribute('style'),
          computedBg: window.getComputedStyle(el).backgroundColor,
          text: el.innerText ? el.innerText.substring(0, 50).replace(/\s+/g, ' ') : ''
        }));
    });
    console.log('ELEMENTS_FOUND:' + JSON.stringify(elementsInfo, null, 2));
  } catch (e) {
    console.error('ERROR:' + e.message);
    const content = await page.content();
    console.log('PAGE_CONTENT_SUMMARY:' + content.substring(0, 1000));
  } finally {
    await browser.close();
  }
})();
