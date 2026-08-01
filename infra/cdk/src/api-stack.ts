import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'node:path';
import { applyWorkshopTags, WorkshopCloudConfig } from './config.js';
import { DataStack } from './data-stack.js';

export class ApiStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly api: apigateway.RestApi;
  public readonly createJobHandler: NodejsFunction;

  constructor(scope: Construct, id: string, config: WorkshopCloudConfig, data: DataStack, props?: cdk.StackProps) {
    super(scope, id, props);
    applyWorkshopTags(this, config);

    this.userPool = new cognito.UserPool(this, 'WorkshopUserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new cognito.CfnUserPoolGroup(this, 'WorkshopUploaderGroup', {
      groupName: 'workshop-uploaders',
      userPoolId: this.userPool.userPoolId,
      description: 'Managed users permitted to create Workshop Cloud upload jobs.',
    });

    this.userPoolClient = this.userPool.addClient('WorkshopWebClient', {
      generateSecret: false,
      preventUserExistenceErrors: true,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
      },
    });

    this.createJobHandler = new NodejsFunction(this, 'CreateJobHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(process.cwd(), 'src', 'lambda', 'jobs.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      tracing: lambda.Tracing.PASS_THROUGH,
      environment: {
        INPUT_BUCKET: data.inputBucket.bucketName,
        JOBS_TABLE: data.jobsTable.tableName,
        UPLOAD_PERMISSIONS_TABLE: data.uploadPermissionsTable.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        externalModules: [],
      },
    });
    data.inputBucket.grantPut(this.createJobHandler);
    data.jobsTable.grantWriteData(this.createJobHandler);
    data.uploadPermissionsTable.grantWriteData(this.createJobHandler);

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'WorkshopUserPoolAuthorizer', {
      cognitoUserPools: [this.userPool],
    });

    this.api = new apigateway.RestApi(this, 'WorkshopJobsApi', {
      description: 'Authenticated Workshop Cloud job API.',
      deployOptions: {
        metricsEnabled: true,
        tracingEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
        dataTraceEnabled: false,
      },
      endpointConfiguration: { types: [apigateway.EndpointType.REGIONAL] },
    });

    const jobs = this.api.root.addResource('v1').addResource('jobs');
    jobs.addMethod('POST', new apigateway.LambdaIntegration(this.createJobHandler), {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer,
    });

    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'JobsApiUrl', { value: this.api.url });
  }
}
