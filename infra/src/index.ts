#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as clusters from './stacks';

const app = new cdk.App();

const environment = app.node.tryGetContext('environment');
const imagePrefix = app.node.tryGetContext('imagePrefix');

const stackName = `spring-ecs-test-${environment}`;
cdk.Tags.of(app).add('application', stackName);
cdk.Tags.of(app).add('environment', environment);

const clusterStack = new clusters.ClusterStack(app, `${stackName}-fargate-cluster`, {
    dnsNamespace: "hooka.local",
});

const servicesStack = new clusters.ServicesStack(app, `${stackName}-fargate-services`, {
    vpc: clusterStack.vpc,
    cluster: clusterStack.cluster,
    namespace: clusterStack.namespace,
    imagePrefix
});
servicesStack.addDependency(clusterStack);

