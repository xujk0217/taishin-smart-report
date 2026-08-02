import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { WorkshopCloudConfig } from './config.js';
import { DataStack } from './data-stack.js';
import { WorkflowStack } from './workflow-stack.js';

const config: WorkshopCloudConfig = {
  stage: 'workshop',
  account: '450567357211',
  region: 'us-east-1',
  modelProfile: 'us.amazon.nova-lite-v1:0',
  contentProcessingEnabled: false,
};

describe('Workshop Cloud foundation', () => {
  it('creates private, KMS-encrypted, TLS-only buckets', () => {
    const app = new cdk.App();
    const data = new DataStack(app, 'TestData', config);
    const template = Template.fromStack(data);

    template.resourceCountIs('AWS::S3::Bucket', 5);
    template.hasResourceProperties('AWS::S3::Bucket', Match.objectLike({
      BucketEncryption: Match.anyValue(),
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      OwnershipControls: {
        Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }],
      },
      VersioningConfiguration: { Status: 'Enabled' },
    }));
    template.hasResourceProperties('AWS::S3::BucketPolicy', Match.objectLike({
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: 'Deny', Condition: Match.objectLike({ Bool: { 'aws:SecureTransport': 'false' } }) }),
        ]),
      }),
    }));
  });

  it('uses a disabled Standard workflow and KMS-encrypted queues', () => {
    const app = new cdk.App();
    const data = new DataStack(app, 'TestData', config);
    const workflow = new WorkflowStack(app, 'TestWorkflow', config, data);
    const template = Template.fromStack(workflow);

    template.resourceCountIs('AWS::SQS::Queue', 3);
    template.hasResourceProperties('AWS::StepFunctions::StateMachine', Match.objectLike({
      StateMachineType: 'STANDARD',
      TracingConfiguration: { Enabled: true },
      DefinitionString: Match.serializedJson(Match.objectLike({
        States: Match.objectLike({
          ContentProcessingDisabled: Match.objectLike({ Type: 'Fail' }),
        }),
      })),
    }));
  });
});
