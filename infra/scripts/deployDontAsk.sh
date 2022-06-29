#!/usr/bin/env bash

set -euo pipefail

# import config variables.
source .env.config

# Deploy the cdk stack
echo "--- 🚀 Deploying CDK stack..."
cdk \
  -c environment="${ENVIRONMENT}" \
  --require-approval never \
  deploy
