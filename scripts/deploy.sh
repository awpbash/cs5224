#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "============================================"
echo "  RetailMind — Full AWS Deployment"
echo "============================================"

# ── Pre-flight checks ──
echo ""
echo "[0/6] Pre-flight checks..."

command -v aws >/dev/null 2>&1 || { echo "ERROR: aws CLI not found. Install: https://aws.amazon.com/cli/"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not found. Install Docker Desktop."; exit 1; }
command -v cdk >/dev/null 2>&1 || { echo "ERROR: cdk not found. Run: npm install -g aws-cdk"; exit 1; }

# Check AWS credentials
aws sts get-caller-identity >/dev/null 2>&1 || { echo "ERROR: AWS credentials not configured. Run: aws configure"; exit 1; }
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "  AWS Account: $ACCOUNT_ID"
echo "  Region: ap-southeast-1"

# ── Step 1: Build Lambda layers ──
echo ""
echo "[1/6] Building Lambda layers..."

if [ ! -f "$PROJECT_ROOT/layers/sklearn-layer.zip" ]; then
  echo "  sklearn-layer.zip not found, building with Docker..."
  cd "$PROJECT_ROOT/layers"
  bash build-layers.sh
else
  echo "  sklearn-layer.zip already exists, skipping build."
fi

# ── Step 2: Install CDK dependencies ──
echo ""
echo "[2/6] Installing CDK dependencies..."
cd "$PROJECT_ROOT/infra"
pip install -r requirements.txt -q

# ── Step 3: Bootstrap CDK (if needed) ──
echo ""
echo "[3/6] Bootstrapping CDK (if needed)..."
cdk bootstrap aws://$ACCOUNT_ID/ap-southeast-1 2>/dev/null || echo "  Already bootstrapped."

# ── Step 4: Deploy all CDK stacks ──
echo ""
echo "[4/6] Deploying all CDK stacks (this takes ~10-15 min)..."
echo "  - CloudForgeNetwork (VPC)"
echo "  - CloudForgeStorage (S3 + DynamoDB)"
echo "  - CloudForgeAuth (Cognito)"
echo "  - CloudForgePipeline (Step Functions + ECS + ECR)"
echo "  - CloudForgeApi (API Gateway + 16 Lambdas)"
echo "  - CloudForgeFrontend (S3 + CloudFront)"
echo "  - CloudForgeMonitoring (CloudWatch)"
cdk deploy --all --require-approval never

# ── Step 5: Fetch stack outputs and rebuild frontend ──
echo ""
echo "[5/6] Fetching outputs & rebuilding frontend..."

# Try multiple output key patterns (CDK auto-generates names)
API_URL=$(aws cloudformation describe-stacks --stack-name CloudForgeApi \
  --query 'Stacks[0].Outputs[?contains(OutputKey,`CloudForgeApi`)].OutputValue' \
  --output text --region ap-southeast-1 2>/dev/null || echo "")

if [ -z "$API_URL" ]; then
  # Fallback: get any output that looks like a URL
  API_URL=$(aws cloudformation describe-stacks --stack-name CloudForgeApi \
    --query 'Stacks[0].Outputs[0].OutputValue' \
    --output text --region ap-southeast-1 2>/dev/null || echo "")
fi

POOL_ID=$(aws cloudformation describe-stacks --stack-name CloudForgeAuth \
  --query 'Stacks[0].Outputs[?contains(OutputKey,`UserPool`)].OutputValue' \
  --output text --region ap-southeast-1 2>/dev/null || echo "")

CLIENT_ID=$(aws cloudformation describe-stacks --stack-name CloudForgeAuth \
  --query 'Stacks[0].Outputs[?contains(OutputKey,`Client`)].OutputValue' \
  --output text --region ap-southeast-1 2>/dev/null || echo "")

echo "  API URL:    $API_URL"
echo "  Pool ID:    $POOL_ID"
echo "  Client ID:  $CLIENT_ID"

cd "$PROJECT_ROOT/frontend"

cat > .env.local <<EOF
NEXT_PUBLIC_API_URL=${API_URL}
NEXT_PUBLIC_COGNITO_USER_POOL_ID=${POOL_ID}
NEXT_PUBLIC_COGNITO_CLIENT_ID=${CLIENT_ID}
NEXT_PUBLIC_COGNITO_REGION=ap-southeast-1
EOF

# Use pnpm if available, fall back to npm
if command -v pnpm >/dev/null 2>&1; then
  pnpm install && pnpm build
else
  npm install && npm run build
fi

# ── Step 6: Redeploy frontend with real env vars ──
echo ""
echo "[6/6] Deploying frontend with real API URL..."
cd "$PROJECT_ROOT/infra"
cdk deploy CloudForgeFrontend --require-approval never

# ── Done ──
CF_URL=$(aws cloudformation describe-stacks --stack-name CloudForgeFrontend \
  --query 'Stacks[0].Outputs[?contains(OutputKey,`Domain`) || contains(OutputKey,`Url`) || contains(OutputKey,`Distribution`)].OutputValue' \
  --output text --region ap-southeast-1 2>/dev/null || echo "(check CloudFront console)")

echo ""
echo "============================================"
echo "  DEPLOYMENT COMPLETE"
echo "============================================"
echo ""
echo "  App URL:     https://$CF_URL"
echo "  API URL:     $API_URL"
echo "  Pool ID:     $POOL_ID"
echo "  Client ID:   $CLIENT_ID"
echo ""
echo "  Next steps:"
echo "  1. Enable Bedrock Claude 3 Haiku in ap-southeast-1 (AWS Console)"
echo "  2. Seed preloaded datasets: bash scripts/seed-data.sh"
echo "  3. Open the App URL and sign up"
echo ""
