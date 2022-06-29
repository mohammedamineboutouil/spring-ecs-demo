#!/usr/bin/env bash

set -euo pipefail

# import config variables.
source .env.config

# Deploy the cdk stack
echo "--- 🚀 Destroying CDK stack..."
cdk \
  -c environment="${ENVIRONMENT}" \
  destroy --all --force
