#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== CloudForge ML — Full Deploy ==="

# 1. Deploy CDK stacks (containers built automatically via DockerImageAsset)
echo ""
echo "--- Step 1: CDK Deploy ---"
cd "$PROJECT_ROOT/infra"
pip install -r requirements.txt -q
cdk deploy --all --require-approval never

# 2. Get outputs for frontend env vars
echo ""
echo "--- Step 2: Fetching stack outputs ---"
API_URL=$(aws cloudformation describe-stacks --stack-name CloudForgeApi \
  --query 'Stacks[0].Outputs[?OutputKey==`RestApiEndpoint`].OutputValue' \
  --output text 2>/dev/null || echo "")
POOL_ID=$(aws cloudformation describe-stacks --stack-name CloudForgeAuth \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
  --output text 2>/dev/null || echo "")
CLIENT_ID=$(aws cloudformation describe-stacks --stack-name CloudForgeAuth \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' \
  --output text 2>/dev/null || echo "")

# 3. Build frontend with real env vars
echo ""
echo "--- Step 3: Building frontend ---"
cd "$PROJECT_ROOT/frontend"

cat > .env.local <<EOF
NEXT_PUBLIC_API_URL=${API_URL}
NEXT_PUBLIC_COGNITO_USER_POOL_ID=${POOL_ID}
NEXT_PUBLIC_COGNITO_CLIENT_ID=${CLIENT_ID}
NEXT_PUBLIC_COGNITO_REGION=ap-southeast-1
EOF

pnpm install
pnpm build

# 4. Re-deploy frontend stack (uploads built assets)
echo ""
echo "--- Step 4: Deploying frontend assets ---"
cd "$PROJECT_ROOT/infra"
cdk deploy CloudForgeFrontend --require-approval never

echo ""
echo "=== Deploy complete ==="
echo "API: $API_URL"
echo "Pool ID: $POOL_ID"
echo "Client ID: $CLIENT_ID"
