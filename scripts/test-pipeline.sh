#!/usr/bin/env bash
set -euo pipefail

echo "=== Testing pipeline execution ==="

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
STATE_MACHINE_ARN="arn:aws:states:ap-southeast-1:${ACCOUNT_ID}:stateMachine:cloudforge-pipeline"

INPUT=$(cat <<'JSON'
{
  "userId": "test-user",
  "projectId": "test-project",
  "jobId": "test-job-001",
  "taskType": "tabular-classification",
  "dataSource": "uploaded",
  "datasetS3Path": "test-user/test-project/raw/iris.csv",
  "classLabels": [],
  "hyperparameters": {}
}
JSON
)

EXECUTION_ARN=$(aws stepfunctions start-execution \
  --state-machine-arn "$STATE_MACHINE_ARN" \
  --name "test-$(date +%s)" \
  --input "$INPUT" \
  --query 'executionArn' \
  --output text)

echo "Started execution: $EXECUTION_ARN"
echo ""
echo "Monitor at:"
echo "  aws stepfunctions describe-execution --execution-arn $EXECUTION_ARN"
echo ""
echo "Or watch status:"
echo "  watch -n5 aws stepfunctions describe-execution --execution-arn $EXECUTION_ARN --query status --output text"
