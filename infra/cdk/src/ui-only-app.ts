#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { loadWorkshopCloudConfig } from './config.js';
import { UiStack } from './ui-stack.js';

const app = new cdk.App();
const config = loadWorkshopCloudConfig(app);
const activeAccount = process.env.CDK_DEFAULT_ACCOUNT;
if (activeAccount && activeAccount !== config.account) {
  throw new Error(
    `Active CDK account ${activeAccount} does not match Workshop target ${config.account}.`,
  );
}

new UiStack(app, 'SmartReportWorkshopUiStack', config, {
  env: { account: config.account, region: config.region },
  description: 'Real Excel and Prompt AI planning through Fargate; stages after plan approval remain mock.',
});

app.synth();
