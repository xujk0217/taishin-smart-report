import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

export interface WorkshopCloudConfig {
  readonly stage: 'workshop';
  readonly account: '450567357211';
  readonly region: 'us-east-1';
  readonly modelProfile: string;
  readonly contentProcessingEnabled: boolean;
}

const WORKSHOP_ACCOUNT = '450567357211';
const WORKSHOP_REGION = 'us-east-1';
const DEFAULT_MODEL_PROFILE = 'us.amazon.nova-lite-v1:0';

export function loadWorkshopCloudConfig(app: cdk.App): WorkshopCloudConfig {
  const stage = app.node.tryGetContext('stage') ?? process.env.SMART_REPORT_STAGE ?? 'workshop';
  const account = app.node.tryGetContext('account') ?? WORKSHOP_ACCOUNT;
  const region = app.node.tryGetContext('region') ?? WORKSHOP_REGION;
  const modelProfile = app.node.tryGetContext('modelProfile') ?? DEFAULT_MODEL_PROFILE;
  const contentProcessingEnabled = app.node.tryGetContext('enableContentProcessing') === true;

  if (stage !== 'workshop') {
    throw new Error('Only the workshop stage is supported by this CDK application.');
  }

  if (account !== WORKSHOP_ACCOUNT) {
    throw new Error(`Workshop Cloud must target account ${WORKSHOP_ACCOUNT}; received ${account}.`);
  }

  if (region !== WORKSHOP_REGION) {
    throw new Error(`Workshop Cloud must deploy in ${WORKSHOP_REGION}; received ${region}.`);
  }

  if (typeof modelProfile !== 'string' || modelProfile.trim().length === 0) {
    throw new Error('A single approved Bedrock inference profile must be configured.');
  }

  return {
    stage: 'workshop',
    account: WORKSHOP_ACCOUNT,
    region: WORKSHOP_REGION,
    modelProfile,
    contentProcessingEnabled,
  };
}

export function applyWorkshopTags(scope: IConstruct, config: WorkshopCloudConfig): void {
  cdk.Tags.of(scope).add('System', 'smart-report-generator');
  cdk.Tags.of(scope).add('Stage', config.stage);
  cdk.Tags.of(scope).add('DataClassification', 'workshop-approved-only');
  cdk.Tags.of(scope).add('ContentProcessing', String(config.contentProcessingEnabled));
}
