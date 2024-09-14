/*
  runs locally in headful mode without docker
*/
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const puppeteer = require("puppeteer-extra");
puppeteer.use(StealthPlugin());


async function scrapePage(page, url) {

  await page.goto(url, {timeout: 0, waitUntil: "networkidle2" });
  page.waitForTimeout(5000);
  
  await page.bringToFront();
  await page.content();

  for (let i = 0; i < 200; i++) {     // simulate human scroll
    await page.mouse.move(100, 100);
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(101);
  }

  const title = await page.$eval('h1[itemprop="name"]', (element) =>
    element.textContent.trim()
  );

  const description = await page.$eval('[itemprop="description"]', (element) =>
    element.querySelector("p").textContent.trim()
  );

  const notes = await page.$$eval(
    "a[href^='https://www.fragrantica.com/notes/']",
    (elements) => elements.map((e) => e.parentElement.textContent.trim())
  );

  let reviews = [];

  try {
    await page.waitForSelector('div[itemprop="reviewBody"]', { timeout: 10000 });
    reviews = await page.$$eval('div[itemprop="reviewBody"]', (elements) =>
      elements.map((e) => e.textContent.trim())
    );
  } catch(e) {
    console.log("No reviews.");
  }

  return [title, description, notes, reviews];
}

async function main(url) {

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

  await page.setUserAgent(
    "Mozilla/5.0 (Linux; Android 7.0; SAMSUNG SM-T819Y) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/10.2 Chrome/71.0.3578.99 Safari/537.36"
  );

  try {
    await page.setViewport({
      width: Math.round(Math.random() * (1000 - 400) + 400),
      height: Math.round(Math.random() * (720 - 400) + 400),
      deviceScaleFactor: 1,
    });

    const [title, description, notes, reviews] = await scrapePage(page, url);
    await browser.close();

    return {title, description, notes, reviews}

  } catch (error) {
    console.error(`Error scraping URL: ${url}`, error);
  }
}


async function testLocally() {
  console.log(await main("https://www.fragrantica.com/perfume/Tom-Ford/Noir-Extreme-29675.html"))
}

// comment out the waiting periods
async function demonstrateTimeout() {
  console.log(await main("https://www.fragrantica.com/perfume/Tom-Ford/Noir-Extreme-29675.html"))
  console.log(await main("https://fragrantica.com/perfume/Guerlain/Vanille-Planifolia-Extrait-21-87539.html"))
  console.log(await main("https://www.fragrantica.com/perfume/Zoologist-Perfumes/Panda-28190.html"))
  console.log(await main("https://www.fragrantica.com/perfume/Montale/Velvet-Fantasy-59891.html"))
}

testLocally();
//demonstrateTimeout();