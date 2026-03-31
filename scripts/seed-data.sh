#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Seeding preloaded datasets to S3 ==="

BUCKET=$(aws cloudformation describe-stacks --stack-name CloudForgeStorage \
  --query 'Stacks[0].Outputs[?OutputKey==`DataBucketName`].OutputValue' \
  --output text --region ap-southeast-1 2>/dev/null || echo "")

if [ -z "$BUCKET" ]; then
  ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
  BUCKET="cloudforge-data-${ACCOUNT_ID}"
fi

echo "Bucket: $BUCKET"

# Check if test data exists
DATA_DIR="$PROJECT_ROOT/backend/test_data"
if [ ! -d "$DATA_DIR" ]; then
  echo ""
  echo "WARNING: $DATA_DIR not found."
  echo "Create this directory with sample CSV files:"
  echo "  sample_churn.csv              → preloaded/retail-churn.csv"
  echo "  sample_supermarket_sales.csv  → preloaded/supermarket-sales.csv"
  echo "  sample_mall_customers.csv     → preloaded/customer-segmentation.csv"
  echo "  sample_store_demand.csv       → preloaded/store-demand.csv"
  echo ""
  echo "Download from Kaggle:"
  echo "  https://www.kaggle.com/datasets/blastchar/telco-customer-churn"
  echo "  https://www.kaggle.com/datasets/aungpyaeap/supermarket-sales"
  echo "  https://www.kaggle.com/datasets/vjchoudhary7/customer-segmentation-tutorial-in-python"
  echo "  https://www.kaggle.com/competitions/demand-forecasting-kernels-only"
  exit 1
fi

for file_map in \
  "sample_churn.csv:preloaded/retail-churn.csv" \
  "sample_supermarket_sales.csv:preloaded/supermarket-sales.csv" \
  "sample_mall_customers.csv:preloaded/customer-segmentation.csv" \
  "sample_store_demand.csv:preloaded/store-demand.csv"; do

  src="${file_map%%:*}"
  dst="${file_map##*:}"

  if [ -f "$DATA_DIR/$src" ]; then
    echo "  Uploading $src → s3://$BUCKET/$dst"
    aws s3 cp "$DATA_DIR/$src" "s3://$BUCKET/$dst" --region ap-southeast-1
  else
    echo "  SKIP: $DATA_DIR/$src not found"
  fi
done

echo ""
echo "Done! Verify with: aws s3 ls s3://$BUCKET/preloaded/"
