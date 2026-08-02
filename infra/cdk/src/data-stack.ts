import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { applyWorkshopTags, WorkshopCloudConfig } from './config.js';

export class DataStack extends cdk.Stack {
  public readonly inputBucket: s3.Bucket;
  public readonly evidenceBucket: s3.Bucket;
  public readonly artifactsBucket: s3.Bucket;
  public readonly auditBucket: s3.Bucket;
  public readonly webBucket: s3.Bucket;
  public readonly webDistribution: cloudfront.Distribution;
  public readonly jobsTable: dynamodb.Table;
  public readonly stageManifestsTable: dynamodb.Table;
  public readonly callbackTokensTable: dynamodb.Table;
  public readonly uploadPermissionsTable: dynamodb.Table;
  public readonly encryptionKey: kms.Key;

  constructor(scope: Construct, id: string, config: WorkshopCloudConfig, props?: cdk.StackProps) {
    super(scope, id, props);
    applyWorkshopTags(this, config);

    this.encryptionKey = new kms.Key(this, 'WorkshopDataKey', {
      alias: 'smart-report/workshop-data',
      description: 'Customer managed encryption for Workshop Cloud report data.',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.inputBucket = this.createPrivateBucket('InputBucket', 'Workshop source workbook and template intake.', 30);
    this.evidenceBucket = this.createPrivateBucket('EvidenceBucket', 'Immutable workflow evidence and stage manifests.', 90);
    this.artifactsBucket = this.createPrivateBucket('ArtifactsBucket', 'Approved HTML, PPTX, XLSX, and validation artifacts.', 30);
    this.auditBucket = this.createPrivateBucket('AuditBucket', 'Safe audit events and deployment evidence.', 90);
    this.webBucket = this.createPrivateBucket('WebBucket', 'Private CloudFront web application origin.', 30);
    this.webDistribution = new cloudfront.Distribution(this, 'WorkshopWebDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      enableLogging: false,
      comment: 'Private Workshop Cloud web origin. No user content is served until the frontend gate passes.',
    });

    this.jobsTable = this.createTable('JobsTable', 'jobId', undefined, 'expiresAt');
    this.stageManifestsTable = this.createTable('StageManifestsTable', 'jobId', 'stageVersion', 'expiresAt');
    this.callbackTokensTable = this.createTable('CallbackTokensTable', 'jobId', 'waitType', 'expiresAt');
    this.uploadPermissionsTable = this.createTable('UploadPermissionsTable', 'jobId', undefined, 'expiresAt');

    new cdk.CfnOutput(this, 'InputBucketName', { value: this.inputBucket.bucketName });
    new cdk.CfnOutput(this, 'EvidenceBucketName', { value: this.evidenceBucket.bucketName });
    new cdk.CfnOutput(this, 'ArtifactsBucketName', { value: this.artifactsBucket.bucketName });
    new cdk.CfnOutput(this, 'JobsTableName', { value: this.jobsTable.tableName });
    new cdk.CfnOutput(this, 'WorkshopWebUrl', { value: `https://${this.webDistribution.distributionDomainName}` });
  }

  private createPrivateBucket(id: string, description: string, expirationDays: number): s3.Bucket {
    return new s3.Bucket(this, id, {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'ExpireWorkshopData',
          enabled: true,
          expiration: cdk.Duration.days(expirationDays),
          noncurrentVersionExpiration: cdk.Duration.days(7),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
    });
  }

  private createTable(id: string, partitionKeyName: string, sortKeyName?: string, ttlAttribute?: string): dynamodb.Table {
    return new dynamodb.Table(this, id, {
      partitionKey: { name: partitionKeyName, type: dynamodb.AttributeType.STRING },
      sortKey: sortKeyName ? { name: sortKeyName, type: dynamodb.AttributeType.STRING } : undefined,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.encryptionKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: ttlAttribute,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
  }
}
