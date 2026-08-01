import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';
import { applyWorkshopTags, WorkshopCloudConfig } from './config.js';
import { DataStack } from './data-stack.js';

export class EdgeStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, config: WorkshopCloudConfig, data: DataStack, props?: cdk.StackProps) {
    super(scope, id, props);
    applyWorkshopTags(this, config);

    this.distribution = new cloudfront.Distribution(this, 'WorkshopWebDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(data.webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      enableLogging: false,
      comment: 'Private Workshop Cloud web origin. No user content is served until the frontend gate passes.',
    });

    new cdk.CfnOutput(this, 'WorkshopWebUrl', { value: `https://${this.distribution.distributionDomainName}` });
  }
}
