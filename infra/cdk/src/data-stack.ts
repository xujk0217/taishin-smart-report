/**
 * DataStack - S3, KMS, DynamoDB, Lifecycle
 * All storage infrastructure for the Smart Report Generator.
 */
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DataStack extends cdk.Stack {
  public readonly inputBucket: s3.Bucket;
  public readonly evidenceBucket: s3.Bucket;
  public readonly artifactsBucket: s3.Bucket;
  public readonly jobsTable: dynamodb.Table;
  public readonly callbackTokensTable: dynamodb.Table;
  public readonly encryptionKey: kms.Key;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // KMS Key for encrypting all data at rest
    this.encryptionKey = new kms.Key(this, 'SmartReportKey', {
      alias: 'smart-report/data-key',
      description: 'Encryption key for Smart Report Generator data',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // S3 Bucket: Input (uploaded Excel files)
    this.inputBucket = new s3.Bucket(this, 'InputBucket', {
      bucketName: cdk.PhysicalName.GENERATE_IF_NEEDED,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30),
          prefix: 'input/',
        },
      ],
      cors: [
        {
          allowedHeaders: ['*'],
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: ['*'], // Will be restricted in production
          maxAge: 3600,
        },
      ],
    });

    // S3 Bucket: Evidence (frozen EvidencePackets)
    this.evidenceBucket = new s3.Bucket(this, 'EvidenceBucket', {
      bucketName: cdk.PhysicalName.GENERATE_IF_NEEDED,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(90),
        },
      ],
    });

    // S3 Bucket: Artifacts (PPTX, XLSX, HTML previews)
    this.artifactsBucket = new s3.Bucket(this, 'ArtifactsBucket', {
      bucketName: cdk.PhysicalName.GENERATE_IF_NEEDED,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30),
        },
      ],
    });

    // DynamoDB: Jobs table
    this.jobsTable = new dynamodb.Table(this, 'JobsTable', {
      tableName: 'smart-report-jobs',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
    });

    // DynamoDB: Callback Tokens table (for Step Functions wait states)
    this.callbackTokensTable = new dynamodb.Table(this, 'CallbackTokensTable', {
      tableName: 'smart-report-callback-tokens',
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'waitType', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // Outputs
    new cdk.CfnOutput(this, 'InputBucketName', { value: this.inputBucket.bucketName });
    new cdk.CfnOutput(this, 'EvidenceBucketName', { value: this.evidenceBucket.bucketName });
    new cdk.CfnOutput(this, 'ArtifactsBucketName', { value: this.artifactsBucket.bucketName });
    new cdk.CfnOutput(this, 'JobsTableName', { value: this.jobsTable.tableName });
  }
}
