#!/usr/bin/env bash

set -euo pipefail

# import config variables.
source .env.config

# Deploy the cdk stack
echo "--- 🚀 Deploying CDK stack..."
cdk \
  -c environment="${ENVIRONMENT}" \
  -c imagePrefix="${IMAGE_PREFIX}" \
  --require-approval never \
  deploy --all
