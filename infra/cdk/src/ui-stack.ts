import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { applyWorkshopTags, WorkshopCloudConfig } from './config.js';

export interface UiStackProps extends cdk.StackProps {
  readonly assetsPath?: string;
}

export class UiStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, config: WorkshopCloudConfig, props: UiStackProps = {}) {
    super(scope, id, props);
    applyWorkshopTags(this, config);
    cdk.Tags.of(this).add('DeploymentSlice', 'stage2-real-planner');

    const assetsPath = props.assetsPath ?? path.resolve(process.cwd(), '../../apps/web/dist');
    const domainPrefix = `smart-report-ui-${config.account.slice(-6)}`;

    const webBucket = new s3.Bucket(this, 'WebOrigin', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{
        id: 'ExpireOldUiVersions',
        noncurrentVersionExpiration: cdk.Duration.days(30),
        abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
      }],
    });

    const accessLogs = new s3.Bucket(this, 'CloudFrontAccessLogs', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      accessControl: s3.BucketAccessControl.LOG_DELIVERY_WRITE,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ id: 'RetainAccessLogs', expiration: cdk.Duration.days(90) }],
    });

    const webAcl = new wafv2.CfnWebACL(this, 'UiWebAcl', {
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'smart-report-ui-web-acl',
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'AwsManagedCommonRules',
          priority: 0,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'smart-report-ui-common-rules',
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'ViewerRateLimit',
          priority: 1,
          action: { block: {} },
          statement: { rateBasedStatement: { aggregateKeyType: 'IP', limit: 1000 } },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'smart-report-ui-rate-limit',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    const authDomain = `${domainPrefix}.auth.${config.region}.amazoncognito.com`;
    const responseHeaders = new cloudfront.ResponseHeadersPolicy(this, 'UiSecurityHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://${authDomain} https://*.execute-api.${config.region}.amazonaws.com https://*.s3.${config.region}.amazonaws.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://${authDomain}`,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          preload: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        xssProtection: { protection: true, modeBlock: true, override: true },
      },
    });

    this.distribution = new cloudfront.Distribution(this, 'UiDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        responseHeadersPolicy: responseHeaders,
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.seconds(0) },
      ],
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      enableIpv6: true,
      enableLogging: true,
      logBucket: accessLogs,
      logFilePrefix: 'cloudfront/',
      webAclId: webAcl.attrArn,
      comment: 'Real Excel, prompt, calculation, and agent-rendered editable PPTX service.',
    });

    this.userPool = new cognito.UserPool(this, 'UiUsers', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireSymbols: true,
        requireUppercase: true,
        tempPasswordValidity: cdk.Duration.days(3),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    this.userPool.addDomain('UiCognitoDomain', { cognitoDomain: { domainPrefix } });

    const uiUrl = `https://${this.distribution.distributionDomainName}/`;
    this.userPoolClient = this.userPool.addClient('UiClient', {
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [uiUrl],
        logoutUrls: [uiUrl],
      },
    });

    const plannerApiUrl = this.addPlannerBackend(config, uiUrl);

    const deployment = new s3deploy.BucketDeployment(this, 'DeployUiAssets', {
      sources: [s3deploy.Source.asset(assetsPath, { exclude: ['runtime-config.js'] })],
      destinationBucket: webBucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      prune: false,
      retainOnDelete: true,
    });

    const runtimeConfig = new cr.AwsCustomResource(this, 'DeployRuntimeConfig', {
      onCreate: {
        service: 'S3',
        action: 'putObject',
        parameters: {
          Bucket: webBucket.bucketName,
          Key: 'runtime-config.js',
          Body: cdk.Fn.join('', [
            'window.__SMART_REPORT_CONFIG__ = {"mode":"REAL","region":"', config.region,
            '","userPoolId":"', this.userPool.userPoolId,
            '","userPoolClientId":"', this.userPoolClient.userPoolClientId,
            '","cognitoDomain":"', authDomain,
            '","redirectUri":"', uiUrl,
            '","plannerApiUrl":"', plannerApiUrl,
            '"};',
          ]),
          ContentType: 'application/javascript; charset=utf-8',
          CacheControl: 'no-store, max-age=0',
        },
        physicalResourceId: cr.PhysicalResourceId.of('smart-report-ui-runtime-config'),
      },
      onUpdate: {
        service: 'S3',
        action: 'putObject',
        parameters: {
          Bucket: webBucket.bucketName,
          Key: 'runtime-config.js',
          Body: cdk.Fn.join('', [
            'window.__SMART_REPORT_CONFIG__ = {"mode":"REAL","region":"', config.region,
            '","userPoolId":"', this.userPool.userPoolId,
            '","userPoolClientId":"', this.userPoolClient.userPoolClientId,
            '","cognitoDomain":"', authDomain,
            '","redirectUri":"', uiUrl,
            '","plannerApiUrl":"', plannerApiUrl,
            '"};',
          ]),
          ContentType: 'application/javascript; charset=utf-8',
          CacheControl: 'no-store, max-age=0',
        },
        physicalResourceId: cr.PhysicalResourceId.of('smart-report-ui-runtime-config'),
      },
      installLatestAwsSdk: false,
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: [webBucket.arnForObjects('runtime-config.js')] }),
    });
    runtimeConfig.node.addDependency(deployment);

    new cdk.CfnOutput(this, 'UiUrl', { value: uiUrl });
    new cdk.CfnOutput(this, 'UiBucketName', { value: webBucket.bucketName });
    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'CognitoDomain', { value: authDomain });
    new cdk.CfnOutput(this, 'PlannerApiUrl', { value: plannerApiUrl });
    new cdk.CfnOutput(this, 'EnabledCapabilities', { value: 'cognito,upload,prompt,planner-api,fargate,bedrock,plan-review,calculation-codegen,calculation-execution,agent-pptx-rendering,pptx-template-rendering' });
    new cdk.CfnOutput(this, 'DisabledCapabilities', { value: 'research,artifact-storage,email' });
  }

  private addPlannerBackend(config: WorkshopCloudConfig, uiUrl: string): string {
    const inputBucket = new s3.Bucket(this, 'PlannerInputBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(30), abortIncompleteMultipartUploadAfter: cdk.Duration.days(1) }],
      cors: [{ allowedOrigins: [uiUrl.replace(/\/$/, '')], allowedMethods: [s3.HttpMethods.POST], allowedHeaders: ['*'], maxAge: 900 }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const table = new dynamodb.Table(this, 'PlannerJobs', {
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'ownerSub-createdAt-index',
      partitionKey: { name: 'ownerSub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    const vpc = new ec2.Vpc(this, 'PlannerVpc', {
      maxAzs: 2, natGateways: 0,
      subnetConfiguration: [{ name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 }],
    });
    const taskSg = new ec2.SecurityGroup(this, 'PlannerTaskSecurityGroup', { vpc, allowAllOutbound: false });
    const endpointSg = new ec2.SecurityGroup(this, 'PlannerEndpointSecurityGroup', { vpc, allowAllOutbound: false });
    endpointSg.addIngressRule(taskSg, ec2.Port.tcp(443));
    taskSg.addEgressRule(endpointSg, ec2.Port.tcp(443));
    // Gateway endpoints (S3/DynamoDB) use AWS public prefix-list addresses rather
    // than the interface endpoint security group. The isolated route tables have
    // no NAT or internet gateway, so this permits HTTPS only through VPC routes.
    taskSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'AWS VPC endpoints only; isolated subnets have no internet route');
    vpc.addGatewayEndpoint('PlannerS3Endpoint', { service: ec2.GatewayVpcEndpointAwsService.S3 });
    vpc.addGatewayEndpoint('PlannerDynamoEndpoint', { service: ec2.GatewayVpcEndpointAwsService.DYNAMODB });
    [ec2.InterfaceVpcEndpointAwsService.ECR, ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS, ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME]
      .forEach((service, index) => vpc.addInterfaceEndpoint(`PlannerEndpoint${index}`, {
        service, privateDnsEnabled: true, securityGroups: [endpointSg],
        subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      }));

    const cluster = new ecs.Cluster(this, 'PlannerCluster', { vpc, containerInsightsV2: ecs.ContainerInsights.ENABLED });
    const task = new ecs.FargateTaskDefinition(this, 'PlannerTask', {
      cpu: 2048,
      memoryLimitMiB: 4096,
      ephemeralStorageGiB: 30,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    task.addVolume({ name: 'planner-tmp' });
    const logGroup = new logs.LogGroup(this, 'PlannerLogs', { retention: logs.RetentionDays.THREE_MONTHS, removalPolicy: cdk.RemovalPolicy.RETAIN });
    const container = task.addContainer('PlannerContainer', {
      image: ecs.ContainerImage.fromAsset(path.resolve(process.cwd(), '../../services/lobster-runtime'), {
        platform: ecrAssets.Platform.LINUX_AMD64,
      }),
      readonlyRootFilesystem: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'planner' }),
      environment: {
        PLANNER_TABLE: table.tableName,
        PLANNER_INPUT_BUCKET: inputBucket.bucketName,
        BEDROCK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6',
        // requirements_and_formula and calculation stages use Opus for deeper
        // reasoning on complex multi-metric analysis and formula derivation.
        COMPLEX_BEDROCK_MODEL_ID: 'us.anthropic.claude-opus-4-6-v1',
        // Calculation code generation also uses Opus as the fallback model
        // for correctness-critical code generation.
        CALCULATION_BEDROCK_MODEL_ID: 'us.anthropic.claude-opus-4-6-v1',
        PRESENTATION_BEDROCK_MODEL_ID: 'us.anthropic.claude-opus-4-6-v1',
        AWS_REGION: config.region,
      },
    });
    container.addMountPoints({ sourceVolume: 'planner-tmp', containerPath: '/tmp', readOnly: false });
    table.grantReadWriteData(task.taskRole);
    inputBucket.grantReadWrite(task.taskRole);
    task.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [
        `arn:aws:bedrock:${config.region}:${config.account}:inference-profile/us.anthropic.claude-sonnet-4-6`,
        `arn:aws:bedrock:${config.region}:${config.account}:inference-profile/us.anthropic.claude-opus-4-6-v1`,
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-*',
      ],
    }));
    const runTask = new sfnTasks.EcsRunTask(this, 'RunPlannerTask', {
      cluster, taskDefinition: task, integrationPattern: sfn.IntegrationPattern.RUN_JOB,
      launchTarget: new sfnTasks.EcsFargateLaunchTarget(),
      assignPublicIp: false,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }, securityGroups: [taskSg],
      containerOverrides: [{ containerDefinition: container, environment: [
        { name: 'PLANNER_JOB_ID', value: sfn.JsonPath.stringAt('$.jobId') },
        { name: 'PLANNER_OPERATION', value: sfn.JsonPath.stringAt('$.operation') },
      ] }],
    });
    // Retrying an entire Fargate task can double an interactive run. Stage-level
    // retries are handled by the worker and reported to the owner instead.
    runTask.addRetry({ maxAttempts: 1, interval: cdk.Duration.seconds(5), backoffRate: 1 });
    const orchestrationFailed = new sfnTasks.DynamoUpdateItem(this, 'MarkPlannerOrchestrationFailed', {
      table,
      key: { jobId: sfnTasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.jobId')) },
      updateExpression: 'SET #status = :failed, safeErrorCode = :code, updatedAt = :updated',
      expressionAttributeNames: { '#status': 'status' },
      expressionAttributeValues: {
        ':failed': sfnTasks.DynamoAttributeValue.fromString('FAILED'),
        ':code': sfnTasks.DynamoAttributeValue.fromString('PLANNER_ORCHESTRATION_FAILED'),
        ':updated': sfnTasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$$.State.EnteredTime')),
      },
      resultPath: sfn.JsonPath.DISCARD,
    });
    orchestrationFailed.next(new sfn.Fail(this, 'PlannerOrchestrationFailed', {
      error: 'PLANNER_ORCHESTRATION_FAILED',
      cause: 'The planner worker could not be started or completed.',
    }));
    runTask.addCatch(orchestrationFailed, { errors: [sfn.Errors.ALL], resultPath: '$.plannerError' });
    const stateMachine = new sfn.StateMachine(this, 'PlannerStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(runTask.next(new sfn.Succeed(this, 'PlannerComplete'))),
      stateMachineType: sfn.StateMachineType.STANDARD, timeout: cdk.Duration.seconds(900),
      logs: { destination: new logs.LogGroup(this, 'PlannerStateMachineLogs', { retention: logs.RetentionDays.THREE_MONTHS }), includeExecutionData: false, level: sfn.LogLevel.ERROR },
      tracingEnabled: true,
    });
    const apiHandler = new NodejsFunction(this, 'PlannerApiHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(process.cwd(), 'src', 'lambda', 'planner-api.ts'), handler: 'handler',
      timeout: cdk.Duration.seconds(15), memorySize: 512,
      environment: {
        PLANNER_TABLE: table.tableName,
        PLANNER_INPUT_BUCKET: inputBucket.bucketName,
        PLANNER_STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        PLANNER_CLUSTER_ARN: cluster.clusterArn,
        PLANNER_LOG_GROUP: logGroup.logGroupName,
        PLANNER_OWNER_INDEX: 'ownerSub-createdAt-index',
        UI_ORIGIN: uiUrl.replace(/\/$/, ''),
      },
      bundling: { minify: true, sourceMap: false, target: 'node22' },
    });
    table.grantReadWriteData(apiHandler);
    inputBucket.grantReadWrite(apiHandler);
    stateMachine.grantStartExecution(apiHandler);
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['states:ListExecutions', 'ecs:ListTasks', 'ecs:DescribeTasks'],
      resources: ['*'],
    }));
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['logs:DescribeLogStreams', 'logs:GetLogEvents', 'logs:FilterLogEvents'],
      resources: [logGroup.logGroupArn, `${logGroup.logGroupArn}:*`],
    }));
    const pptxRenderer = new lambda.Function(this, 'PptxRenderer', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'render_pptx_lambda.handler',
      code: lambda.Code.fromAsset(path.resolve(process.cwd(), '../../apps/web/api'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_11.bundlingImage,
          command: ['bash', '-c', 'pip install --no-cache-dir -r requirements.txt -t /asset-output && cp -au . /asset-output'],
        },
      }),
      timeout: cdk.Duration.seconds(29),
      memorySize: 1536,
      tracing: lambda.Tracing.PASS_THROUGH,
      environment: {
        UI_ORIGIN: uiUrl.replace(/\/$/, ''),
        PLANNER_TABLE: table.tableName,
        PLANNER_INPUT_BUCKET: inputBucket.bucketName,
      },
    });
    table.grantReadData(pptxRenderer);
    inputBucket.grantRead(pptxRenderer);
    const api = new apigateway.RestApi(this, 'PlannerApi', {
      endpointConfiguration: { types: [apigateway.EndpointType.REGIONAL] },
      binaryMediaTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
      defaultCorsPreflightOptions: { allowOrigins: [uiUrl.replace(/\/$/, '')], allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'] },
      deployOptions: { metricsEnabled: true, tracingEnabled: true, loggingLevel: apigateway.MethodLoggingLevel.ERROR, dataTraceEnabled: false, throttlingRateLimit: 10, throttlingBurstLimit: 20 },
    });
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'PlannerAuthorizer', { cognitoUserPools: [this.userPool] });
    const methodOptions = { authorizationType: apigateway.AuthorizationType.COGNITO, authorizer };
    const integration = new apigateway.LambdaIntegration(apiHandler);
    const v1 = api.root.addResource('v1');
    const plans = v1.addResource('plans');
    plans.addMethod('POST', integration, methodOptions);
    plans.addMethod('GET', integration, methodOptions);
    plans.addResource('uploads').addMethod('POST', integration, methodOptions);
    const plan = plans.addResource('{jobId}');
    plan.addMethod('GET', integration, methodOptions);
    plan.addMethod('PUT', integration, methodOptions);
    plan.addResource('template').addResource('uploads').addMethod('POST', integration, methodOptions);
    plan.addResource('retry').addMethod('POST', integration, methodOptions);
    plan.addResource('calculations').addMethod('POST', integration, methodOptions);
    const presentations = plan.addResource('presentations');
    presentations.addMethod('POST', integration, methodOptions);
    presentations.addResource('deck').addMethod('GET', integration, methodOptions);
    presentations.addResource('data').addMethod('GET', integration, methodOptions);
    plan.addResource('revisions').addMethod('POST', integration, methodOptions);
    plan.addResource('approve').addMethod('POST', integration, methodOptions);
    v1.addResource('pptx').addResource('render').addMethod('POST', new apigateway.LambdaIntegration(pptxRenderer), methodOptions);

    // Gateway Responses (401/403/4xx/5xx) are emitted by API Gateway before the
    // Lambda is invoked, so they don't inherit the CORS headers from the Lambda
    // response. Without these, the browser blocks any error response (e.g. an
    // expired Cognito token producing 401) as a CORS violation.
    const corsOrigin = uiUrl.replace(/\/$/, '');
    api.addGatewayResponse('Default4xx', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': `'${corsOrigin}'`,
        'Vary': "'Origin'",
      },
    });
    api.addGatewayResponse('Default5xx', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': `'${corsOrigin}'`,
        'Vary': "'Origin'",
      },
    });
    api.addGatewayResponse('Unauthorized', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      responseHeaders: {
        'Access-Control-Allow-Origin': `'${corsOrigin}'`,
        'Vary': "'Origin'",
      },
    });
    api.addGatewayResponse('AccessDenied', {
      type: apigateway.ResponseType.ACCESS_DENIED,
      responseHeaders: {
        'Access-Control-Allow-Origin': `'${corsOrigin}'`,
        'Vary': "'Origin'",
      },
    });

    return api.url;
  }
}
