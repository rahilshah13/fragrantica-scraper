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

let DEV_MODE = false;
const dynamo = new AWS.DynamoDB.DocumentClient();
const ecs = new ECSClient({ region: "us-east-1" });
const sqs = new SQSClient();
const getMsg = new ReceiveMessageCommand({
  QueueUrl: process.env.PERFUME_QUEUE_URL,
  MaxNumberOfMessages: 10
});


//
// DEV_MODE = true;
// async function testLocally() {
//   test_urls = ["https://www.fragrantica.com/perfume/Tom-Ford/Noir-Extreme-29675.html", "https://www.fragrantica.com/perfume/Maison-Yusif/Scent-of-A-Queen-84918.html", "https://www.fragrantica.com/perfume/Dior/Miss-Dior-Blooming-Bouquet-23280.html", "https://www.fragrantica.com/perfume/Maison-Yusif/So-Much-Fun-84916.html", "https://www.fragrantica.com/perfume/By-Kilian/Love-Don-t-Be-Shy-4322.html", "https://www.fragrantica.com/perfume/Maison-Yusif/Deeper-Than-Words-84913.html", "https://www.fragrantica.com/perfume/Parfums-Vintage/Emperor-Extrait-52968.html", "https://www.fragrantica.com/perfume/Plume-Impression/Royal-Bourbon-80477.html"]
//   for(let i=0; i < 7; i++) {
//     await main(test_urls[i]);
//   }
// }

// (() => testLocally())();
//

async function writeContent(url, data) {
  const { rating } = data;

  console.log("attempting write to dynamo");

  const params = {
    TableName: process.env.PERFUME_TABLE_NAME, 
    Key: {"url": url},
    UpdateExpression: `set rating = :rating`,
    ExpressionAttributeValues: {":rating": rating}
  }

  dynamo.update(params, async (err, data) => { if(err){ console.log(err) } else { console.log("added")} });
}

async function scrapePage(page, url) {
  await page.goto(url, {timeout: 0, waitUntil: "networkidle2" });
  page.waitForTimeout(10000);
  await page.bringToFront();
  await page.content();
  
  for (let i = 0; i < 50; i++) {
    // simulate human scroll
    await page.mouse.move(100, 100);
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(101);
  }

  let rating = 0;

  try {
    rating = await page.$eval('span[itemprop="ratingValue"]', (element) =>
      element.textContent.trim()
    )
  } catch(e) {
    console.log("No ratings given!")
  }


  return [Number(rating)];
}

async function main(url) {
  console.log(url)
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

    const [rating] = await scrapePage(page, url);
    console.log(rating);
    await browser.close();

    return {rating}

  } catch (error) {
    console.error(`Error scraping URL: ${url}`, error);
  }

}


if(!DEV_MODE) {

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

        console.log("rating: ", data.rating);

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
}
