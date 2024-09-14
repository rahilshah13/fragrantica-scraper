import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Table, BillingMode, AttributeType, StreamViewType } from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Tracing, Runtime, CfnEventSourceMapping, FilterCriteria, FilterRule } from 'aws-cdk-lib/aws-lambda';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Vpc, InstanceType, InstanceSize, InstanceClass, SubnetType, SecurityGroup, Port, Peer } from 'aws-cdk-lib/aws-ec2' 
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import path = require('path');

import * as rds from 'aws-cdk-lib/aws-rds';

export class OudStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
  
    /*
      DYNAMO TABLES - only need to create once
    */
    // const designers = new Table(this, 'DesignersTable', {
    //   tableName: "Designers",
    //   partitionKey: { name: 'url', type: AttributeType.STRING},
    //   removalPolicy: cdk.RemovalPolicy.RETAIN,
    //   billingMode: BillingMode.PAY_PER_REQUEST,
    //   stream: StreamViewType.NEW_IMAGE
    // });

    // const perfumes = new Table(this, 'PerfumesTable', {
    //   tableName: "Perfumes",
    //   partitionKey: { name: 'url', type: AttributeType.STRING},
    //   removalPolicy: cdk.RemovalPolicy.RETAIN,
    //   billingMode: BillingMode.PAY_PER_REQUEST
    // });

    // const designersPage = new Table(this, 'DesignersPageTable', {
    //   tableName: "DesignersPage",
    //   partitionKey: { name: 'PageId', type: AttributeType.STRING},
    //   removalPolicy: cdk.RemovalPolicy.RETAIN,
    //   billingMode: BillingMode.PAY_PER_REQUEST
    // });

    const designers = Table.fromTableAttributes(this,'DesignersTable', {
      tableArn: 'arn:aws:dynamodb:us-east-1:299395470614:table/Designers',
      tableStreamArn: 'arn:aws:dynamodb:us-east-1:299395470614:table/Designers/stream/2023-09-23T21:59:03.281'
    });

    const perfumes = Table.fromTableArn(this, 'PerfumesTable', 'arn:aws:dynamodb:us-east-1:299395470614:table/Perfumes');
    const designersPage = Table.fromTableArn(this, 'DesignersPageTable', 'arn:aws:dynamodb:us-east-1:299395470614:table/DesignersPage');

    /*
      SQS
    */
    const designerQueue = new Queue(this, 'DesignerQueue', { 
      visibilityTimeout: cdk.Duration.seconds(180) 
    });

    const perfumeQueue = new Queue(this, 'PerfumeQueue', {
      visibilityTimeout: cdk.Duration.minutes(7), // (10 urls per task)*30 seconds + 2 min buffer
    });

    const embeddingQueue = new Queue(this, 'EmbeddingsQueue', {
      visibilityTimeout: cdk.Duration.minutes(7),
    });

    /*
      ECS Policies
    */
    const executionPolicy =  new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ]
    });

    const taskPolicy =  new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [
        designers.tableArn, 
        designersPage.tableArn, 
        perfumes.tableArn, 
        designerQueue.queueArn,
        perfumeQueue.queueArn
      ],
      actions: [
        "dynamodb:*", 
        "sqs:*",
        "ecs:UpdateService" // for setting desired tasks to 0
      ]
    });

    /*
      SCRAPE DESIGNER URLS TASK
    */
    const designerUrlsTask = new ecs.FargateTaskDefinition(this, 'designerUrlsHandler', { 
      cpu: 1024,
      memoryLimitMiB: 2048	
    });
    
    designerUrlsTask.addContainer('DesignerScraper', {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, 'fargate-tasks', 'designer-scraper')),
      environment: {"DESIGNER_TABLE_NAME": designers.tableName, "DESIGNER_PAGE_TABLE_NAME": designersPage.tableName,},
      logging: new ecs.AwsLogDriver({streamPrefix: "designerUrl", mode: ecs.AwsLogDriverMode.NON_BLOCKING}),
      readonlyRootFilesystem: false
    });

    designerUrlsTask.addToExecutionRolePolicy(executionPolicy);
    designerUrlsTask.addToTaskRolePolicy(taskPolicy);

    /*
      SCRAPE PERFUME URLS FROM DESIGNER PAGES
    */
    const perfumeUrlsTask = new ecs.FargateTaskDefinition(this, 'perfumeUrlsHandler', {
      cpu: 1024,
      memoryLimitMiB: 2048,
    });
    
    perfumeUrlsTask.addContainer('PerfumeUrlScraper', {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, 'fargate-tasks', 'perfume-url-scraper')),
      environment: {
        "PERFUME_TABLE_NAME": perfumes.tableName, 
        "DESIGNER_TABLE_NAME": designers.tableName,
        "DESIGNER_QUEUE_URL": designerQueue.queueUrl
      },
      logging: new ecs.AwsLogDriver({streamPrefix: "perfumeUrl", mode: ecs.AwsLogDriverMode.NON_BLOCKING}),
      readonlyRootFilesystem: false,
    });

    perfumeUrlsTask.addToExecutionRolePolicy(executionPolicy);
    perfumeUrlsTask.addToTaskRolePolicy(taskPolicy);

    /*
      DESIGNER URL TO PERFUME URL PIPELINE
      Dynamo Stream --> Lambda Consumer --> SQS
                                        --> ecs:RunTask Role
    */
    const vpc = Vpc.fromLookup(this, "VPC", { isDefault: true });
    const cluster = new ecs.Cluster(this, 'FargateCluster', {vpc});

    const spawnPerfumeScrapers = new NodejsFunction(this, 'SpawnPerfumeScrapers', {
      tracing: Tracing.ACTIVE,
      handler: 'handler',
      runtime: Runtime.NODEJS_18_X,
      entry: path.join(__dirname, 'lambda', 'spawnPerfumeScrapers.js'),
      timeout: cdk.Duration.seconds(30),
      environment: {
        ECS_CLUSTER_NAME: cluster.clusterArn,
        TASK_DEFINITION: perfumeUrlsTask.taskDefinitionArn,
        DESIGNER_QUEUE_URL: designerQueue.queueUrl,
        PERFUME_TASK_FAMILY: perfumeUrlsTask.family,
        PUB_SUBNET_1: vpc.publicSubnets[0].subnetId,
        PUB_SUBNET_2: vpc.publicSubnets[1].subnetId,
      },
    });

    spawnPerfumeScrapers.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ecs:*', 'iam:PassRole'], // Permissions for running ECS tasks
        resources: [
          perfumeUrlsTask.taskDefinitionArn, 
          perfumeUrlsTask.executionRole?.roleArn || "",
          perfumeUrlsTask.taskRole?.roleArn || "",
        ]
      })
    );

    spawnPerfumeScrapers.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ecs:ListTasks'], // Permissions for running ECS tasks
        resources: [
          "*"
        ]
      })
    );

    designers.grantStreamRead(spawnPerfumeScrapers);
    designerQueue.grantSendMessages(spawnPerfumeScrapers);
      
    const designerStreamMap = new CfnEventSourceMapping(this, 'DesignerStreamMapping', {
      functionName: spawnPerfumeScrapers.functionArn,
      eventSourceArn: designers.tableStreamArn,
      filterCriteria: {
        filters: [ 
          FilterCriteria.filter({eventName: FilterRule.isEqual("INSERT") }),
          FilterCriteria.filter({eventName: FilterRule.isEqual("MODIFY") }),
        ]
      },
      startingPosition: "LATEST",
      batchSize: 500,
      maximumBatchingWindowInSeconds: 60
    });

    /*
      CONTENT SCRAPING
      * A lambda that populates the perfume url queue (manually triggered)
        * Needed Perms: SQS write, Dynamo Read, ECS Update Service
      * an ECS service that maintains 140 tasks
        * if a tasks sees 0 msgs in SQS, set desired tasks to 0  
    */
    const contentScraperTask = new ecs.FargateTaskDefinition(this, 'ContentScrapingHandler', { cpu: 2048, memoryLimitMiB: 5120 });
    
    contentScraperTask.addContainer('ContentScraper', {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, 'fargate-tasks', 'content-scraper')),
      environment: {
        "PERFUME_TABLE_NAME": perfumes.tableName, 
        "PERFUME_QUEUE_URL": perfumeQueue.queueUrl
      },
      logging: new ecs.AwsLogDriver({streamPrefix: "perfumeUrl", mode: ecs.AwsLogDriverMode.NON_BLOCKING}),
      readonlyRootFilesystem: false
    });

    contentScraperTask.addToExecutionRolePolicy(executionPolicy);
    contentScraperTask.addToTaskRolePolicy(taskPolicy);

    const contentScrapingService = new ecs.FargateService(this, 'ContentScrapingService', {
      cluster,
      taskDefinition: contentScraperTask,
      assignPublicIp: true,
      desiredCount: 0
    });

    /* 
      RATING SCRAPING
      same as content scraping, but only grabs ratings
    */
    const ratingScraperTask = new ecs.FargateTaskDefinition(this, 'RatingScrapingHandler', { cpu: 2048, memoryLimitMiB: 5120 });
  
    ratingScraperTask.addContainer('RatingScraper', {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, 'fargate-tasks', 'rating-scraper')),
      environment: {
        "PERFUME_TABLE_NAME": perfumes.tableName, 
        "PERFUME_QUEUE_URL": perfumeQueue.queueUrl
      },
      logging: new ecs.AwsLogDriver({streamPrefix: "perfumeUrl", mode: ecs.AwsLogDriverMode.NON_BLOCKING}),
      readonlyRootFilesystem: false
    });
  
    ratingScraperTask.addToExecutionRolePolicy(executionPolicy);
    ratingScraperTask.addToTaskRolePolicy(taskPolicy);

    const ratingScrapingService = new ecs.FargateService(this, 'RatingScrapingService', {
      cluster,
      taskDefinition: ratingScraperTask,
      assignPublicIp: true,
      desiredCount: 0
    });

    /*
    */
    const populatePerfumeQueue = new NodejsFunction(this, 'PopulatePerfumeQueue', {
      tracing: Tracing.ACTIVE,
      handler: 'handler',
      runtime: Runtime.NODEJS_18_X,
      entry: path.join(__dirname, 'lambda', 'populatePerfumeQueue.js'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 5000,
      environment: {
        ECS_CLUSTER_NAME: cluster.clusterArn,
        ECS_SERVICE_NAME: contentScrapingService.serviceArn,
        ECS_RATING_SERVICE_NAME: ratingScrapingService.serviceArn,
        PERFUME_TABLE_NAME: perfumes.tableName,
        PERFUME_QUEUE_URL: perfumeQueue.queueUrl,
      },
    });

    populatePerfumeQueue.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ecs:UpdateService'],
        resources: [
          contentScrapingService.serviceArn, 
          ratingScrapingService.serviceArn, 
        ]
      })
    );

    perfumes.grantReadData(populatePerfumeQueue);
    perfumeQueue.grantSendMessages(populatePerfumeQueue);
    /*
      GET EMBEDDINGS AND SAVE THEM

      1. docker pull dpage/pgadmin4
      2. docker run -p 5050:80 -e "PGADMIN_DEFAULT_EMAIL=user@domain.com" -e "PGADMIN_DEFAULT_PASSWORD=password" -d dpage/pgadmin4
    */
    const dbName = "EmbeddingsDB";
    const templatedSecret = new Secret(this, 'TemplatedSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludeCharacters: '/@"',
      },
    });

    const dbsg = new SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: vpc,
      allowAllOutbound: true,
      description: id + 'Database',
      securityGroupName: id + 'Database',
    });

    dbsg.addIngressRule(Peer.anyIpv4(), Port.allTraffic(), 'all in');
    dbsg.addEgressRule(Peer.anyIpv4(), Port.allTraffic(), 'all out');

    const pg = new rds.DatabaseInstance(this, "EmbeddingsDB", {
      engine: rds.DatabaseInstanceEngine.POSTGRES,
      // Generate the secret with admin username `postgres` and random password
      databaseName: dbName,
      credentials: {
        username: templatedSecret.secretValueFromJson('username').unsafeUnwrap().toString(),
        password: templatedSecret.secretValueFromJson('password')
      },      
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO),
      vpc,
      securityGroups: [dbsg],
      vpcSubnets: { subnetType: SubnetType.PUBLIC }
    });
    

    const populateEmbeddingQueue = new NodejsFunction(this, 'PopulateEmbeddingQueue', {
      tracing: Tracing.ACTIVE,
      handler: 'handler',
      runtime: Runtime.NODEJS_18_X,
      entry: path.join(__dirname, 'lambda', 'populateEmbeddingQueue.js'),
      timeout: cdk.Duration.minutes(15),
      memorySize: 2048,
      environment: {
        PERFUME_TABLE_NAME: perfumes.tableName,
        EMBEDDING_QUEUE_URL: embeddingQueue.queueUrl,
      },
    });

    // TODO: once we confirm the connection is possible, this unsafe unwrap should be fixed
    const getEmbeddings = new NodejsFunction(this, 'GetEmbeddings', {
      // vpc,
      allowPublicSubnet: true,
      tracing: Tracing.ACTIVE,
      handler: 'handler',
      runtime: Runtime.NODEJS_18_X,
      entry: path.join(__dirname, 'lambda', 'getEmbeddings.js'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        PERFUME_TABLE_NAME: perfumes.tableName,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
        DB_ARN: pg.instanceArn,
        DB_NAME: dbName,
        DB_SECRET: templatedSecret.secretValueFromJson('password').unsafeUnwrap().toString(),
        DB_USERNAME: templatedSecret.secretValueFromJson('username').unsafeUnwrap().toString(),
        DB_HOST: pg.dbInstanceEndpointAddress
      },
    });

    const getEmbeddingsTrigger = new CfnEventSourceMapping(this, 'GetEmbeddingsTrigger', {
      functionName: getEmbeddings.functionArn,
      eventSourceArn: embeddingQueue.queueArn,
      batchSize: 10,
      maximumBatchingWindowInSeconds: 60
    });

    perfumes.grantReadData(populateEmbeddingQueue);   
    perfumes.grantReadData(getEmbeddings);

    embeddingQueue.grantSendMessages(populateEmbeddingQueue);
    embeddingQueue.grantConsumeMessages(getEmbeddings);
    
    pg.grantConnect(getEmbeddings, "postgres");
    
    /* TODO:
      - look into why scraping doesn't work with FARGATE SPOT
      - FARGATE SPOT seems to create a nat gateway by default... 
    */
  }
}