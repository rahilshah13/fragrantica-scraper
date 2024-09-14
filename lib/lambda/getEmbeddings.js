const AWS = require('aws-sdk');
const { DynamoDBClient, GetItemCommand } = require("@aws-sdk/client-dynamodb");
const dynamo = new DynamoDBClient({ region: "us-east-1" });
import { Client } from 'pg';

const host = process.env.DB_HOST;
const database = process.env.DB_NAME;

async function saveEmbedding(url, type, embedding, client) {

  try {
    const res = await client.query(
      `INSERT INTO embeddings (url, type, embedding) VALUES ($1, $2, $3)`, 
      [url, type, "["+embedding.map(n => (parseFloat(n))).toString()+"]"]
    );
    console.log(res);
  } catch(e) {
    console.log(e);
  }

}

async function getEmbedding(str) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    headers: {"Content-Type": "application/json", "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`},
    body: JSON.stringify({
      "input": str,
      "model": "text-embedding-ada-002"
    }),
    method: "POST"
  });

  return await res.json();
}


/*
  triggered by sqs
*/
exports.handler = async (event) => {
  try {

    const urls = event.Records.map(r => (r.body));
    const password =  process.env.DB_SECRET;

    const client = new Client({
      user: "postgres", password, host, database, port: 5432,
      ssl: { rejectUnauthorized: false}
    });

    await client.connect();
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    await client.query("CREATE TABLE IF NOT EXISTS embeddings (url TEXT, type TEXT, embedding vector(1536), PRIMARY KEY (url, type))");

    for(let i=0; i < urls.length; i++) {

      const params = new GetItemCommand({ 
        "TableName": process.env.PERFUME_TABLE_NAME, 
        "AttributesToGet": ["title", "description", "notes", "reviews"],
        "Key": { "url": {"S": urls[i] }}
      });

      const res = await dynamo.send(params);
      const item = res.Item;

      const data = {
        // "title": item.title.S,
        "description": item.description.S,
        "notes": item.notes.L.map(n => (n.S)),
        "reviews": item.reviews.L.map((r,i) => ({[`review-${i}`]: r.S}))
      };

      
      for(const [type, val] of Object.entries((data))) {
        const embedding = await getEmbedding(val.toString());
        console.log("success: ", embedding.data[0].embedding.length === 1536);
        console.log(i, type, val);
        console.log(embedding.data[0].embedding);
        await saveEmbedding(urls[i], type, embedding.data[0].embedding, client);
      }
    }
  }   
  
  catch (e) {
    console.log(e);
    process.exit(1);
  }
}


/* TEST OBJ
{
  "Records": [
    {
      "body":"https://www.fragrantica.com/perfume/Ariana-Grande/Ari-31661.html"
    }
  ]
}
*/
