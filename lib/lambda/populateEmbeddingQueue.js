/*
  NOT IN USE ANYMORE
*/

const AWS = require('aws-sdk');
const { SQSClient, SendMessageBatchCommand } = require("@aws-sdk/client-sqs");
const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb")
const sqs = new SQSClient();
const dynamo = new DynamoDBClient({ region: "us-east-1" });
const COUNT_TOKENS = false;
const { getEncoding, getEncodingNameForModel } = require("js-tiktoken");

// Count tokens by counting the length of the list returned by .encode()
function getTokenCount(item) {
  const encoder = getEncoding("cl100k_base");
  const toEncode = {...item};
  delete toEncode.url;
  const tokens = encoder.encode((toEncode).toString());
  return tokens.length;
}

async function getEmbedding() {
  // make a request to openapi
}

async function saveEmbedding() {
  // TODO: write to psql table
}


/*
   calculate the total token count & add to queue
*/
exports.handler = async (event) => {
  try {

    // read full perfume table
    let keepReading = true;
    let lastEvaluatedKey = "";
    let token_count = 0;

    while(keepReading) {
      const input = {
        TableName: process.env.PERFUME_TABLE_NAME,
        AttributesToGet: ["url", "title", "date_scraped", "description", "notes", "reviews"],
        ...lastEvaluatedKey && ({ExclusiveStartKey: lastEvaluatedKey})
      }
      
      const res = await dynamo.send(new ScanCommand(input));
      
      console.log("Scan returned", res.Count, "items");
      //console.log("Sample Item: ", res.Items[0])

      const items = res.Items.filter(i => ( 
        (i.date_scraped.S !== "") &&
        (i.description.S !== "") &&
        (i.notes.L.length !== 0)
      )).map(i => ({
          "url": i.url.S,
          "title": i.title.S,
          "description": i.description.S,
          "notes": i.notes.L.map(n => (n.S)),
          "reviews": i.reviews.L.map(r => (r.S))
        })
      );
      
      if(COUNT_TOKENS) {
        items.forEach(item => token_count += getTokenCount(item));
        console.log("Current token count:", token_count);
      }

      for(let i=0; i < items.length; i += 10) {
        const message = new SendMessageBatchCommand({
          QueueUrl: process.env.EMBEDDING_QUEUE_URL,
          Entries: items.slice(i, i+10).map((item, n) => ({Id: (i*10 + n).toString(), MessageBody: item.url}))
        });
  
        const sqsRes = await sqs.send(message);
        console.log(sqsRes);
      }

      lastEvaluatedKey = res.LastEvaluatedKey;

      if(!lastEvaluatedKey) {
        keepReading = false;
      }
    }
  } 
  
  catch (e) {
    console.log("HUH?: ", e);
    process.exit(1);
  }
}
