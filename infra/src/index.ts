#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as process from 'process';
import * as clusters from './clusters';

const app = new cdk.App();

const environment = app.node.tryGetContext('environment');

const stackName = `spring-ecs-demo-${environment}`;
cdk.Tags.of(app).add('application', stackName);
cdk.Tags.of(app).add('environment', environment);

const cluster = new clusters.ClusterStack(app, stackName, {
    dnsNamespace: "hook.local",
    env: {account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION},
});

const stack = new clusters.DefaultStack(app, stackName, {
    vpc: cluster.vpc, cluster: cluster.cluster, namespace: cluster.namespace,
    env: {account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION},
});

stack.addDependency(cluster);

