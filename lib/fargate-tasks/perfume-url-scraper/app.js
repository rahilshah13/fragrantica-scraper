const AWS = require('aws-sdk');
//const { UpdateCommand } = require('@aws-sdk/lib-dynamodb')
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const puppeteer = require("puppeteer-extra");
const { SQSClient, DeleteMessageCommand, ReceiveMessageCommand} = require("@aws-sdk/client-sqs");
puppeteer.use(StealthPlugin());

const dynamo = new AWS.DynamoDB.DocumentClient();
const sqs = new SQSClient()

async function getPerfumeUrls(page, url) {
  await page.goto(url, { waitUntil: "networkidle2" });
  await page.waitForTimeout(3000);
  await page.bringToFront();
  await page.content();

  for (let i = 0; i < 100; i++) { // simulate human scroll
    await page.mouse.move(100, 100);
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(300);
  }

  const parts = url.split('/');
  const lastPart = parts[parts.length - 1]; // Get the last part of the URL
  const designer_str = lastPart.split('.html')[0]; 

  const designer = await page.$eval("h1",e => e.textContent.trim());
  const perfumes = await page.$$eval(`a[href^='/perfume/${designer_str}']`, (e) => e.map(e => e.href.trim()));

  return [designer, perfumes]
}

async function main(designer_url) {

  try {

    const UAstr = "Mozilla/5.0 (Linux; Android 7.0; SAMSUNG SM-T819Y) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/10.2 Chrome/71.0.3578.99 Safari/537.36";

    const browser = await puppeteer.launch({
      headless: "new",
      executablePath: "/usr/bin/google-chrome",
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

    const [designer, perfumes] = await getPerfumeUrls(page, designer_url);

    if(perfumes.length === 0) 
      return false;

    await writeUrls(designer_url, designer, perfumes);
    await browser.close();

    console.log(
      `urls: ${perfumes.length}\n`, 
      `last scraped: ${perfumes[perfumes.length -1]}`
    );

    return true;

  } catch (error) {
    console.error(`Error scraping URL:`, error);
  }
}

/*
  - Update the designer name field of Designer Table entry
  - Add Perfume entry to Perfume Table 
*/
async function writeUrls(designer_url, designer, perfumes) {
  
  console.log("attempting write to dynamo");

  const updateDesigner = {
    TableName: process.env.DESIGNER_TABLE_NAME,
    Key: { url: designer_url },
    UpdateExpression: "set designer = :designer, n_perfumes = :n",
    ExpressionAttributeValues: {":designer": designer, ":n": perfumes.length},
    ReturnValues: "ALL_NEW",
  };

  dynamo.update(updateDesigner, (err, data) => { if(err) console.log(err) });

  perfumes.forEach(async(p) => {

    const params = {
      TableName: process.env.PERFUME_TABLE_NAME, 
      Item: {"designer": designer.toLowerCase().trim(), "url": p, description: "", notes: [], reviews: [], date_scraped: ""}
    }

    dynamo.put(params, async (err, data) => { if(err) console.log(err) });
  });

  console.log(designer, "\nperfumes: ", perfumes.length);
}


(async () => { 
  try {

    const getMsg = new ReceiveMessageCommand({
      QueueUrl: process.env.DESIGNER_QUEUE_URL,
      MaxNumberOfMessages: 1
    });

    let res = await sqs.send(getMsg);

    while(res.Messages.length != 0) {
      
      const success = await main(res.Messages[0].Body);

      if(!success) 
        process.exit(1);

      const delMsg = new DeleteMessageCommand({
        QueueUrl: process.env.DESIGNER_QUEUE_URL,
        ReceiptHandle: res.Messages[0].ReceiptHandle
      });

      await sqs.send(delMsg);
      res = await sqs.send(getMsg);
                   
    }

  } catch(e) {
    console.log(e);
    process.exit(1);
  }
})();