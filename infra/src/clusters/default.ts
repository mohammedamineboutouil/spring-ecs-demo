import * as cdk from 'aws-cdk-lib';
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudmap from "aws-cdk-lib/aws-servicediscovery";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as iam from "aws-cdk-lib/aws-iam";

interface StackProps extends cdk.StackProps {
    /**
     * The VPC to run the cluster in
     */
    readonly  vpc: ec2.IVpc;
    /**
     * The ECS Cluster
     */
    readonly  cluster: ecs.ICluster;
    /**
     * Service discovery
     */
    // readonly  service: cloudmap.Service;
    /**
     * Namespace
     */
    readonly namespace: cloudmap.INamespace;
    /**
     * How long to store the GitHub runner logs
     * @default - 7 days
     */
    readonly logRetentionDays?: number;
    /**
     * Use Fargate SPOT capacity
     * @default - true
     */
    readonly useSpotCapacity?: boolean;
}

export class DefaultStack extends cdk.Stack {
    constructor(scope: cdk.App, id: string, props: StackProps) {
        super(scope, id, props);
        const logRetentionDays = props.logRetentionDays ?? logs.RetentionDays.ONE_WEEK;
        // Log group
        const logGroup = new logs.LogGroup(this, `${id}-log-group`, {
            logGroupName: `${id}-log-group`,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            retention: logRetentionDays
        });

        const taskRole = new iam.Role(this, `${id}-task-role`, {
            assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        });
        taskRole.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName(
                "service-role/AmazonECSTaskExecutionRolePolicy"
            )
        );

        // Create Security Group to allow traffic to the Service
        const serviceSecurityGroup = new ec2.SecurityGroup(this, `${id}-service-security-group`, {
            vpc: props.vpc,
            allowAllOutbound: true,
            description: 'Allow traffic to Fargate HTTP API service.',
            securityGroupName: `${id}-service-security-group`
        });
        serviceSecurityGroup.addIngressRule(ec2.Peer.ipv4(props.vpc.vpcCidrBlock), ec2.Port.tcp(8080));

        // Services
        const gatewayService = this.createEcsLoadBalancedService("gateway", props, serviceSecurityGroup,
            this.taskDefinitionBuilder("gateway", `${id}-gateway`,
                props, taskRole, logGroup
            )
        )
        /*
                props.service.registerLoadBalancer(`${id}-log-loadbalancer`, gatewayService.loadBalancer);
        */
    }

    public taskDefinitionBuilder(serviceName: string, repositoryName: string,
                                 props: StackProps, taskRole: iam.IRole, logGroup: logs.ILogGroup): ecs.TaskDefinition {
        // ECR repository
        const repository = ecr.Repository.fromRepositoryName(this, `${serviceName}-repository`, repositoryName);
        // ECS resources
        const taskDefinition = new ecs.FargateTaskDefinition(this, `${serviceName}-task-definition`, {
            cpu: 512,
            memoryLimitMiB: 1024,
            taskRole
        });
        const container = new ecs.ContainerDefinition(this, `${serviceName}-container`, {
            image: ecs.ContainerImage.fromEcrRepository(repository),
            containerName: `${serviceName}-container`,
            taskDefinition,
            logging: ecs.LogDriver.awsLogs({
                logGroup,
                streamPrefix: `${serviceName}-`,
            })
        });
        container.addPortMappings({
            containerPort: 8080,
            protocol: ecs.Protocol.TCP
        });
        return taskDefinition;
    };

    public createEcsService(serviceName: string, props: StackProps,
                            serviceSecurityGroup: ec2.ISecurityGroup,
                            taskDefinition: ecs.TaskDefinition): ecs.FargateService {
        const useSpotCapacity = props.useSpotCapacity ?? true;
        return new ecs.FargateService(this, `${serviceName}-service`, {
            serviceName: `${serviceName}-service`,
            taskDefinition,
            cluster: props.cluster,
            desiredCount: 1,
            circuitBreaker: {
                rollback: true
            },
            cloudMapOptions: {
                name: serviceName,
                cloudMapNamespace: props.namespace,
                dnsRecordType: cloudmap.DnsRecordType.SRV,
            },
            platformVersion: ecs.FargatePlatformVersion.LATEST,
            capacityProviderStrategies: [
                {
                    capacityProvider: "FARGATE_SPOT",
                    weight: useSpotCapacity ? 1 : 0,
                },
                {
                    capacityProvider: "FARGATE",
                    weight: useSpotCapacity ? 0 : 1,
                },
            ],
            securityGroups: [serviceSecurityGroup],
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED
            }
        });
    };

    public createEcsLoadBalancedService(serviceName: string, props: StackProps,
                                        serviceSecurityGroup: ec2.ISecurityGroup,
                                        taskDefinition: ecs.TaskDefinition): ecsPatterns.ApplicationLoadBalancedFargateService {
        const securityGroup = new ec2.SecurityGroup(this, `${serviceName}-service-security-group`, {
                allowAllOutbound: true,
                securityGroupName: `${serviceName}-service-security-group`,
                vpc: props.vpc,
            }
        );
        securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8080));
        return new ecsPatterns.ApplicationLoadBalancedFargateService(this, `${serviceName}-service`, {
            serviceName: `${serviceName}-service`,
            taskDefinition: taskDefinition,
            cluster: props.cluster,
            publicLoadBalancer: true,
            desiredCount: 1,
            circuitBreaker: {
                rollback: true
            },
            cloudMapOptions: {
                name: serviceName,
                cloudMapNamespace: props.namespace,
                dnsRecordType: cloudmap.DnsRecordType.SRV,
            },
            platformVersion: ecs.FargatePlatformVersion.LATEST,
            securityGroups: [securityGroup, serviceSecurityGroup],
            taskSubnets: {
                subnetType: ec2.SubnetType.PUBLIC
            }
        });
    };
}
