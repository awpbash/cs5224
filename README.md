# RetailMind

No-code ML platform for retail SMEs. Upload your data, describe your business problem, and get a trained model with plain-English recommendations.

Built on 12 AWS services.

---

## What It Does

1. **Describe your problem** - Use the AI chatbot or pick a template (churn prediction, demand forecasting, customer segmentation)
2. **Upload data** - Drag-and-drop a CSV or choose from preloaded datasets
3. **Automatic profiling** - Data quality checks, distributions, and feature analysis
4. **Train a model** - AutoML tries up to 8 algorithms with cross-validation and picks the best
5. **Get insights** - Business-language summary, feature importance, and AI-generated recommendations
6. **Run predictions** - Enter new data and get instant predictions

---

## Architecture

```
Browser (Next.js SPA)
    |
    +-- CloudFront --> S3 (static frontend)
    +-- Cognito (auth)
    +-- API Gateway (17 routes)
              |
              v
         AWS Lambda (16 functions)
          +-- DynamoDB (3 tables)
          +-- S3 (data storage)
          +-- Bedrock (Claude 3 Haiku)
          +-- Step Functions (ML pipeline)
                |
                v
          ProfileData -> ETL -> AutoSelect ->
          Train (ECS Fargate) -> Evaluate -> Deploy
```

| Service | Purpose |
|---------|---------|
| Cognito | User authentication and JWT tokens |
| API Gateway | REST API with Cognito authorizer |
| Lambda | 16 backend functions (Python 3.12) |
| DynamoDB | Projects, jobs, and chat history |
| S3 | Data storage and frontend hosting |
| CloudFront | CDN for the frontend SPA |
| Step Functions | 6-step ML training pipeline |
| ECS Fargate | Serverless model training containers |
| ECR | Docker image registry |
| Bedrock | Claude 3 Haiku for chatbot and recommendations |
| CloudWatch | Monitoring, logs, and alarms |
| VPC | Networking for Fargate tasks |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for full details.

---

## Project Structure

```
retailmind/
├── frontend/                  # Next.js + TypeScript SPA
├── backend/
│   ├── lambdas/api/           # API Gateway handlers
│   ├── lambdas/pipeline/      # Step Functions task handlers
│   ├── lambdas/events/        # EventBridge handlers
│   └── shared/                # Shared utilities (Lambda layer)
├── containers/tabular-automl/ # AutoML container (19 models)
├── infra/stacks/              # AWS CDK (7 stacks)
├── scripts/                   # Deploy, test, and analysis scripts
├── layers/                    # Lambda layers (sklearn)
├── results/                   # Load test and security test outputs
└── docs/                      # Architecture docs and diagrams
```

---

## Getting Started

### Prerequisites

- AWS CLI v2+, CDK v2+, Python 3.12, Node.js 18+, Docker
- AWS credentials configured for `ap-southeast-1`
- Bedrock access enabled for Claude 3 Haiku

### Deploy

```bash
# Build the sklearn Lambda layer
cd layers && bash build-layers.sh

# Install CDK dependencies and bootstrap
cd ../infra && pip install -r requirements.txt
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
cdk bootstrap aws://$ACCOUNT_ID/ap-southeast-1

# Build frontend and deploy all stacks
cd ../frontend && npm install && npm run build
cd ../infra && cdk deploy --all --require-approval broadening

# Update frontend/.env.local with CDK outputs, rebuild, redeploy
cd ../frontend && npm run build
cd ../infra && cdk deploy CloudForgeFrontend

# Seed sample datasets
cd .. && bash scripts/seed-data.sh
```

### Frontend Environment

Create `frontend/.env.local` with outputs from the CDK deploy:

```
NEXT_PUBLIC_API_URL=https://xxxxxxxxxx.execute-api.ap-southeast-1.amazonaws.com/prod
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-southeast-1_xxxxxxxxx
NEXT_PUBLIC_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_COGNITO_REGION=ap-southeast-1
```

---

## Local Development

```bash
cd frontend && npm install && npm run dev    # http://localhost:3000
cd backend && pip install -r requirements.txt && python -m pytest tests/
cd infra && cdk synth
```

---

## Testing

```bash
# Load test (varying concurrency against CloudFront + API Gateway)
export COGNITO_TOKEN="your-jwt-token"
bash scripts/load-test.sh
python scripts/plot-load-test.py

# Security test (auth, data isolation, input validation, CORS, cold starts)
bash scripts/test-security.sh
python scripts/plot-tests.py
```

Results and charts are saved to `results/`.

---

## ML Training

The AutoML container supports 19 models:

- **Classification:** Logistic Regression, Decision Tree, Random Forest, Gradient Boosting, XGBoost, LightGBM, KNN, SVM
- **Regression:** Linear Regression, Ridge, Lasso, ElasticNet, Decision Tree, Random Forest, Gradient Boosting, XGBoost, LightGBM, KNN, SVM

Auto mode selects candidates based on dataset size, runs cross-validation with hyperparameter search, and picks the best. Single mode trains one specified model.

---

## Cost

| Service | Monthly |
|---------|---------|
| Most services | $0 (free tier) |
| ECS Fargate | ~$2-5 |
| Bedrock | ~$1-3 |
| S3 + ECR | ~$0.50 |
| **Total** | **~$5-12** |

---

## Teardown

```bash
cd infra && cdk destroy --all
```

Manually delete non-empty S3 buckets, ECR images, and CloudWatch log groups.
