const { ECSClient, UpdateServiceCommand } = require("@aws-sdk/client-ecs");
const { SQSClient, SendMessageBatchCommand } = require("@aws-sdk/client-sqs");
const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb")
const MAX_CONCURRENT_FARGATE_VCPU = 5;


const sqs = new SQSClient();
const ecs = new ECSClient({ region: "us-east-1" });
const dynamo = new DynamoDBClient({ region: "us-east-1" });

/*
  Conduct a full table scan- if the last_scraped date doesn't exist 
  then add it 
*/
exports.handler = async (event) => {
  try {
    // read full perfume table
    let keepReading = true;
    let lastEvaluatedKey = "";

    while(keepReading) {
      const input = {
        TableName: process.env.PERFUME_TABLE_NAME,
        AttributesToGet: ["url", "date_scraped"],
        ...lastEvaluatedKey && ({ExclusiveStartKey: lastEvaluatedKey})
      }
      
      const res = await dynamo.send(new ScanCommand(input));
      
      console.log("Scan returned", res.Count, "items");
      console.log("Sample Item: ", res.Items[0])

      // COMMENT OUT LINE IF WE WANT TO REPROCESS EVERY 
      let items = res.Items;

      if(!event.onlyUpdateRatings) {
        items = res.Items.filter(i => (i.date_scraped.S === ""));
      }

      console.log("n items:", items.length)

      for(let i=0; i < items.length; i += 10) {

        const message = new SendMessageBatchCommand({
          QueueUrl: process.env.PERFUME_QUEUE_URL,
          Entries: items.slice(i, i+10).map((item, n) => ({Id: (i*10 + n).toString(), MessageBody: item.url.S}))
        });
  
        const sqsRes = await sqs.send(message);
        console.log(sqsRes);
      }

      lastEvaluatedKey = res.LastEvaluatedKey;

      if(!lastEvaluatedKey) {
        keepReading = false;
      }
    }

    await ecs.send(new UpdateServiceCommand({
      cluster: process.env.ECS_CLUSTER_NAME,
      service: event.onlyUpdateRatings ? process.env.ECS_RATING_SERVICE_NAME : process.env.ECS_SERVICE_NAME,
      desiredCount: MAX_CONCURRENT_FARGATE_VCPU
    }));
  } 
  
  catch (e) {
    console.log("HUH?: ", e);
    process.exit(1);
  }
}

/* EVENT OBJECT
  { onlyUpdateRatings: true | false }
*/