# RetailMind

**No-code ML platform for retail SMEs.** Upload your data, describe your business problem, and get a trained model with plain-English recommendations — no data science expertise required.

Built on 12 AWS services for CS5224 Cloud Computing at the National University of Singapore.

---

## What It Does

1. **Describe your problem** — Use the AI chatbot or pick a template (churn prediction, demand forecasting, customer segmentation)
2. **Upload data** — Drag-and-drop a CSV or choose from preloaded Kaggle datasets
3. **Automatic profiling** — Data quality checks, distributions, and feature analysis
4. **Train a model** — AutoML tries up to 8 algorithms with cross-validation, picks the best
5. **Get insights** — Business-language summary, feature importance, and AI-generated recommendations
6. **Run predictions** — Enter new data and get instant predictions from your trained model

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

### AWS Services

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
│   └── src/
│       ├── app/               # Pages (dashboard, projects, auth)
│       ├── components/        # Reusable UI components
│       ├── hooks/             # React hooks (auth, polling)
│       └── lib/               # API client, types, auth helpers
│
├── backend/
│   ├── lambdas/
│   │   ├── api/               # 16 API Gateway handlers
│   │   ├── pipeline/          # Step Functions task handlers
│   │   └── events/            # EventBridge handlers
│   └── shared/                # Shared utilities (Lambda layer)
│
├── containers/
│   └── tabular-automl/        # AutoML container (19 models)
│
├── infra/                     # AWS CDK stacks (Python)
│   └── stacks/                # 7 stacks (storage, auth, api, pipeline, etc.)
│
├── scripts/                   # Deployment, testing, and analysis scripts
├── layers/                    # Lambda layers (sklearn)
├── results/                   # Load test and security test outputs
└── docs/                      # Architecture docs and diagrams
```

---

## Getting Started

### Prerequisites

| Tool | Version |
|------|---------|
| AWS CLI | v2+ |
| AWS CDK | v2+ |
| Python | 3.12 |
| Node.js | 18+ |
| Docker | Desktop |

AWS credentials must be configured for `ap-southeast-1` and Bedrock access must be enabled for Claude 3 Haiku.

### Deploy

```bash
# 1. Build the sklearn Lambda layer
cd layers && bash build-layers.sh

# 2. Install CDK dependencies
cd ../infra && pip install -r requirements.txt

# 3. Bootstrap CDK (first time only)
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
cdk bootstrap aws://$ACCOUNT_ID/ap-southeast-1

# 4. Build the frontend
cd ../frontend && npm install && npm run build

# 5. Deploy all stacks
cd ../infra && cdk deploy --all --require-approval broadening

# 6. Update frontend/.env.local with outputs from step 5, rebuild, and redeploy
cd ../frontend && npm run build
cd ../infra && cdk deploy CloudForgeFrontend

# 7. Seed sample datasets
cd .. && bash scripts/seed-data.sh
```

Or use the all-in-one script:

```bash
bash scripts/deploy.sh
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
# Frontend
cd frontend && npm install && npm run dev

# Backend tests
cd backend && pip install -r requirements.txt
python -m pytest tests/

# CDK
cd infra && pip install -r requirements.txt
cdk synth    # preview CloudFormation
cdk diff     # see what would change
```

---

## Testing

### Load Testing

Hits CloudFront and API Gateway at varying concurrency levels (1, 10, 25, 50, 100 concurrent requests):

```bash
export COGNITO_TOKEN="your-jwt-token"
bash scripts/load-test.sh
python scripts/plot-load-test.py    # generates charts in results/
```

### Security Testing

Tests authentication, data isolation, input validation, CORS, and cold start behaviour:

```bash
export COGNITO_TOKEN="your-jwt-token"
bash scripts/test-security.sh
python scripts/plot-tests.py        # generates charts in results/
```

---

## ML Training

The AutoML container supports 19 models across classification and regression:

**Classification (8):** Logistic Regression, Decision Tree, Random Forest, Gradient Boosting, XGBoost, LightGBM, KNN, SVM

**Regression (11):** Linear Regression, Ridge, Lasso, ElasticNet, Decision Tree, Random Forest, Gradient Boosting, XGBoost, LightGBM, KNN, SVM

In **auto mode**, the container selects candidates based on dataset size, runs cross-validation with hyperparameter search, and picks the best model. In **single mode**, it trains one specified model.

---

## Cost

| Service | Monthly Cost |
|---------|-------------|
| Most services | $0 (free tier) |
| ECS Fargate | ~$2-5 (~$0.05/job) |
| Bedrock | ~$1-3 (per-token) |
| S3 + ECR | ~$0.50 |
| **Total** | **~$5-12/month** |

---

## Teardown

```bash
cd infra && cdk destroy --all
```

Manually delete non-empty S3 buckets, ECR images, and CloudWatch log groups.

---

## Team

CS5224 Cloud Computing — National University of Singapore, AY2025/26
