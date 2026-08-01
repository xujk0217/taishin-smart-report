import * as cdk from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';
import { applyWorkshopTags, WorkshopCloudConfig } from './config.js';
import { DataStack } from './data-stack.js';

export class WorkflowStack extends cdk.Stack {
  public readonly stageQueue: sqs.Queue;
  public readonly stageDeadLetterQueue: sqs.Queue;
  public readonly bedrockInvocationQueue: sqs.Queue;
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, config: WorkshopCloudConfig, data: DataStack, props?: cdk.StackProps) {
    super(scope, id, props);
    applyWorkshopTags(this, config);

    this.stageDeadLetterQueue = this.createQueue('StageDeadLetterQueue', data);
    this.stageQueue = this.createQueue('StageQueue', data, this.stageDeadLetterQueue);
    this.bedrockInvocationQueue = this.createQueue('BedrockInvocationQueue', data);

    const stateMachineLogGroup = new logs.LogGroup(this, 'StateMachineLogGroup', {
      encryptionKey: data.encryptionKey,
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const disabled = new sfn.Fail(this, 'ContentProcessingDisabled', {
      error: 'ContentProcessingDisabled',
      cause: 'The workshop foundation is deployed but content processing has not passed its implementation gates.',
    });

    this.stateMachine = new sfn.StateMachine(this, 'WorkshopWorkflow', {
      stateMachineType: sfn.StateMachineType.STANDARD,
      definitionBody: sfn.DefinitionBody.fromChainable(disabled),
      tracingEnabled: true,
      timeout: cdk.Duration.hours(4),
      logs: {
        destination: stateMachineLogGroup,
        includeExecutionData: false,
        level: sfn.LogLevel.ERROR,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
  }

  private createQueue(id: string, data: DataStack, deadLetterQueue?: sqs.Queue): sqs.Queue {
    return new sqs.Queue(this, id, {
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: data.encryptionKey,
      retentionPeriod: cdk.Duration.days(4),
      visibilityTimeout: cdk.Duration.minutes(5),
      deadLetterQueue: deadLetterQueue
        ? { queue: deadLetterQueue, maxReceiveCount: 2 }
        : undefined,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
  }
}
