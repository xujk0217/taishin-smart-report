import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import { applyWorkshopTags, WorkshopCloudConfig } from './config.js';
import { ApiStack } from './api-stack.js';
import { WorkflowStack } from './workflow-stack.js';

export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, config: WorkshopCloudConfig, api: ApiStack, workflow: WorkflowStack, props?: cdk.StackProps) {
    super(scope, id, props);
    applyWorkshopTags(this, config);

    const dashboard = new cloudwatch.Dashboard(this, 'WorkshopOperationsDashboard', {
      dashboardName: `${cdk.Stack.of(this).stackName}-operations`,
    });
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Workflow failures',
        left: [workflow.stateMachine.metricFailed(), workflow.stateMachine.metricTimedOut()],
      }),
      new cloudwatch.GraphWidget({
        title: 'Queue health',
        left: [
          workflow.stageQueue.metricApproximateAgeOfOldestMessage(),
          workflow.stageDeadLetterQueue.metricApproximateNumberOfMessagesVisible(),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'Jobs API errors',
        left: [api.api.metricServerError(), api.api.metricClientError()],
      }),
    );

    new cloudwatch.Alarm(this, 'DeadLetterQueueAlarm', {
      metric: workflow.stageDeadLetterQueue.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, 'WorkflowFailureAlarm', {
      metric: workflow.stateMachine.metricFailed(),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, 'JobsApi5xxAlarm', {
      metric: api.api.metricServerError(),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}
