# RetailMind - Deployment Guide

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [AWS Services Used (12 Services)](#aws-services-used-12-services)
3. [What Happens When You Use the App](#what-happens-when-you-use-the-app)
4. [CDK Stacks](#cdk-stacks)
5. [Prerequisites](#prerequisites)
6. [Step-by-Step Deployment](#step-by-step-deployment)
7. [Post-Deployment Verification](#post-deployment-verification)
8. [Frontend Environment Variables](#frontend-environment-variables)
9. [Cost Breakdown](#cost-breakdown)
10. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  BROWSER                                                         │
│  Next.js SPA (static HTML/JS/CSS)                                │
│  - Cognito JS SDK handles sign-up/login                          │
│  - fetch() calls API Gateway with JWT in Authorization header    │
└──────────────────────┬───────────────────────────────────────────┘
                       │ HTTPS
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  CLOUDFRONT (cloudforge-cdn)                                     │
│  - Serves static frontend from S3                                │
│  - HTTPS termination, caching, SPA routing (404 → index.html)   │
└──────────────────────┬───────────────────────────────────────────┘
                       │           │
          ┌────────────┘           └──────────────┐
          ▼ (static files)                        ▼ (API calls)
┌─────────────────────┐              ┌────────────────────────────┐
│  S3 (frontend)      │              │  API GATEWAY               │
│  cloudforge-frontend│              │  cloudforge-api             │
│  - index.html       │              │  - Cognito authorizer       │
│  - _next/           │              │  - 16 routes → 16 Lambdas  │
│  - assets/          │              │  - CORS enabled             │
└─────────────────────┘              └──────────────┬─────────────┘
                                                    │
                                     ┌──────────────┼──────────────┐
                                     ▼              ▼              ▼
                              ┌────────────┐ ┌───────────┐ ┌────────────┐
                              │  DYNAMODB   │ │  S3 DATA  │ │  BEDROCK   │
                              │  3 tables   │ │  bucket   │ │  Claude    │
                              │  projects   │ │  CSVs     │ │  Haiku     │
                              │  jobs       │ │  models   │ │  (chat,    │
                              │  chats      │ │  profiles │ │  interpret)│
                              └────────────┘ └───────────┘ └────────────┘
                                                    │
                     ┌──────────────────────────────┘
                     ▼ (trigger_pipeline Lambda starts)
┌──────────────────────────────────────────────────────────────────┐
│  STEP FUNCTIONS (cloudforge-pipeline)                             │
│                                                                   │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐      │
│  │ ProfileData │───►│ EtlPreprocess│───►│ AutoSelectModel │      │
│  │ (Lambda)    │    │ (Lambda)     │    │ (Lambda)        │      │
│  └─────────────┘    └──────────────┘    └────────┬────────┘      │
│                                                   │               │
│                                                   ▼               │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────┐      │
│  │ DeployModel  │◄──│ EvaluateModel│◄──│ RunTraining     │      │
│  │ (Lambda)     │   │ (Lambda)     │   │ (ECS Fargate)   │      │
│  └──────────────┘   └──────────────┘   └─────────────────┘      │
│                                          │                        │
│                                          ▼                        │
│                                   ┌──────────────────┐           │
│                                   │ ECR Image:       │           │
│                                   │ tabular-automl   │           │
│                                   │ (scikit-learn,   │           │
│                                   │  xgboost,        │           │
│                                   │  lightgbm)       │           │
│                                   └──────────────────┘           │
└──────────────────────────────────────────────────────────────────┘
                     │
                     ▼ (all results written to)
              ┌────────────┐    ┌────────────┐
              │  DYNAMODB   │    │  S3 DATA   │
              │  jobs table │    │  models/   │
              │  status=    │    │  metrics/  │
              │  COMPLETED  │    │  model.pkl │
              └────────────┘    └────────────┘
                     │
                     ▼ (frontend polls until COMPLETED)
              ┌──────────────────┐
              │  CLOUDWATCH      │
              │  Dashboard:      │
              │  - API requests  │
              │  - API errors    │
              │  - API latency   │
              │  - Pipeline runs │
              │  - Pipeline time │
              └──────────────────┘
```

---

## AWS Services Used (12 Services)

| # | Service | Resource Name | What It Does |
|---|---------|---------------|--------------|
| 1 | **Amazon Cognito** | `cloudforge-users` | User sign-up, login, JWT token issuance. The frontend uses Cognito JS SDK to authenticate. Every API call includes the JWT in the `Authorization` header. |
| 2 | **Amazon API Gateway** | `cloudforge-api` | REST API with 16 routes. Validates JWT via Cognito authorizer before forwarding to Lambda. Handles CORS. |
| 3 | **AWS Lambda** | `cloudforge-*` (16 functions) | All backend logic. Each handler is a single Python file. No frameworks - plain `handler(event, context)` functions. |
| 4 | **Amazon DynamoDB** | `cloudforge-projects`, `cloudforge-jobs`, `cloudforge-chats` | Three tables storing project metadata, training job state, and chat sessions. On-demand billing (pay per request). |
| 5 | **Amazon S3** | `cloudforge-data-{account_id}`, `cloudforge-frontend-{account_id}` | Data bucket stores CSVs, processed data, trained models, metrics. Frontend bucket stores the Next.js static export. |
| 6 | **Amazon CloudFront** | `cloudforge-cdn` | CDN in front of the frontend S3 bucket. HTTPS, caching, SPA routing (rewrites 404/403 → index.html). |
| 7 | **AWS Step Functions** | `cloudforge-pipeline` | Orchestrates the 6-step ML training pipeline. Each step is a Lambda or ECS task. Handles errors, timeouts, state passing between steps. |
| 8 | **Amazon ECS (Fargate)** | `cloudforge-cluster` | Runs the training container. Fargate = serverless containers - no EC2 instances to manage. Pulls image from ECR, runs in public subnet with public IP. |
| 9 | **Amazon ECR** | Auto-created by CDK | Docker image registry. CDK builds the `tabular-automl` Dockerfile and pushes it to ECR during `cdk deploy`. |
| 10 | **Amazon Bedrock** | Claude 3 Haiku model | Powers the chatbot (problem refinement), result interpretation (business recommendations), and results Q&A. Called via `bedrock-runtime` boto3 client. |
| 11 | **Amazon CloudWatch** | `cloudforge-dashboard` | Monitoring dashboard with 5 widgets: API request count, API errors (4xx/5xx), API latency, pipeline execution count (started/succeeded/failed), pipeline duration. |
| 12 | **Amazon VPC** | `cloudforge-vpc` | Network for ECS Fargate tasks. 2 public subnets, no NAT gateway (saves $33/month). Fargate tasks get public IPs. Free VPC endpoints for S3 and DynamoDB. |

---

## What Happens When You Use the App

### 1. User Opens the App

```
Browser → HTTPS → CloudFront → S3 (frontend bucket)
```

- **CloudFront** receives the request, checks its cache
- If not cached, fetches from **S3** (`cloudforge-frontend-{account_id}`)
- Returns `index.html` (Next.js static export)
- For any path like `/dashboard` or `/projects/abc`, CloudFront's error response rules rewrite 404→`index.html`, so the SPA handles routing client-side

**Services called:** CloudFront, S3

---

### 2. User Signs Up / Logs In

```
Browser → Cognito JS SDK → Cognito User Pool
```

- Frontend uses AWS Amplify JS SDK (or direct Cognito API) to call **Cognito**
- **Sign up:** Cognito creates user, sends verification email
- **Login:** Cognito validates password, returns 3 tokens:
  - `id_token` (JWT with user claims - this is what we send to API Gateway)
  - `access_token`
  - `refresh_token`
- Frontend stores `id_token` in `localStorage`
- The JWT contains `sub` (unique user ID) which becomes the partition key for all user data

**Services called:** Cognito

---

### 3. User Creates a Project

```
Browser → API Gateway → Cognito Authorizer → Lambda (create_project) → DynamoDB
```

1. Frontend calls `POST /projects` with `{ projectName, useCase, taskType }`
2. **API Gateway** receives the request
3. **Cognito Authorizer** validates the JWT, extracts `claims.sub` (user ID)
4. **Lambda** (`create_project.py`) runs:
   - Generates a UUID for `projectId`
   - Writes to **DynamoDB** `cloudforge-projects` table: `{ userId, projectId, projectName, taskType, useCase, status: "created", createdAt }`
5. Returns `{ projectId, status: "created" }` to frontend

**Services called:** API Gateway, Cognito, Lambda, DynamoDB

---

### 4. User Uploads a CSV (or Selects Preloaded Dataset)

#### Path A: Upload their own CSV

```
Browser → API Gateway → Lambda (get_upload_url) → S3 (presigned URL)
Browser → S3 (direct PUT upload via presigned URL)
```

1. Frontend calls `POST /projects/{id}/upload-url` with `{ filename: "data.csv" }`
2. **Lambda** (`get_upload_url.py`):
   - Generates a **presigned S3 PUT URL** for path `{userId}/{projectId}/raw/data.csv`
   - Updates **DynamoDB** project: `status: "uploading"`, `datasetS3Path: "{userId}/{projectId}/raw/data.csv"`
   - Returns the presigned URL
3. Frontend uploads the CSV directly to **S3** via the presigned URL (no data goes through Lambda)

**Services called:** API Gateway, Cognito, Lambda, DynamoDB, S3

#### Path B: Select a preloaded Kaggle dataset

```
Browser → API Gateway → Lambda (select_preloaded) → S3 (copy object) → DynamoDB
```

1. Frontend calls `POST /projects/{id}/select-preloaded` with `{ datasetId: "retail-churn" }`
2. **Lambda** (`select_preloaded.py`):
   - Copies from `s3://bucket/preloaded/retail-churn.csv` to `s3://bucket/{userId}/{projectId}/raw/retail-churn.csv`
   - Updates **DynamoDB** project: `status: "DATA_UPLOADED"`, `datasetS3Path`, `preloadedDataset`

**Services called:** API Gateway, Cognito, Lambda, S3, DynamoDB

---

### 5. User Chats with the AI to Define Their Problem

```
Browser → API Gateway → Lambda (chat) → Bedrock (Claude Haiku) → DynamoDB
```

1. Frontend calls `POST /chat` with `{ message, sessionId, projectId }`
2. **Lambda** (`chat.py`):
   - Reads the project's `dataProfile` from **DynamoDB** to give the AI context about the uploaded data
   - Builds a system prompt with data column info, stats, and the ML advisor persona
   - Calls **Bedrock** `InvokeModel` API with model `anthropic.claude-3-haiku-20240307-v1:0`
   - Claude Haiku analyzes the data and business problem, returns a suggested ML config:
     ```json
     { "useCase": "churn_prediction", "taskType": "classification",
       "suggestedTarget": "Churn", "suggestedFeatures": ["tenure", "MonthlyCharges", ...] }
     ```
   - Lambda parses this JSON from the response and returns it alongside the chat reply
3. Frontend displays the chat message and the extracted config card

**Services called:** API Gateway, Cognito, Lambda, DynamoDB, Bedrock

---

### 6. User Reviews Data Profile and Selects Features

```
Browser → API Gateway → Lambda (recompute_profile) → S3 → Lambda (pandas + sklearn)
```

1. Frontend calls `POST /projects/{id}/recompute-profile` with `{ targetColumn, selectedFeatures }`
2. **Lambda** (`recompute_profile.py`):
   - Downloads CSV from **S3**
   - Computes correlation matrix, PCA analysis, class balance / target distribution using **pandas** and **scikit-learn** (via Lambda layers)
   - Returns the analytics data (no DynamoDB write - this is an on-demand computation)

**Services called:** API Gateway, Cognito, Lambda, S3

---

### 7. User Clicks "Train Model"

This is the most complex flow - it touches 7 services.

```
Browser → API Gateway → Lambda (trigger_pipeline) → Step Functions → 4 Lambdas + 1 ECS Fargate task
```

1. Frontend calls `POST /projects/{id}/train`
2. **Lambda** (`trigger_pipeline.py`):
   - Creates a new job ID (UUID)
   - Writes job to **DynamoDB** `cloudforge-jobs`: `{ projectId, jobId, status: "STARTING" }`
   - Updates project status to `"training"` in **DynamoDB**
   - Starts a **Step Functions** execution with input:
     ```json
     { "userId", "projectId", "jobId", "taskType", "datasetS3Path",
       "targetColumn", "selectedFeatures", "hyperparameters", "trainSplit" }
     ```
3. Returns `{ jobId, status: "STARTING" }` immediately (training runs asynchronously)

**Services called (trigger):** API Gateway, Cognito, Lambda, DynamoDB, Step Functions

#### Step Functions Pipeline (runs asynchronously)

**Step 7a: ProfileData (Lambda)**
```
Step Functions → Lambda → S3 (read CSV) → pandas/sklearn → S3 (write profile.json) → DynamoDB (update project)
```
- Downloads raw CSV from **S3**
- Computes column stats, histograms, correlation, PCA, class balance using **pandas** and **scikit-learn**
- Writes `profile.json` to **S3** at `{userId}/{projectId}/profile.json`
- Updates project's `dataProfile` in **DynamoDB**
- Passes data forward: `{ ...event, dataProfile, profileS3Path }`

**Services called:** Lambda, S3, DynamoDB

**Step 7b: EtlPreprocess (Lambda)**
```
Step Functions → Lambda → S3 (read CSV) → sklearn (impute/encode/scale/split) → S3 (write 4 CSVs + metadata)
```
- Downloads raw CSV from **S3**
- Imputes missing values (median for numeric, mode for categorical)
- Label-encodes categorical features
- Scales features with `StandardScaler`
- Splits into train/validation sets
- Uploads to **S3**:
  - `{userId}/{projectId}/processed/X_train.csv`
  - `{userId}/{projectId}/processed/X_val.csv`
  - `{userId}/{projectId}/processed/y_train.csv`
  - `{userId}/{projectId}/processed/y_val.csv`
  - `{userId}/{projectId}/processed/metadata.json`
- Passes forward: `{ ...event, processedS3Path, featureColumns, targetColumn, isRegression }`

**Services called:** Lambda, S3

**Step 7c: AutoSelectModel (Lambda)**
```
Step Functions → Lambda (pure logic, no AWS calls)
```
- Pure logic - no AWS service calls
- If user selected specific models → maps them to train.py names
- If auto mode → picks model based on row count and feature count:
  - Large dataset (>5000 rows or >15 features) → XGBoost
  - Small dataset → Random Forest
- Passes forward: `{ ...event, modelType, containerName, hyperparameters }`

**Services called:** Lambda only

**Step 7d: RunTraining (ECS Fargate)**
```
Step Functions → ECS RunTask API → Fargate pulls image from ECR → Container reads S3 → trains → writes S3
```
- **Step Functions** calls the ECS `RunTask` API
- **ECS Fargate** spins up a container from the **ECR** image `tabular-automl`
- Container environment variables (injected by Step Functions via `ContainerOverride`):
  - `DATA_S3_PATH` = `s3://bucket/{userId}/{projectId}/processed/`
  - `OUTPUT_S3_PATH` = `s3://bucket/{userId}/{projectId}/{jobId}/`
  - `TASK_TYPE` = `classification` or `regression`
  - `MODE` = `auto` or `single`
  - `MODEL_TYPE` = e.g., `xgboost_clf`
  - `HYPERPARAMS` = JSON string
- Container (`train.py`) runs:
  1. Downloads `X_train.csv`, `y_train.csv`, `X_val.csv`, `y_val.csv` from **S3**
  2. In auto mode: tries multiple models with cross-validation + RandomizedSearchCV
  3. In single mode: trains the specified model
  4. Uploads to **S3**:
     - `{userId}/{projectId}/{jobId}/model.pkl` (trained model)
     - `{userId}/{projectId}/{jobId}/metrics.json` (accuracy, F1, feature importance, etc.)
     - `{userId}/{projectId}/{jobId}/leaderboard.json` (auto mode: all candidate scores)
     - `{userId}/{projectId}/{jobId}/config.json` (what was trained)
- Container exits with code 0 → Step Functions detects completion

**Services called:** Step Functions, ECS Fargate, ECR, S3, VPC (public subnet, internet access)

**Step 7e: EvaluateModel (Lambda)**
```
Step Functions → Lambda → S3 (read metrics.json) → DynamoDB (update job)
```
- Reads `metrics.json` from **S3**
- Updates job in **DynamoDB**: `status: "EVALUATING"`, `metrics`, `featureImportance`, `modelArtifactS3Path`, `modelType`

**Services called:** Lambda, S3, DynamoDB

**Step 7f: DeployModel (Lambda)**
```
Step Functions → Lambda → DynamoDB (update job + project)
```
- Updates job in **DynamoDB**: `status: "COMPLETED"`, `completedAt`
- Updates project in **DynamoDB**: `status: "COMPLETED"`, `latestJobId`

**Services called:** Lambda, DynamoDB

---

### 8. Frontend Polls for Results

```
Browser → API Gateway → Lambda (get_job_status) → DynamoDB
```

- Frontend calls `GET /projects/{id}/jobs/{jobId}` every 3 seconds
- **Lambda** reads job from **DynamoDB** and returns `{ status, metrics, featureImportance, ... }`
- When `status === "COMPLETED"`, frontend stops polling and shows results

**Services called:** API Gateway, Cognito, Lambda, DynamoDB

---

### 9. User Views Business Insights (AI Interpretation)

```
Browser → API Gateway → Lambda (interpret_results) → DynamoDB → Bedrock (Claude Haiku)
```

1. Frontend calls `POST /projects/{id}/jobs/{jobId}/interpret`
2. **Lambda** (`interpret_results.py`):
   - Reads job metrics and feature importance from **DynamoDB**
   - Sends to **Bedrock** Claude Haiku with a prompt asking for business-language summary
   - Claude returns structured JSON:
     ```json
     {
       "businessSummary": "Your model predicts customer churn with 87% accuracy...",
       "recommendations": [
         { "title": "Focus on high-tenure customers", "description": "..." }
       ],
       "insights": [
         { "feature": "MonthlyCharges", "explanation": "Higher monthly charges strongly predict churn..." }
       ]
     }
     ```

**Services called:** API Gateway, Cognito, Lambda, DynamoDB, Bedrock

---

### 10. User Asks Follow-up Questions About Results

```
Browser → API Gateway → Lambda (results_chat) → DynamoDB → Bedrock (Claude Haiku)
```

1. Frontend calls `POST /projects/{id}/results-chat` with `{ message, history }`
2. **Lambda** (`results_chat.py`):
   - Loads project + job context from **DynamoDB**
   - Sends conversation history + new message to **Bedrock** Claude Haiku
   - Returns the AI's reply

**Services called:** API Gateway, Cognito, Lambda, DynamoDB, Bedrock

---

### 11. User Runs Inference (Prediction)

```
Browser → API Gateway → Lambda (run_inference) → DynamoDB → S3 → sklearn (predict)
```

1. Frontend calls `POST /projects/{id}/jobs/{jobId}/infer` with `{ features: { col1: val1, ... } }`
2. **Lambda** (`run_inference.py`):
   - Reads job from **DynamoDB** to get `modelArtifactS3Path`
   - Downloads `model.pkl` from **S3**
   - Unpickles the model, creates a pandas DataFrame from input features
   - Calls `model.predict()` and `model.predict_proba()` (if available)
   - Returns `{ prediction, confidence, probabilities }`

**Services called:** API Gateway, Cognito, Lambda, DynamoDB, S3

---

### 12. User Downloads the Trained Model

```
Browser → API Gateway → Lambda (get_model_download) → S3 (presigned URL)
Browser → S3 (direct download via presigned URL)
```

1. Frontend calls `GET /projects/{id}/jobs/{jobId}/download`
2. **Lambda** generates a presigned **S3** GET URL for `model.pkl`
3. Browser downloads directly from **S3**

**Services called:** API Gateway, Cognito, Lambda, S3

---

## CDK Stacks

Deployed in dependency order. Each stack is a separate CloudFormation stack.

| Stack | File | Creates | Depends On |
|-------|------|---------|------------|
| **CloudForgeNetwork** | `network_stack.py` | VPC (2 public subnets, no NAT), S3 + DynamoDB gateway endpoints | - |
| **CloudForgeStorage** | `storage_stack.py` | S3 data bucket (CORS enabled), 3 DynamoDB tables (projects, jobs, chats) | - |
| **CloudForgeAuth** | `auth_stack.py` | Cognito User Pool (`cloudforge-users`), App Client (no secret, SRP + password auth) | - |
| **CloudForgePipeline** | `pipeline_stack.py` | ECR (auto), ECS Cluster + Fargate task def, 5 pipeline Lambdas, Step Functions state machine, sklearn layer | Network, Storage |
| **CloudForgeApi** | `api_stack.py` | API Gateway (16 routes), 16 Lambda functions, Cognito authorizer, Bedrock IAM, sklearn layer, pandas layer | Storage, Auth, Pipeline |
| **CloudForgeFrontend** | `frontend_stack.py` | S3 frontend bucket, CloudFront distribution, OAI, BucketDeployment from `frontend/out/` | - |
| **CloudForgeMonitoring** | `monitoring_stack.py` | CloudWatch dashboard (5 widgets: API requests, errors, latency, pipeline executions, pipeline duration) | Api, Pipeline |

---

## Prerequisites

Before deploying, you need:

1. **AWS CLI** installed and configured:
   ```bash
   aws configure
   # Region: ap-southeast-1
   # Output: json
   ```

2. **AWS CDK** installed globally:
   ```bash
   npm install -g aws-cdk
   ```

3. **Python 3.12** with pip

4. **Docker** running (for building the sklearn Lambda layer and the training container image)

5. **Node.js 18+** and npm/pnpm (for building the frontend)

6. **Bedrock model access** enabled (see Step 1 below)

---

## Step-by-Step Deployment

### Step 1: Enable Bedrock Model Access

This is a one-time manual step in the AWS Console.

1. Go to **AWS Console** → search for **Amazon Bedrock**
2. Make sure you're in region **ap-southeast-1** (Singapore)
3. Click **Model access** in the left sidebar
4. Click **Manage model access**
5. Check the box for **Anthropic → Claude 3 Haiku**
6. Click **Request model access**
7. Wait for status to change to **Access granted** (usually takes 1-5 minutes)

Without this, the chat, interpret, and results-chat Lambdas will fail with `AccessDeniedException`.

---

### Step 2: Build the sklearn Lambda Layer

The `recompute_profile` and `run_inference` Lambdas need scikit-learn, which doesn't come in the standard Lambda runtime. We build it as a zip layer using Docker.

```bash
cd layers
bash build-layers.sh
```

This will:
1. Pull the `public.ecr.aws/lambda/python:3.12` Docker image
2. `pip install scikit-learn` inside the container
3. Package it into `sklearn-layer.zip` (~50 MB)

Verify it worked:
```bash
ls -lh layers/sklearn-layer.zip
# Should show ~50MB file
```

If Docker is not available, you can build it manually:
```bash
mkdir -p sklearn-layer/python
pip install scikit-learn -t sklearn-layer/python/ --platform manylinux2014_x86_64 --only-binary=:all:
cd sklearn-layer && zip -r ../sklearn-layer.zip python/
```

---

### Step 3: Install CDK Python Dependencies

```bash
cd infra
pip install -r requirements.txt
```

This installs `aws-cdk-lib` and `constructs`.

---

### Step 4: Bootstrap CDK (First Time Only)

CDK bootstrap creates an S3 bucket and IAM roles in your account that CDK uses for deployments.

```bash
cdk bootstrap aws://YOUR_ACCOUNT_ID/ap-southeast-1
```

Replace `YOUR_ACCOUNT_ID` with your 12-digit AWS account ID. Find it with:
```bash
aws sts get-caller-identity --query Account --output text
```

---

### Step 5: Build the Frontend

The `CloudForgeFrontend` stack deploys from `frontend/out/`, so we need to build it first.

```bash
cd frontend
npm install       # or: pnpm install
npm run build     # produces frontend/out/
```

Note: At this point, `NEXT_PUBLIC_API_URL` in `.env.local` might be empty. That's OK - we'll update it after deployment and redeploy the frontend.

---

### Step 6: Deploy All Stacks

From the `infra/` directory:

```bash
cd infra
cdk deploy --all --require-approval broadening
```

CDK will prompt you to approve IAM changes. Type `y` to confirm.

This deploys all 7 stacks in dependency order. It takes approximately **10-15 minutes** because:
- Docker builds the training container and pushes to ECR (~3 min)
- CloudFront distribution creation (~5 min)
- Lambda function creation (~2 min)
- Everything else (~2 min)

**What happens during deploy:**
1. CDK synthesizes CloudFormation templates from your Python code
2. Docker builds `containers/tabular-automl/Dockerfile` → pushes image to ECR
3. Docker builds the shared Lambda layer (pydantic + shared/) → uploads to S3
4. CloudFormation creates all resources in dependency order
5. `BucketDeployment` uploads `frontend/out/` to S3 and invalidates CloudFront cache

---

### Step 7: Get Stack Outputs

After deployment, retrieve the important values:

```bash
# API Gateway URL
aws cloudformation describe-stacks --stack-name CloudForgeApi \
  --query 'Stacks[0].Outputs' --output table

# Cognito User Pool ID and Client ID
aws cloudformation describe-stacks --stack-name CloudForgeAuth \
  --query 'Stacks[0].Outputs' --output table

# CloudFront URL (your app's public URL)
aws cloudformation describe-stacks --stack-name CloudForgeFrontend \
  --query 'Stacks[0].Outputs' --output table

# S3 Data Bucket name
aws cloudformation describe-stacks --stack-name CloudForgeStorage \
  --query 'Stacks[0].Outputs' --output table
```

If outputs aren't exported, you can find them in the AWS Console:
- **API URL:** API Gateway → cloudforge-api → Stages → prod → Invoke URL
- **User Pool ID:** Cognito → cloudforge-users → Pool ID
- **Client ID:** Cognito → cloudforge-users → App clients → cloudforge-web-client → Client ID
- **CloudFront URL:** CloudFront → find distribution → Domain name

---

### Step 8: Update Frontend Environment and Redeploy

Create/update `frontend/.env.local` with the real values:

```bash
NEXT_PUBLIC_API_URL=https://xxxxxxxxxx.execute-api.ap-southeast-1.amazonaws.com/prod
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-southeast-1_xxxxxxxxx
NEXT_PUBLIC_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_COGNITO_REGION=ap-southeast-1
```

Then rebuild and redeploy the frontend:

```bash
cd frontend
npm run build

cd ../infra
cdk deploy CloudForgeFrontend
```

This uploads the new build to S3 and invalidates the CloudFront cache.

---

### Step 9: Seed Preloaded Datasets

The `list_preloaded` Lambda returns metadata for 4 datasets, but the actual CSV files need to exist in S3 at `preloaded/{dataset-id}.csv`.

```bash
# Get bucket name
BUCKET=$(aws cloudformation describe-stacks --stack-name CloudForgeStorage \
  --query 'Stacks[0].Outputs[?contains(OutputKey,`DataBucket`)].OutputValue' --output text)

# If the above doesn't work, find it manually:
# BUCKET=cloudforge-data-YOUR_ACCOUNT_ID

# Upload preloaded datasets
aws s3 cp backend/test_data/sample_churn.csv s3://$BUCKET/preloaded/retail-churn.csv
aws s3 cp backend/test_data/sample_supermarket_sales.csv s3://$BUCKET/preloaded/supermarket-sales.csv
aws s3 cp backend/test_data/sample_mall_customers.csv s3://$BUCKET/preloaded/customer-segmentation.csv
aws s3 cp backend/test_data/sample_store_demand.csv s3://$BUCKET/preloaded/store-demand.csv
```

If you don't have these sample CSVs yet, download them from Kaggle:
- [Telco Customer Churn](https://www.kaggle.com/datasets/blastchar/telco-customer-churn) → `retail-churn.csv`
- [Supermarket Sales](https://www.kaggle.com/datasets/aungpyaeap/supermarket-sales) → `supermarket-sales.csv`
- [Mall Customers](https://www.kaggle.com/datasets/vjchoudhary7/customer-segmentation-tutorial-in-python) → `customer-segmentation.csv`
- [Store Item Demand](https://www.kaggle.com/competitions/demand-forecasting-kernels-only) → `store-demand.csv`

---

## Post-Deployment Verification

### Quick Smoke Test

1. **Open the app:** Go to the CloudFront URL in your browser
2. **Sign up:** Create a new account (Cognito sends verification email)
3. **Create project:** Click "New Project", fill in name and use case
4. **Upload data:** Upload a CSV or select a preloaded dataset
5. **Chat:** Describe your business problem - the AI should respond with a suggested config
6. **Train:** Click "Train Model" - check the Step Functions console to watch the execution
7. **Results:** After training completes (~2-5 minutes), view metrics and AI recommendations
8. **Infer:** Enter feature values and get a prediction

### Check Services in AWS Console

| What to Check | Where |
|---------------|-------|
| API is working | API Gateway → cloudforge-api → Dashboard |
| Users are created | Cognito → cloudforge-users → Users |
| Projects are stored | DynamoDB → cloudforge-projects → Items |
| Training is running | Step Functions → cloudforge-pipeline → Executions |
| Container logs | CloudWatch → Log groups → `/ecs/automl` |
| Lambda errors | CloudWatch → Log groups → `/aws/lambda/cloudforge-*` |
| Overall dashboard | CloudWatch → Dashboards → cloudforge-dashboard |

### Common Test Commands (curl)

```bash
# Set your API URL and token
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

# Chat
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"I want to predict customer churn","projectId":"<project-id>"}' \
  $API/chat
```

---

## Frontend Environment Variables

| Variable | Where to Find | Example |
|----------|---------------|---------|
| `NEXT_PUBLIC_API_URL` | CloudForgeApi stack output, or API Gateway console → Stages → prod | `https://abc123.execute-api.ap-southeast-1.amazonaws.com/prod` |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | CloudForgeAuth stack output, or Cognito console → Pool ID | `ap-southeast-1_AbC12345` |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | Cognito console → App clients → Client ID | `1a2b3c4d5e6f7g8h9i0j` |
| `NEXT_PUBLIC_COGNITO_REGION` | Always `ap-southeast-1` | `ap-southeast-1` |

---

## Cost Breakdown

### Monthly cost at low usage (demo/dev)

| Service | Cost | Notes |
|---------|------|-------|
| **VPC** | $0 | No NAT gateway, public subnets only |
| **DynamoDB** | $0 | On-demand, free tier covers ~25 read/write units |
| **S3** | ~$0.50 | A few GB of CSVs and models |
| **Lambda** | $0 | Free tier: 1M requests + 400K GB-seconds/month |
| **API Gateway** | $0 | Free tier: 1M API calls/month |
| **Cognito** | $0 | Free tier: 50K MAU |
| **CloudFront** | $0 | Free tier: 1TB transfer + 10M requests |
| **Step Functions** | $0 | Free tier: 4000 state transitions/month |
| **ECS Fargate** | ~$2-5 | Per training job: ~$0.05 (1 vCPU, 2GB, ~5 min) |
| **ECR** | ~$0.10 | One image, ~500MB |
| **Bedrock** | ~$1-3 | Claude 3 Haiku: $0.00025/1K input tokens, $0.00125/1K output tokens |
| **CloudWatch** | $0 | Free tier covers basic metrics + 5GB logs |

**Total: ~$5-12/month** for development/demo usage.

### What costs money

- **Fargate** is the main variable cost - each training job runs a container for 2-10 minutes
- **Bedrock** charges per token - each chat message or interpretation costs fractions of a cent
- **S3** storage grows with datasets and models

### Cost killers to avoid

- ~~NAT Gateway: $33/month~~ (removed - using public subnets instead)
- ~~SageMaker: ml.g4dn.xlarge is $0.73/hr~~ (removed - using Fargate instead)
- Don't leave large datasets in S3 indefinitely

---

## Troubleshooting

### "AccessDeniedException" on chat/interpret

**Cause:** Bedrock model access not enabled.
**Fix:** AWS Console → Bedrock → Model access → Enable Claude 3 Haiku (see Step 1).

### Step Functions execution fails at RunTraining

**Cause:** Fargate task can't pull from ECR or can't reach S3.
**Fix:** Check that Fargate is in a public subnet with `assign_public_ip=True`. Check CloudWatch logs at `/ecs/automl`.

### Lambda "No module named 'shared'"

**Cause:** The shared layer wasn't bundled correctly.
**Fix:** The CDK `BundlingOptions` builds the layer via Docker. Make sure Docker is running during `cdk deploy`. Check that `backend/shared/__init__.py` exists.

### Lambda "No module named 'sklearn'"

**Cause:** The sklearn layer zip is missing or wasn't built.
**Fix:** Run `cd layers && bash build-layers.sh` and redeploy.

### CloudFront returns "Access Denied"

**Cause:** Frontend hasn't been built, or `frontend/out/` is empty.
**Fix:** Run `cd frontend && npm run build`, then `cd ../infra && cdk deploy CloudForgeFrontend`.

### CORS errors in browser console

**Cause:** API Gateway CORS not matching, or Lambda response missing CORS headers.
**Fix:** All Lambda handlers include `Access-Control-Allow-Origin: *` in response headers. API Gateway has `default_cors_preflight_options` configured. If you see CORS errors, check that the Lambda is returning correctly (not throwing an unhandled exception before headers are set).

### "User pool does not exist"

**Cause:** Frontend is pointing to wrong Cognito pool ID.
**Fix:** Update `NEXT_PUBLIC_COGNITO_USER_POOL_ID` in `frontend/.env.local` with the correct value from the CloudForgeAuth stack output.

### Training takes too long (>30 min)

**Cause:** Large dataset with auto mode trying many models.
**Fix:** Use single mode with a specific model type, or reduce dataset size. Fargate timeout is 2 hours (set by Step Functions).

---

## S3 Path Convention

All user data follows this structure:

```
s3://cloudforge-data-{account_id}/
├── preloaded/                          # Shared Kaggle datasets
│   ├── retail-churn.csv
│   ├── supermarket-sales.csv
│   ├── customer-segmentation.csv
│   └── store-demand.csv
│
└── {userId}/
    └── {projectId}/
        ├── raw/
        │   └── dataset.csv             # Uploaded or copied from preloaded
        ├── profile.json                # Output of ProfileData Lambda
        ├── processed/
        │   ├── X_train.csv             # Output of EtlPreprocess Lambda
        │   ├── X_val.csv
        │   ├── y_train.csv
        │   ├── y_val.csv
        │   └── metadata.json           # Feature columns, encoders, class labels
        └── {jobId}/
            ├── model.pkl               # Trained model (output of Fargate container)
            ├── metrics.json            # Accuracy, F1, feature importance
            ├── leaderboard.json        # Auto mode: all candidate model scores
            └── config.json             # Training configuration used
```

---

## DynamoDB Schema

### cloudforge-projects

| Key | Type | Description |
|-----|------|-------------|
| `userId` (PK) | String | Cognito `sub` claim |
| `projectId` (SK) | String | UUID |
| `projectName` | String | User-provided name |
| `taskType` | String | `classification` or `regression` |
| `useCase` | String | `churn_prediction`, `sales_forecasting`, etc. |
| `status` | String | `created` → `uploading` → `DATA_UPLOADED` → `training` → `COMPLETED` |
| `dataSource` | String | `uploaded` or `preloaded` |
| `datasetS3Path` | String | S3 key to raw CSV |
| `dataProfile` | Map | Column stats, histograms, correlation, PCA |
| `targetColumn` | String | Selected target column name |
| `selectedFeatures` | List | Feature columns selected by user |
| `latestJobId` | String | Most recent training job ID |
| `createdAt` | String | ISO 8601 UTC timestamp |
| `updatedAt` | String | ISO 8601 UTC timestamp |

### cloudforge-jobs

| Key | Type | Description |
|-----|------|-------------|
| `projectId` (PK) | String | Parent project ID |
| `jobId` (SK) | String | UUID |
| `userId` | String | Owner's Cognito sub |
| `status` | String | `STARTING` → `PROFILING` → `PREPROCESSING` → `TRAINING` → `EVALUATING` → `COMPLETED` or `FAILED` |
| `currentStep` | String | Human-readable step name |
| `stepFunctionArn` | String | ARN of the Step Functions execution |
| `modelType` | String | e.g., `xgboost_clf`, `random_forest_reg` |
| `metrics` | Map | `{ accuracy, f1, precision, recall, ... }` |
| `featureImportance` | List | `[{ feature, importance }, ...]` |
| `modelArtifactS3Path` | String | S3 key to `model.pkl` |
| `metricsS3Path` | String | S3 key to `metrics.json` |
| `isRegression` | Boolean | Whether this is a regression task |
| `createdAt` | String | ISO 8601 UTC timestamp |
| `completedAt` | String | ISO 8601 UTC timestamp |

### cloudforge-chats

| Key | Type | Description |
|-----|------|-------------|
| `userId` (PK) | String | Cognito sub |
| `sessionId` (SK) | String | Chat session UUID |
| `messages` | List | `[{ role, content }, ...]` |
| `projectId` | String | Associated project |
| `createdAt` | String | ISO 8601 UTC timestamp |

---

## API Routes Reference

| Method | Route | Lambda | Auth | Description |
|--------|-------|--------|------|-------------|
| POST | `/projects` | create_project | Yes | Create new project |
| GET | `/projects` | list_projects | Yes | List user's projects |
| GET | `/projects/{id}` | get_project | Yes | Get project details |
| DELETE | `/projects/{id}` | delete_project | Yes | Delete a project |
| PATCH | `/projects/{id}` | update_project | Yes | Update project fields |
| POST | `/projects/{id}/upload-url` | get_upload_url | Yes | Get S3 presigned upload URL |
| POST | `/projects/{id}/select-preloaded` | select_preloaded | Yes | Copy preloaded dataset |
| POST | `/projects/{id}/recompute-profile` | recompute_profile | Yes | Recompute data analytics |
| POST | `/projects/{id}/train` | trigger_pipeline | Yes | Start training pipeline |
| GET | `/projects/{id}/results` | get_job_metrics | Yes | Get latest job metrics |
| POST | `/projects/{id}/results-chat` | results_chat | Yes | Chat about results |
| GET | `/projects/{id}/jobs/{jobId}` | get_job_status | Yes | Poll job status |
| GET | `/projects/{id}/jobs/{jobId}/download` | get_model_download | Yes | Get model download URL |
| POST | `/projects/{id}/jobs/{jobId}/interpret` | interpret_results | Yes | AI business insights |
| POST | `/projects/{id}/jobs/{jobId}/infer` | run_inference | Yes | Run prediction |
| POST | `/chat` | chat | Yes | AI chatbot |
| GET | `/preloaded-datasets` | list_preloaded | Yes | List sample datasets |
