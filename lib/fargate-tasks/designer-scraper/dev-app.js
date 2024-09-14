const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const puppeteer = require("puppeteer-extra");
puppeteer.use(StealthPlugin());

const TOTAL_PAGES = 11;

/* 
  We retrieve the next page to scrape if it exists
  Each pass of the loop reads a page of fragrantica's designers and writes the urls to dynamo
  The # of the last scraped page is saved to dynamo as well 
*/
async function main(starting_page) {
  try {
    const UAstr = "Mozilla/5.0 (Linux; Android 7.0; SAMSUNG SM-T819Y) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/10.2 Chrome/71.0.3578.99 Safari/537.36"
    let base_url = "https://www.fragrantica.com/";
    let designer_urls = [];

    for (let i = starting_page; i < TOTAL_PAGES; i++) {
      const browser = await puppeteer.launch({
        headless: false,
        executablePath: "",
        args: [
          "--no-sandbox",
          "--no-zygote",
          "--disable-gpu",
        ],
        timeout: 0
      });

      const page = await browser.newPage();
      await page.setUserAgent(UAstr);
      await page.setViewport({
        width: Math.round(Math.random() * (1000 - 400) + 400), 
        height: Math.round(Math.random() * (720 - 400) + 400), deviceScaleFactor: 1
      });

      const letter_url = base_url+`designers-${i+1}/`;
      designer_urls = await getDesignerUrls(page, letter_url);

      if(designer_urls.length === 0) {
        console.log("No urls scraped.");
        return;
      }

      await browser.close();

      console.log(
        `page: ${i + 1}\n`, 
        `urls: ${designer_urls.length}\n`, 
        `last scraped: ${designer_urls[designer_urls.length -1]}`
      );
    }
    return designer_urls;
  } catch (error) {
    console.error(`Error scraping URL:`, error);
  }
}

async function getDesignerUrls(page, url) {
  await page.goto(url, { waitUntil: "networkidle2" });
  await page.waitForTimeout(1000);
  await page.bringToFront();
  await page.content();

  for (let i = 0; i < 50; i++) {     // simulate human scroll
    await page.mouse.move(100, 100);
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(500);
  }

  const designers = await page.$$eval(
    "a[href^='/designers/']",
    (elements) => elements.map((e) => e.href.trim())
  );

  return designers;
}

(async () => await main(0))();