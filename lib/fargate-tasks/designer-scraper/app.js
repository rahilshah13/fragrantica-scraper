const AWS = require('aws-sdk');
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const puppeteer = require("puppeteer-extra");
puppeteer.use(StealthPlugin());

const isDev = process.env.NODE_ENV === "dev";
const isDd = process.env.NODE_ENV === "dd";
const TOTAL_PAGES = 11;
const dynamo = new AWS.DynamoDB.DocumentClient();

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
        headless: isDev ? false : "new",
        executablePath: (isDev && !isDd) ? "" : "/usr/bin/google-chrome",
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

      await writeUrls(designer_urls);
      await updatePage(i);
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

async function getPageNumber() {
  const params = { TableName: process.env.DESIGNER_PAGE_TABLE_NAME, Key: { PageId: 'page_number' } };
  try {
    const result = await dynamo.get(params).promise();
    if (result.Item) {
      return result.Item.PageValue; // attribute storing the page number
    } else {
      return 0; // Default value if the item doesn't exist
    }
  } catch (error) {
    console.error('Error reading page number:', error);
  }
}

async function writeUrls(designer_urls) {
  
  console.log("attempting write to dynamo")

  designer_urls.forEach(async(url) => {

    // check to see if desginer url's already scraped; not robust, but works for now
    const already_exists = await dynamo.get({
      TableName: process.env.DESIGNER_TABLE_NAME, 
      Key: { "url": url } 
    }).promise();

    if(already_exists.Item && already_exists.Item.n_perfumes > 0) {
      console.log("already scraped ", url);
      return;
    }

    const putParams = {
      TableName: process.env.DESIGNER_TABLE_NAME, 
      Item: {
        "designer": "", 
        "url": url, 
        "perfume_urls": [], 
        "date_scraped": (new Date()).toString(), 
        "n_perfumes": 0
      }
    }

    dynamo.put(putParams, async (err, data) => { if(err) console.log(err) });
  });
}

async function updatePage(page_num) {
  const params = {
    TableName: process.env.DESIGNER_PAGE_TABLE_NAME,
    Item: {PageId: "page_number", PageValue: (page_num + 1) % 11}
  }
  dynamo.put(params, async (err, data) => { if(err) console.log(err) });
}

(async () => {
  starting_page = await getPageNumber();
  await main(starting_page);
})();