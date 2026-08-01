import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { applyWorkshopTags, WorkshopCloudConfig } from './config.js';
import { DataStack } from './data-stack.js';

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly taskSecurityGroup: ec2.SecurityGroup;
  public readonly endpointSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, config: WorkshopCloudConfig, data: DataStack, props?: cdk.StackProps) {
    super(scope, id, props);
    applyWorkshopTags(this, config);

    this.vpc = new ec2.Vpc(this, 'WorkshopVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    this.taskSecurityGroup = new ec2.SecurityGroup(this, 'WorkerTaskSecurityGroup', {
      vpc: this.vpc,
      description: 'No public ingress or broad egress for Workshop Cloud worker tasks.',
      allowAllOutbound: false,
    });

    this.endpointSecurityGroup = new ec2.SecurityGroup(this, 'EndpointSecurityGroup', {
      vpc: this.vpc,
      description: 'Accepts HTTPS only from Workshop Cloud task security group.',
      allowAllOutbound: false,
    });
    this.endpointSecurityGroup.addIngressRule(this.taskSecurityGroup, ec2.Port.tcp(443), 'Private HTTPS from worker tasks only');
    this.taskSecurityGroup.addEgressRule(this.endpointSecurityGroup, ec2.Port.tcp(443), 'HTTPS to approved VPC endpoints only');

    this.vpc.addGatewayEndpoint('S3GatewayEndpoint', { service: ec2.GatewayVpcEndpointAwsService.S3 });
    this.vpc.addGatewayEndpoint('DynamoDbGatewayEndpoint', { service: ec2.GatewayVpcEndpointAwsService.DYNAMODB });

    const endpointServices = [
      ec2.InterfaceVpcEndpointAwsService.ECR,
      ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      ec2.InterfaceVpcEndpointAwsService.SQS,
      ec2.InterfaceVpcEndpointAwsService.STEP_FUNCTIONS,
      ec2.InterfaceVpcEndpointAwsService.STS,
      ec2.InterfaceVpcEndpointAwsService.KMS,
      ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
    ];

    endpointServices.forEach((service, index) => {
      this.vpc.addInterfaceEndpoint(`PrivateEndpoint${index}`, {
        service,
        privateDnsEnabled: true,
        securityGroups: [this.endpointSecurityGroup],
        subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      });
    });

    const flowLogGroup = new logs.LogGroup(this, 'VpcFlowLogs', {
      encryptionKey: data.encryptionKey,
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    this.vpc.addFlowLog('VpcFlowLog', {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogGroup),
      trafficType: ec2.FlowLogTrafficType.ALL,
    });
  }
}
