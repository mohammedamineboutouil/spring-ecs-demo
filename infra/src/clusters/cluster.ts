import * as cdk from 'aws-cdk-lib';
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cloudmap from "aws-cdk-lib/aws-servicediscovery";

interface StackProps extends cdk.StackProps {
    dnsNamespace: string;
}

export class ClusterStack extends cdk.Stack {
    readonly vpc: ec2.Vpc;
    readonly cluster: ecs.Cluster;
    readonly service: cloudmap.IService;
    readonly namespace: cloudmap.PrivateDnsNamespace;

    constructor(scope: cdk.App, id: string, props: StackProps) {
        super(scope, id, props);
        // Create VPC
        this.vpc = new ec2.Vpc(this, `${id}-vpc`, {
            cidr: "10.0.0.0/16",
            maxAzs: 2,
            enableDnsSupport: true,
            subnetConfiguration: [
                {
                    cidrMask: 24,
                    name: 'public-subnet',
                    subnetType: ec2.SubnetType.PUBLIC,
                },
                {
                    cidrMask: 24,
                    name: 'private-subnet',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                }
            ]
        });

        // Create cluster
        this.cluster = new ecs.Cluster(this, `${id}-ecs-cluster`, {
            vpc: this.vpc,
            clusterName: `${id}-ecs-cluster`,
            enableFargateCapacityProviders: true,
            containerInsights: true,
        });

        // Create Service Discovery (Cloud Map) namespace
        this.namespace = new cloudmap.PrivateDnsNamespace(this, `${id}-namespace`, {
            name: props.dnsNamespace,
            description: `Service discovery namespace private dns ==> ${props.dnsNamespace}`,
            vpc: this.vpc
        });

        /*        this.service = this.namespace.createService(`${id}-service`, {
                    dnsRecordType: cloudmap.DnsRecordType.A_AAAA,
                    dnsTtl: cdk.Duration.seconds(30),
                    loadBalancer: true
                });*/

        this.cluster.addDefaultCloudMapNamespace({
            name: props.dnsNamespace,
            type: cloudmap.NamespaceType.DNS_PRIVATE,
            vpc: this.vpc
        });
    }
}
