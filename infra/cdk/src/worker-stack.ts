import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { applyWorkshopTags, WorkshopCloudConfig } from './config.js';
import { DataStack } from './data-stack.js';
import { NetworkStack } from './network-stack.js';

export class WorkerStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly runnerRepository: ecr.Repository;
  public readonly rendererRepository: ecr.Repository;
  public readonly gateRepository: ecr.Repository;
  public readonly runnerTaskDefinition: ecs.FargateTaskDefinition;
  public readonly rendererTaskDefinition: ecs.FargateTaskDefinition;
  public readonly gateTaskDefinition: ecs.FargateTaskDefinition;

  constructor(scope: Construct, id: string, config: WorkshopCloudConfig, data: DataStack, network: NetworkStack, props?: cdk.StackProps) {
    super(scope, id, props);
    applyWorkshopTags(this, config);

    this.cluster = new ecs.Cluster(this, 'WorkshopCluster', {
      vpc: network.vpc,
      containerInsightsV2: ecs.ContainerInsights.ENHANCED,
    });

    this.runnerRepository = this.createRepository('RunnerRepository');
    this.rendererRepository = this.createRepository('RendererRepository');
    this.gateRepository = this.createRepository('GateRepository');

    this.runnerTaskDefinition = this.createBootstrapTask('RunnerTaskDefinition', this.runnerRepository, 'runner', data);
    this.rendererTaskDefinition = this.createBootstrapTask('RendererTaskDefinition', this.rendererRepository, 'renderer', data);
    this.gateTaskDefinition = this.createBootstrapTask('GateTaskDefinition', this.gateRepository, 'gate', data);
  }

  private createRepository(id: string): ecr.Repository {
    return new ecr.Repository(this, id, {
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ maxImageCount: 10, description: 'Retain only recent immutable workshop worker images.' }],
    });
  }

  private createBootstrapTask(id: string, repository: ecr.Repository, workerName: string, data: DataStack): ecs.FargateTaskDefinition {
    const taskDefinition = new ecs.FargateTaskDefinition(this, id, {
      cpu: 1024,
      memoryLimitMiB: 2048,
    });

    const logGroup = new logs.LogGroup(this, `${id}LogGroup`, {
      encryptionKey: data.encryptionKey,
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    taskDefinition.addContainer('BootstrapContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'bootstrap'),
      essential: true,
      readonlyRootFilesystem: true,
      environment: {
        WORKSHOP_STAGE: 'foundation-disabled',
        WORKER_NAME: workerName,
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: workerName, logGroup }),
    });

    return taskDefinition;
  }
}
