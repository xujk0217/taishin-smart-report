import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import type { WorkshopCloudConfig } from './config.js';
import { UiStack } from './ui-stack.js';

const config: WorkshopCloudConfig = {
  stage: 'workshop',
  account: '450567357211',
  region: 'us-east-1',
  modelProfile: 'us.amazon.nova-lite-v1:0',
  contentProcessingEnabled: true,
};

function template(): Template {
  const app = new cdk.App();
  const stack = new UiStack(app, 'TestUi', config, {
    assetsPath: path.resolve(process.cwd(), '../../apps/web/dist'),
  });
  return Template.fromStack(stack);
}

describe('UI plus real planning stack', () => {
  it('creates real upload, planning, calculation, and PPTX rendering resources', () => {
    const output = template();
    output.resourceCountIs('AWS::CloudFront::Distribution', 1);
    output.resourceCountIs('AWS::WAFv2::WebACL', 1);
    output.resourceCountIs('AWS::Cognito::UserPool', 1);
    output.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
    output.resourceCountIs('AWS::ApiGatewayV2::Api', 0);
    output.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    output.resourceCountIs('AWS::Lambda::Function', 4); // Planner API, PPTX renderer, plus CDK deployment providers.
    output.resourceCountIs('AWS::ECS::TaskDefinition', 1);
    output.resourceCountIs('AWS::ECS::Service', 0);
    output.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
    output.resourceCountIs('AWS::DynamoDB::Table', 1);
    output.hasResourceProperties('AWS::DynamoDB::Table', Match.objectLike({
      GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({
        IndexName: 'ownerSub-createdAt-index',
        KeySchema: Match.arrayWith([
          Match.objectLike({ AttributeName: 'ownerSub', KeyType: 'HASH' }),
          Match.objectLike({ AttributeName: 'createdAt', KeyType: 'RANGE' }),
        ]),
      })]),
    }));
    output.resourceCountIs('AWS::EC2::NatGateway', 0);
  });

  it('uses a private origin, invitation-only Cognito, and strict browser headers', () => {
    const output = template();
    output.hasResourceProperties('AWS::S3::Bucket', Match.objectLike({
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    }));
    output.hasResourceProperties('AWS::Cognito::UserPool', Match.objectLike({
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      MfaConfiguration: 'OPTIONAL',
    }));
    output.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', Match.objectLike({
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          ContentSecurityPolicy: Match.objectLike({
            ContentSecurityPolicy: Match.stringLikeRegexp("connect-src[^;]*https://\\*\\.s3\\.us-east-1\\.amazonaws\\.com"),
            Override: true,
          }),
          StrictTransportSecurity: Match.objectLike({ Override: true }),
        }),
      }),
    }));
  });
});
