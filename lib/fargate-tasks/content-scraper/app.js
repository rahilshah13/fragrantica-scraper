/*
  Requires PERFUME_QUEUE_URL and PERFUME_TABLE_NAME environment variables
  If it sees 0 msgs in the Perfume Queue, kill the task
*/
const AWS = require('aws-sdk');
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { SQSClient, DeleteMessageCommand, ReceiveMessageCommand} = require("@aws-sdk/client-sqs");
const { ECSClient, UpdateServiceCommand } = require("@aws-sdk/client-ecs")
const puppeteer = require("puppeteer-extra");
puppeteer.use(StealthPlugin());

const dynamo = new AWS.DynamoDB.DocumentClient();
const ecs = new ECSClient({ region: "us-east-1" });
const sqs = new SQSClient();
const getMsg = new ReceiveMessageCommand({
  QueueUrl: process.env.PERFUME_QUEUE_URL,
  MaxNumberOfMessages: 10
});

const DEV_MODE = false;
// async function testLocally() {
//   console.log(await main("https://www.fragrantica.com/perfume/Tom-Ford/Noir-Extreme-29675.html"))
// }
// testLocally();

async function writeContent(url, data) {
  const {title, description, notes, reviews} = data;

  console.log("attempting write to dynamo");

  const params = {
    TableName: process.env.PERFUME_TABLE_NAME, 
    Key: {"url": url},
    UpdateExpression: `set title = :title, date_scraped = :date_scraped, description = :description, notes = :notes, reviews = :reviews`,
    ExpressionAttributeValues: {
      ":title": title,
      ":date_scraped": (new Date()).toISOString(),
      ":description": description,
      ":notes": notes,
      ":reviews": reviews
    },
  }

  dynamo.update(params, async (err, data) => { if(err){ console.log(err) } else { console.log("added")} });
}

async function scrapePage(page, url) {

  await page.goto(url, {timeout: 0, waitUntil: "networkidle2" });
  page.waitForTimeout(5000);
  
  await page.bringToFront();
  await page.content();

  for (let i = 0; i < 200; i++) {
    // simulate human scroll
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
    headless: "new",
    executablePath: DEV_MODE ? "" : "/usr/bin/google-chrome",
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

(async () => { 
  try {

    let res = await sqs.send(getMsg);
    
    // TODO: evidently, this does not work- fix before next collection
    if(!res.Messages || res.Messages.length === 0) {
      await ecs.send(new UpdateServiceCommand({
        cluster: process.env.ECS_CLUSTER_NAME,
        service: process.env.ECS_SERVICE_NAME,
        desiredCount: 0
      }));
      console.log("no perfumes urls to scrape!");
      process.exit(1);
    }

    res.Messages.forEach(async (m) => {
      const data = await main(m.Body);

      if(!data) {
        console.log("NO DATA!")
        return;
      }

      if (!("title" in data) || !("description" in data)) {
        console.log(m.Body, "missing metadata.")
        return;
      }

      console.log(data.title, "notes:", data.notes.length, "reviews:", data.reviews.length);

      const delMsg = new DeleteMessageCommand({
        QueueUrl: process.env.PERFUME_QUEUE_URL,
        ReceiptHandle: m.ReceiptHandle
      });

      await writeContent(m.Body, data);
      await sqs.send(delMsg);
    });

  } catch(e) {
    console.log(e);
    process.exit(1);
  }
})();