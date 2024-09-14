const AWS = require('aws-sdk');
const { SQSClient, SendMessageCommand, GetQueueAttributesCommand } = require("@aws-sdk/client-sqs");
const { ListTasksCommand, RunTaskCommand, ECSClient } = require("@aws-sdk/client-ecs")
const sqsClient = new SQSClient();
const MAX_CONCURRENT_FARGATE_VCPU = 140;
const ecs = new ECSClient({ region: "us-east-1" });


function logarithmicScale(input) {
  // Map the input range (1 to 13000) to the output range (1 to 140)
  const scaledOutput = 10 * (Math.log(input) / Math.log(Math.E));
  console.log("scaled output: ", scaledOutput)
  // Ensure the output is within the desired range (1 to 140)
  return Math.min(MAX_CONCURRENT_FARGATE_VCPU, scaledOutput);
}

// Example usage:
const input = 6500; // Replace with your input value
const scaledValue = logarithmicScale(input);
console.log(scaledValue)

exports.handler = async (event) => {
  try {

      // add designer urls to sqs
      console.log("Records", event.Records.length);

      event.Records.forEach(async (r) => {
        const url = r.dynamodb.Keys.url.S;
        const message = new SendMessageCommand({
          QueueUrl: process.env.DESIGNER_QUEUE_URL,
          MessageBody: url,
        });

        await sqsClient.send(message);
      });

      const listTasksParams = {
        cluster: process.env.ECS_CLUSTER_NAME,
        family: process.env.PERFUME_TASK_FAMILY,
        desiredStatus: "RUNNING" || "PENDING",
      };

      const listTasksRes = await ecs.send(new ListTasksCommand(listTasksParams))
      const sqsRes = await sqsClient.send(new GetQueueAttributesCommand({
        QueueUrl: process.env.DESIGNER_QUEUE_URL,
        AttributeNames: ["ApproximateNumberOfMessages"]
      }))

      const n_msgs = parseInt(sqsRes.Attributes["ApproximateNumberOfMessages"]);
      const curr_tasks = listTasksRes.taskArns.length;
      const tasks_needed = logarithmicScale(n_msgs) - curr_tasks;

      if(tasks_needed < 0) {
        console.log("no need to start more tasks\nN Msgs: ", n_msgs, "\n", "N tasks: ", curr_tasks)
        return;
      }

      const runTaskParams = {
        cluster: process.env.ECS_CLUSTER_NAME,
        taskDefinition: process.env.TASK_DEFINITION,
        launchType: 'FARGATE',
        networkConfiguration: { 
          awsvpcConfiguration: { 
            subnets: [ process.env.PUB_SUBNET_1, process.env.PUB_SUBNET_2 ],
            assignPublicIp: "ENABLED"
          }
        },
        overrides: {
          containerOverrides: [
            {
              name: 'PerfumeUrlScraper', 
              // environment: [{}],
            },
          ],
        },
      };

      // start fargate tasks runTasks will fail after batch 1      
      for(let i=0; i < tasks_needed; i++) {
        const res = await ecs.send(new RunTaskCommand(runTaskParams));

        if(res.failures.length > 0)
          console.log("TASK FAILED: ", res.failures);
        else
          console.log("TASK STARTED: ", i, "\n", res);
      }

  } catch (e) {
    console.log("Error: ", e)
  }
}

/* LAMBDA TEST OBJ
{
  "Records": [
    {
      "dynamodb": {
        "Keys": {
          "url": {
            "S": "https://www.fragrantica.com/designers/Ariana-Grande.html"
          }
        }
      }
    }
  ]
}
*/