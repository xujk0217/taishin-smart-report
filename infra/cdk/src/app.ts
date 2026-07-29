#!/usr/bin/env node
/**
 * CDK App - Smart Report Generator (智匯數據簡報神器)
 */
import * as cdk from 'aws-cdk-lib';
import { DataStack } from './data-stack.js';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

// Data Stack (S3, DynamoDB, KMS)
const dataStack = new DataStack(app, 'SmartReportDataStack', { env });

// TODO: Add ApiStack, WorkflowStack, FrontendStack, ObservabilityStack
// These will be added as we build out the services

app.synth();
