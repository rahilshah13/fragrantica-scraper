#! /bin/sh
prompt="$1"
echo "$prompt"
curl https://api.openai.com/v1/embeddings -H "Cache-Control: no-cache" -H "Content-Type: application/json" -H "Authorization: Bearer $OPENAI_API_KEY" -d '{"input": "$prompt", "model": "text-embedding-ada-002"}' | jq -r ".data[0].embedding" > ./embeddings/${prompt:0:12}.txt;
python makeEmbedding.py "$prompt"