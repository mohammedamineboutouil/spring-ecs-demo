import * as cdk from 'aws-cdk-lib';
import {RemovalPolicy} from 'aws-cdk-lib';
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudmap from "aws-cdk-lib/aws-servicediscovery";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as msk from "@aws-cdk/aws-msk-alpha";

interface StackProps extends cdk.StackProps {
    /**
     * The VPC to run the cluster in
     */
    readonly vpc: ec2.IVpc;
    /**
     * The ECS Cluster
     */
    readonly cluster: ecs.ICluster;
    /**
     * Namespace
     */
    readonly namespace: cloudmap.PrivateDnsNamespace;
    /**
     * Image Prefix
     */
    readonly imagePrefix: string;
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

export class ServicesStack extends cdk.Stack {
    readonly kafkaCluster: msk.Cluster;
    readonly serviceSecurityGroup: ec2.SecurityGroup;

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

        // Kafka Cluster
        const kafkaSecurityGroup = new ec2.SecurityGroup(this, `${id}-kafka-security-group`, {
            vpc: props.vpc,
            allowAllOutbound: true,
            securityGroupName: `${id}-kafka-security-group`
        });

        // const amazonMskEncryptionKey = new kms.Key(this, 'tRCAmazonMskKey', {
        //     alias: 'tRCAmazonMskKey',
        //     description: 'Amazon MSK Encryption Key',
        //     enableKeyRotation: true,
        //     removalPolicy: cdk.RemovalPolicy.DESTROY
        // });

        this.kafkaCluster = new msk.Cluster(this, `${id}-kafka-cluster`, {
            clusterName: `${id}-kafka-cluster`,
            numberOfBrokerNodes: 2,
            ebsStorageInfo: {
                volumeSize: 5
            },
            kafkaVersion: msk.KafkaVersion.V2_8_1,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
            securityGroups: [kafkaSecurityGroup],
            vpcSubnets: props.vpc.selectSubnets({subnetType: ec2.SubnetType.PRIVATE_ISOLATED}),
            // encryptionInTransit: {
            //     enableInCluster: true,
            //     clientBroker: msk.ClientBrokerEncryption.TLS
            // },
            // clientAuthentication: {
            //     saslProps: {
            //         key: amazonMskEncryptionKey
            //     }
            // },
            removalPolicy: RemovalPolicy.DESTROY,
            vpc: props.vpc,
        });

        new cdk.CfnOutput(this, `${id}-bootstrap-address`, {
            value: this.kafkaCluster.zookeeperConnectionString
        });

        // Create Security Group to allow traffic to the Services
        this.serviceSecurityGroup = new ec2.SecurityGroup(this, `${id}-service-security-group`, {
            vpc: props.vpc,
            allowAllOutbound: true,
            securityGroupName: `${id}-service-security-group`
        });
        this.serviceSecurityGroup.addIngressRule(ec2.Peer.ipv4(props.vpc.vpcCidrBlock), ec2.Port.tcp(8080), 'Allow traffic to Fargate HTTP API service.');
        kafkaSecurityGroup.addIngressRule(this.serviceSecurityGroup, ec2.Port.allTraffic(), "Allow From Services To Kafka");

        // Services
        const services = [
            {
                serviceName: "gateway",
                loadBalanced: true,
            },
            /*            {
                            serviceName: "authz",
                            loadBalanced: false,
                        },
                        {
                            serviceName: "company",
                            loadBalanced: false,
                        },
                        {
                            serviceName: "transaction",
                            loadBalanced: false,
                        },*/
        ];
        const environments = {
            "SERVER_PORT": "8080",
            "KAFKA_SERVERS": this.kafkaCluster.zookeeperConnectionString,
        };
        for (const {serviceName, loadBalanced} of services) {
            const taskDefinition = this.taskDefinitionBuilder(serviceName, `${props.imagePrefix}${serviceName}`,
                taskRole, logGroup, environments
            );
            if (loadBalanced) {
                this.createEcsLoadBalancedService(serviceName, props, taskDefinition);
            } else {
                this.createEcsService(serviceName, props, taskDefinition);
            }
        }
        // const service = props.namespace.createService(`${id}-service`, {
        //     dnsRecordType: cloudmap.DnsRecordType.A_AAAA,
        //     dnsTtl: cdk.Duration.seconds(30),
        //     loadBalancer: true
        // });
        //
        // service.registerLoadBalancer(`${id}-log-loadbalancer`, gatewayService.loadBalancer);
    }

    public taskDefinitionBuilder(serviceName: string, repositoryName: string,
                                 taskRole: iam.IRole, logGroup: logs.ILogGroup,
                                 environment: { [key: string]: string; },): ecs.TaskDefinition {
        // ECS resources
        const taskDefinition = new ecs.FargateTaskDefinition(this, `${serviceName}-task-definition`, {
            cpu: 512,
            memoryLimitMiB: 1024,
            taskRole
        });
        // ECR repository
        const repository = ecr.Repository.fromRepositoryName(this, repositoryName, repositoryName);
        // Container definition
        const container = new ecs.ContainerDefinition(this, `${serviceName}-container`, {
            image: ecs.ContainerImage.fromEcrRepository(repository),
            containerName: `${serviceName}-container`,
            taskDefinition,
            environment: environment,
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
            securityGroups: [this.serviceSecurityGroup],
            vpcSubnets: props.vpc.selectSubnets({subnetType: ec2.SubnetType.PRIVATE_ISOLATED})
        });
    };

    public createEcsLoadBalancedService(serviceName: string, props: StackProps,
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
            },
            platformVersion: ecs.FargatePlatformVersion.LATEST,
            securityGroups: [securityGroup, this.serviceSecurityGroup],
            taskSubnets: props.vpc.selectSubnets({subnetType: ec2.SubnetType.PUBLIC})
        });
    };
}
