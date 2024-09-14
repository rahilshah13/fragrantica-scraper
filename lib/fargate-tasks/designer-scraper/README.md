This lambda is scrapes every designer url off of fragrantica and adds an entry to dynamodb
1) `npm run dev` to run locally
2) docker build -t designer-scraper --build-arg NODE_ENV=dev .
    - docker build -t designer-scraper --build-arg NODE_ENV=dd .
    - do not specify build-arg for prod build

3) docker run --rm -it -e NODE_ENV=dev designer-scraper
  - docker run --rm -it -e NODE_ENV=dd -p 9000:8080 --user apps --privileged designer-scraper
  - for lambda: entrypoint command in the Dockerfile and potentially some of the chromium flags
    - uncomment out the 
    - curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" -d '{}'

This blog post summarized some of the problems I ran into
- https://blog.carlosnunez.me/post/scraping-chromium-lambda-nodeless-zerostress/ 

Current solution attempt based on:
- https://techandstuff.medium.com/running-headful-chrome-with-extensions-in-a-lambda-container-image-22ba1c566feb 

Notes:
Lambda or ECS Fargate would have been superior options if they allowed the container to run in privileged mode 

Current Questions:
- Why is the CDK automatically creating a NAT Gateway- is this associated with the fargate cluster resource?
    - Turns out that the "fargate cluster" resource creates a default VPC which creates a NAT gateway which carries charges

    - TODO (09/18/01): check back up on Elastic Cloud Compute NatGateway Billing- shouldnt be more than 144 hrs...
    - TODO: Create the Fargate Service that automatically runs the task (using spot capacity) whenever there is a new revision