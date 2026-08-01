#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ApiStack } from './api-stack.js';
import { loadWorkshopCloudConfig } from './config.js';
import { DataStack } from './data-stack.js';
import { NetworkStack } from './network-stack.js';
import { ObservabilityStack } from './observability-stack.js';
import { WorkerStack } from './worker-stack.js';
import { WorkflowStack } from './workflow-stack.js';

const app = new cdk.App();
const config = loadWorkshopCloudConfig(app);
const activeAccount = process.env.CDK_DEFAULT_ACCOUNT;
if (activeAccount && activeAccount !== config.account) {
  throw new Error(
    `Active CDK account ${activeAccount} does not match Workshop target ${config.account}. Authenticate the AWS CLI for the target account before synthesizing or deploying.`,
  );
}

const env = {
  account: config.account,
  region: config.region,
};

const data = new DataStack(app, 'SmartReportWorkshopDataStack', config, { env });
const network = new NetworkStack(app, 'SmartReportWorkshopNetworkStack', config, data, { env });
const workers = new WorkerStack(app, 'SmartReportWorkshopWorkerStack', config, data, network, { env });
const workflow = new WorkflowStack(app, 'SmartReportWorkshopWorkflowStack', config, data, { env });
const api = new ApiStack(app, 'SmartReportWorkshopApiStack', config, data, { env });
const observability = new ObservabilityStack(app, 'SmartReportWorkshopObservabilityStack', config, api, workflow, { env });

network.addStackDependency(data);
workers.addStackDependency(network);
workers.addStackDependency(data);
workflow.addStackDependency(data);
api.addStackDependency(data);
observability.addStackDependency(api);
observability.addStackDependency(workflow);
observability.addStackDependency(workers);

app.synth();
