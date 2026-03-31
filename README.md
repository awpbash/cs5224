# RetailMind

AI-powered analytics SaaS platform for retail SMEs. Users describe a business problem via a chatbot, upload a CSV or select a preloaded Kaggle dataset, and receive a trained model with plain-English business recommendations — no data science expertise required.

**Built for CS5224 Cloud Computing** | 12 AWS Services | Region: ap-southeast-1 (Singapore)

---

## Deployment

```bash
# Full deploy (builds layers, deploys all CDK stacks, builds + deploys frontend)
bash scripts/deploy.sh
```

```bash
# Partial redeployment
cd infra && cdk deploy --all --require-approval never          # all stacks
cd infra && cdk deploy CloudForgeApi --require-approval never  # specific stack
cd frontend && npm run build && cd ../infra && cdk deploy CloudForgeFrontend  # frontend only
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| AWS CLI | v2+ | https://aws.amazon.com/cli/ |
| AWS CDK | v2+ | `npm install -g aws-cdk` |
| Python | 3.12 | https://python.org |
| Docker | Desktop | https://docker.com |
| Node.js | 18+ | https://nodejs.org |
| pnpm (optional) | 9+ | `npm install -g pnpm` |

**AWS account requirements:**
- Credentials configured (`aws configure` with region `ap-southeast-1`)
- Bedrock model access enabled for **Claude 3 Haiku** (see [Step 1](#step-1-enable-bedrock-model-access))

---

## Architecture

Open `docs/architecture-diagram.html` in a browser for the full interactive diagram with AWS service logos.

```
User Browser (Next.js SPA)
    │
    ├── HTTPS ──► CloudFront ──► S3 (static frontend)
    ├── Auth ───► Cognito (JWT tokens)
    └── API ────► API Gateway (17 routes, Cognito authorizer)
                      │
                      ▼
                 AWS Lambda (16 functions)
                  ├── DynamoDB (3 tables)
                  ├── S3 (data bucket)
                  ├── Bedrock (Claude 3 Haiku)
                  └── Step Functions (ML pipeline)
                        │
                        ▼
                  ┌─────────────────────────────────────────┐
                  │  ProfileData → ETL → AutoSelect →       │
                  │  RunTraining (ECS Fargate) →             │
                  │  Evaluate → Deploy                      │
                  └─────────────────────────────────────────┘
```

### AWS Services (12)

| # | Service | Purpose |
|---|---------|---------|
| 1 | **Amazon Cognito** | User authentication, JWT tokens |
| 2 | **Amazon API Gateway** | REST API with 17 routes, Cognito authorizer |
| 3 | **AWS Lambda** | 16 backend functions (Python 3.12) |
| 4 | **Amazon DynamoDB** | 3 tables: projects, jobs, chats (on-demand) |
| 5 | **Amazon S3** | Data bucket + frontend bucket |
| 6 | **Amazon CloudFront** | CDN for frontend SPA |
| 7 | **AWS Step Functions** | 6-step ML training pipeline orchestration |
| 8 | **Amazon ECS (Fargate)** | Serverless container for model training |
| 9 | **Amazon ECR** | Docker image registry for training container |
| 10 | **Amazon Bedrock** | Claude 3 Haiku — chatbot, recommendations, Q&A |
| 11 | **Amazon CloudWatch** | Monitoring dashboard, logs, alarms |
| 12 | **Amazon VPC** | Network for Fargate (2 public subnets, no NAT) |

---

## Step-by-Step Deployment

### Step 1: Enable Bedrock Model Access

> **One-time manual step** — cannot be automated.

1. AWS Console → **Amazon Bedrock** → Region: **ap-southeast-1**
2. Left sidebar → **Model access**
3. Click **Manage model access**
4. Check **Anthropic → Claude 3 Haiku**
5. Click **Request model access** → wait for "Access granted" (1–5 min)

Without this, chat/interpret/results-chat Lambdas will fail with `AccessDeniedException`.

### Step 2: Build the sklearn Lambda Layer

The `recompute_profile` and `run_inference` Lambdas need scikit-learn packaged as a Lambda layer.

```bash
cd layers
bash build-layers.sh
```

This pulls the Lambda Python 3.12 Docker image, installs scikit-learn, and produces `sklearn-layer.zip` (~50 MB).

**Verify:** `ls -lh layers/sklearn-layer.zip`

**Manual alternative (no Docker):**
```bash
mkdir -p sklearn-layer/python
pip install scikit-learn -t sklearn-layer/python/ --platform manylinux2014_x86_64 --only-binary=:all:
cd sklearn-layer && zip -r ../sklearn-layer.zip python/
```

### Step 3: Install CDK Dependencies

```bash
cd infra
pip install -r requirements.txt
```

### Step 4: Bootstrap CDK (First Time Only)

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
cdk bootstrap aws://$ACCOUNT_ID/ap-southeast-1
```

### Step 5: Build the Frontend

```bash
cd frontend
npm install       # or: pnpm install
npm run build     # produces frontend/out/
```

> `.env.local` values can be empty for now — we'll update after deployment.

### Step 6: Deploy All Stacks

```bash
cd infra
cdk deploy --all --require-approval broadening
```

Deploys 7 stacks in dependency order (~10–15 min):

| Stack | Creates |
|-------|---------|
| **CloudForgeNetwork** | VPC, 2 public subnets, S3/DynamoDB gateway endpoints |
| **CloudForgeStorage** | S3 data bucket, 3 DynamoDB tables |
| **CloudForgeAuth** | Cognito User Pool + App Client |
| **CloudForgePipeline** | ECR, ECS Cluster, Fargate task def, 5 pipeline Lambdas, Step Functions |
| **CloudForgeApi** | API Gateway, 16 Lambda functions, Cognito authorizer |
| **CloudForgeFrontend** | S3 frontend bucket, CloudFront distribution |
| **CloudForgeMonitoring** | CloudWatch dashboard (5 widgets) |

### Step 7: Get Stack Outputs

```bash
# API Gateway URL
aws cloudformation describe-stacks --stack-name CloudForgeApi \
  --query 'Stacks[0].Outputs' --output table --region ap-southeast-1

# Cognito User Pool ID and Client ID
aws cloudformation describe-stacks --stack-name CloudForgeAuth \
  --query 'Stacks[0].Outputs' --output table --region ap-southeast-1

# CloudFront URL
aws cloudformation describe-stacks --stack-name CloudForgeFrontend \
  --query 'Stacks[0].Outputs' --output table --region ap-southeast-1
```

### Step 8: Update Frontend Environment & Redeploy

Create `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_URL=https://xxxxxxxxxx.execute-api.ap-southeast-1.amazonaws.com/prod
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-southeast-1_xxxxxxxxx
NEXT_PUBLIC_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_COGNITO_REGION=ap-southeast-1
```

Rebuild and redeploy:

```bash
cd frontend && npm run build
cd ../infra && cdk deploy CloudForgeFrontend
```

### Step 9: Seed Preloaded Datasets

```bash
bash scripts/seed-data.sh
```

Or manually:

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="cloudforge-data-${ACCOUNT_ID}"

aws s3 cp backend/test_data/sample_churn.csv s3://$BUCKET/preloaded/retail-churn.csv
aws s3 cp backend/test_data/sample_supermarket_sales.csv s3://$BUCKET/preloaded/supermarket-sales.csv
aws s3 cp backend/test_data/sample_mall_customers.csv s3://$BUCKET/preloaded/customer-segmentation.csv
aws s3 cp backend/test_data/sample_store_demand.csv s3://$BUCKET/preloaded/store-demand.csv
```

Download sample CSVs from Kaggle:
- [Telco Customer Churn](https://www.kaggle.com/datasets/blastchar/telco-customer-churn)
- [Supermarket Sales](https://www.kaggle.com/datasets/aungpyaeap/supermarket-sales)
- [Mall Customers](https://www.kaggle.com/datasets/vjchoudhary7/customer-segmentation-tutorial-in-python)
- [Store Item Demand](https://www.kaggle.com/competitions/demand-forecasting-kernels-only)

---

## Post-Deployment Verification

### Smoke Test

1. Open the CloudFront URL in your browser
2. Sign up for a new account (Cognito sends verification email)
3. Create a project with a name and use case
4. Upload a CSV or select a preloaded dataset
5. Chat with the AI to define your business problem
6. Click "Train Model" — watch Step Functions in the console
7. View results and AI recommendations (~2–5 min)
8. Enter feature values and get a prediction

### Console Checks

| What | Where |
|------|-------|
| API health | API Gateway → cloudforge-api → Dashboard |
| Users | Cognito → cloudforge-users → Users |
| Projects | DynamoDB → cloudforge-projects → Items |
| Pipeline runs | Step Functions → cloudforge-pipeline → Executions |
| Container logs | CloudWatch → `/ecs/automl` |
| Lambda errors | CloudWatch → `/aws/lambda/cloudforge-*` |
| Dashboard | CloudWatch → Dashboards → cloudforge-dashboard |

### Test with curl

```bash
API=https://xxxxxxxxxx.execute-api.ap-southeast-1.amazonaws.com/prod
TOKEN=<your-cognito-id-token>

# List projects
curl -H "Authorization: Bearer $TOKEN" $API/projects

# Create project
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"projectName":"Test","taskType":"classification","useCase":"churn_prediction"}' \
  $API/projects

# List preloaded datasets
curl -H "Authorization: Bearer $TOKEN" $API/preloaded-datasets
```

---

## Cost Estimate

| Service | Monthly Cost | Notes |
|---------|-------------|-------|
| VPC | $0 | No NAT gateway |
| DynamoDB | $0 | Free tier |
| S3 | ~$0.50 | Few GB of CSVs + models |
| Lambda | $0 | Free tier |
| API Gateway | $0 | Free tier |
| Cognito | $0 | Free tier (50K MAU) |
| CloudFront | $0 | Free tier |
| Step Functions | $0 | Free tier |
| **ECS Fargate** | **~$2–5** | ~$0.05/job (1 vCPU, 2 GB, ~5 min) |
| ECR | ~$0.10 | One image, ~500 MB |
| **Bedrock** | **~$1–3** | Claude 3 Haiku per-token pricing |
| CloudWatch | $0 | Free tier |

**Total: ~$5–12/month** for demo/dev usage.

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `AccessDeniedException` on chat/interpret | Bedrock model not enabled | AWS Console → Bedrock → Model access → Enable Claude 3 Haiku |
| Step Functions fails at RunTraining | Fargate can't reach ECR/S3 | Check public subnet + `assign_public_ip=True`. Check `/ecs/automl` logs |
| `No module named 'shared'` | Shared layer build failed | Ensure Docker is running during `cdk deploy` |
| `No module named 'sklearn'` | sklearn layer missing | Run `cd layers && bash build-layers.sh` and redeploy |
| CloudFront "Access Denied" | Frontend not built | `cd frontend && npm run build`, then redeploy CloudForgeFrontend |
| CORS errors | Lambda exception before headers | Check Lambda logs — unhandled exceptions skip CORS headers |
| "User pool does not exist" | Wrong Cognito Pool ID | Update `NEXT_PUBLIC_COGNITO_USER_POOL_ID` in `.env.local` |
| Training >30 min | Large dataset + auto mode | Use single mode or reduce dataset size |

---

## Local Development

```bash
# Frontend
cd frontend && npm install && npm run dev    # http://localhost:3000

# Backend tests
cd backend && pip install -r requirements.txt
python -m pytest tests/backend/

# Container (local training test)
cd containers/tabular-automl
docker build -t cloudforge-training:tabular-automl .
docker run -e DATA_S3_PATH=... -e OUTPUT_S3_PATH=... \
  -e TASK_TYPE=classification -e MODE=auto \
  cloudforge-training:tabular-automl

# CDK
cd infra && pip install -r requirements.txt
cdk synth    # preview CloudFormation
cdk diff     # see what would change
cdk deploy   # deploy to AWS
```

---

## Teardown

To remove all AWS resources and stop incurring costs:

```bash
cd infra
cdk destroy --all
```

Then manually delete:
- S3 buckets (CDK won't delete non-empty buckets)
- ECR images
- CloudWatch log groups

---

## Project Structure

```
retailmind/
├── frontend/              # Next.js + TypeScript SPA
├── backend/
│   ├── lambdas/api/       # 16 API Gateway Lambda handlers
│   ├── lambdas/pipeline/  # 5 Step Functions task Lambdas
│   └── shared/            # Shared utilities (Lambda layer)
├── containers/
│   └── tabular-automl/    # AutoML training container (20 models)
├── infra/                 # AWS CDK (7 stacks)
├── scripts/               # Deploy, seed, build helpers
├── layers/                # Lambda layers (sklearn)
├── tests/                 # pytest + integration tests
└── docs/                  # Architecture docs + diagrams
```

---

## License

CS5224 Cloud Computing — National University of Singapore
