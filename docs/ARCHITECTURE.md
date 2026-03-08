# RetailMind — AI-Powered Analytics Platform for Retail SMEs

> **Problem:** Retail SMEs lack data analysts and ML expertise. Existing tools (SageMaker Canvas, Roboflow) assume technical users.
>
> **Solution:** A serverless SaaS where retail SMEs describe a business problem via a chatbot, upload or select a dataset, and receive trained models with plain-English business recommendations.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND                                                           │
│  CloudFront ──> S3 (Next.js static export)                          │
│  Browser ──> API Gateway (REST) ──> Cognito JWT check               │
├─────────────────────────────────────────────────────────────────────┤
│  API LAYER (all Lambda)                                             │
│  ├── CRUD: create/list/get/delete projects                          │
│  ├── Upload: presigned S3 URLs for CSV                              │
│  ├── Chatbot: Bedrock Claude — problem alignment                    │
│  ├── Trigger: start Step Functions pipeline                         │
│  ├── Status: poll job progress                                      │
│  ├── Inference: load model from S3, predict                         │
│  └── Interpret: Bedrock Claude — business recommendations           │
├─────────────────────────────────────────────────────────────────────┤
│  PIPELINE (Step Functions)                                          │
│  Profile Data ──> ETL ──> Auto-Select Model ──> Fargate Train       │
│  ──> Evaluate ──> Deploy                                            │
├─────────────────────────────────────────────────────────────────────┤
│  DATA                                                               │
│  S3: datasets, models, preprocessing pipelines, preloaded Kaggle    │
│  DynamoDB: projects, jobs, chat sessions                            │
│  ECR: training container images                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. AWS Services (12)

| # | Service | What it does |
|---|---|---|
| 1 | **S3** | Stores frontend, user CSVs, trained models, preloaded Kaggle datasets |
| 2 | **CloudFront** | CDN for the frontend |
| 3 | **Cognito** | User sign-up/login, JWT tokens |
| 4 | **API Gateway** | REST API, validates Cognito JWT on every request |
| 5 | **Lambda** | All API handlers + pipeline steps (profiling, ETL, evaluation) |
| 6 | **DynamoDB** | Project metadata, job status, chat history |
| 7 | **Step Functions** | Orchestrates the training pipeline step-by-step |
| 8 | **ECS Fargate** | Runs training containers (sklearn, XGBoost) |
| 9 | **ECR** | Stores training Docker images |
| 10 | **Bedrock (Claude)** | Powers the chatbot + generates business recommendations from results |
| 11 | **EventBridge** | Routes Fargate completion/failure events |
| 12 | **CloudWatch** | Logs and monitoring |

**No ALB** — all HTTP goes through API Gateway → Lambda. Fargate only runs batch training jobs (invoked by Step Functions, not serving HTTP).

**No SQS** — the pipeline is sequential (profile → ETL → train → evaluate), which is exactly what Step Functions does. SQS is for fan-out/worker patterns.

---

## 3. S3 Layout

One bucket: `cloudforge-data-{account_id}`

```
cloudforge-data-{account_id}/
├── preloaded/                              # Kaggle datasets, uploaded once during setup
│   ├── retail-churn/
│   │   ├── data.csv
│   │   └── metadata.json                  # name, description, columns, suggested target
│   ├── supermarket-sales/
│   ├── customer-segmentation/
│   └── store-demand-forecasting/
│
└── users/
    └── {userId}/                           # Everything user-specific lives under their ID
        └── {projectId}/
            ├── raw/
            │   └── data.csv                # Uploaded CSV or copied from preloaded/
            ├── processed/
            │   ├── train.csv               # 80% split, preprocessed
            │   ├── val.csv                 # 20% split, preprocessed
            │   ├── pipeline.json           # Saved preprocessing steps (for inference replay)
            │   └── profile.json            # Data profiling results
            └── models/
                └── {jobId}/
                    ├── model.pkl           # Trained model
                    ├── metrics.json        # Accuracy, F1, etc.
                    └── config.json         # What model + hyperparams were used
```

Frontend is in a separate bucket: `cloudforge-frontend-{account_id}`

**Key rule:** Lambda always builds S3 paths using `userId` from the Cognito JWT, never from the request body. This prevents users from accessing each other's data.

```python
# CORRECT — userId from JWT
user_id = event["requestContext"]["authorizer"]["claims"]["sub"]
s3_key = f"users/{user_id}/{project_id}/raw/data.csv"

# WRONG — never trust user input for paths
user_id = json.loads(event["body"])["userId"]
```

**Presigned URLs** for upload: Lambda generates a PUT URL scoped to `users/{userId}/{projectId}/raw/data.csv`, valid for 15 minutes. Browser uploads directly to S3 — no file goes through Lambda.

**Preloaded datasets:** When a user selects a Kaggle dataset, Lambda copies it to `users/{userId}/{projectId}/raw/data.csv`. This keeps the pipeline path-consistent (always reads from `users/`).

---

## 4. DynamoDB Tables

### Projects Table: `cloudforge-projects`

```
PK: userId      SK: projectId

Attributes:
  projectName       "Customer Churn Analysis"
  useCase           "churn_prediction" | "sales_forecasting" | "customer_segmentation" | "demand_forecasting" | "custom"
  taskType          "classification" | "regression" | "clustering"
  dataSource        "uploaded" | "preloaded"
  preloadedDataset  "retail-churn" (null if uploaded)
  targetColumn      "Churn"
  status            "CREATED" | "DATA_UPLOADED" | "PROFILED" | "TRAINING" | "COMPLETED" | "FAILED"
  dataProfile       { rowCount, colCount, columns: [...], classBalance, nullSummary }
  latestJobId       "job_01HXZ..."
  createdAt         ISO 8601 UTC
  updatedAt         ISO 8601 UTC

Access patterns:
  - List user's projects:  Query PK = userId
  - Get one project:       GetItem PK = userId, SK = projectId
```

### Jobs Table: `cloudforge-jobs`

```
PK: projectId   SK: jobId

Attributes:
  userId              (denormalized — for authorization checks)
  modelType           "xgboost" | "random_forest" | "logistic" | "linear" | "decision_tree"
  hyperparameters     { max_depth: 6, n_estimators: 200 }
  status              "PROFILING" | "PREPROCESSING" | "TRAINING" | "EVALUATING" | "COMPLETED" | "FAILED"
  currentStep         "Training model (XGBoost)..."
  failureReason       null or error message
  metrics             { accuracy: 0.89, f1: 0.87, precision: 0.91, recall: 0.83 }
  featureImportance   { tenure: 0.32, monthly_spend: 0.28, ... }
  confusionMatrix     [[742, 68], [89, 601]]
  modelS3Key          "users/{userId}/{projectId}/models/{jobId}/model.pkl"
  trainingDurationSec 245
  createdAt           ISO 8601 UTC
  completedAt         ISO 8601 UTC

Access patterns:
  - List jobs for project:  Query PK = projectId
  - Get one job:            GetItem PK = projectId, SK = jobId
```

**Authorization on Jobs:** Since Jobs PK is `projectId` (not `userId`), every Lambda that reads jobs must first verify the user owns the project:

```python
# 1. Check user owns the project
project = projects_table.get_item(Key={"userId": user_id, "projectId": project_id})
if not project.get("Item"):
    return {"statusCode": 403, ...}

# 2. Now safe to query jobs
jobs = jobs_table.query(KeyConditionExpression=Key("projectId").eq(project_id))
```

### Chat Sessions Table: `cloudforge-chats`

```
PK: userId       SK: sessionId

Attributes:
  projectId        linked project (null if pre-project)
  messages         [ { role: "user", content: "...", ts: "..." }, { role: "assistant", ... } ]
  suggestedConfig  { useCase, taskType, suggestedTarget, businessContext }
  createdAt        ISO 8601 UTC
```

---

## 5. API Endpoints

Base: `https://{api_id}.execute-api.ap-southeast-1.amazonaws.com/prod`

All routes require `Authorization: Bearer {cognito_token}` except OPTIONS.

| Method | Path | What it does |
|---|---|---|
| POST | `/projects` | Create project |
| GET | `/projects` | List user's projects |
| GET | `/projects/{id}` | Get project + data profile |
| DELETE | `/projects/{id}` | Delete project |
| POST | `/projects/{id}/upload-url` | Get presigned S3 PUT URL |
| POST | `/projects/{id}/select-preloaded` | Copy a Kaggle dataset to user's project |
| POST | `/projects/{id}/train` | Start the training pipeline |
| GET | `/projects/{id}/jobs/{jobId}` | Get job status + metrics |
| POST | `/projects/{id}/jobs/{jobId}/infer` | Run prediction on trained model |
| GET | `/projects/{id}/jobs/{jobId}/download` | Get presigned URL for model download |
| POST | `/chat` | Send message to chatbot |
| GET | `/preloaded-datasets` | List available Kaggle datasets |

---

## 6. Step Functions Pipeline

```
Input: { userId, projectId, jobId, targetColumn, modelType?, hyperparams? }

START
  │
  ├──> Lambda: profile_data
  │     Read raw CSV from S3, detect column types, null rates, distributions
  │     Write profile.json to S3, update DynamoDB project with dataProfile
  │
  ├──> Lambda: etl_preprocess
  │     Impute nulls (median/mode), encode categoricals (one-hot),
  │     scale numerics (StandardScaler), 80/20 train/val split
  │     Write train.csv, val.csv, pipeline.json to S3
  │
  ├──> Lambda: auto_select_model
  │     Based on row count + task type:
  │       < 1K rows:     logistic regression or decision tree
  │       1K–50K rows:   xgboost
  │       > 50K rows:    xgboost with early stopping
  │       regression:    linear regression or xgboost
  │     User can override with explicit modelType
  │     Output: container image tag, hyperparams, Fargate resource size
  │
  ├──> ECS RunTask (Fargate): train model
  │     Pull container from ECR, download train/val from S3
  │     Train, evaluate, upload model.pkl + metrics.json to S3
  │     Step Functions waits for task completion (.sync integration)
  │
  ├──> Lambda: evaluate_model
  │     Load model + val set, compute metrics
  │     Write to DynamoDB Jobs table: metrics, featureImportance, confusionMatrix
  │
  ├──> Lambda: deploy_model
  │     Update DynamoDB: job status = COMPLETED, project status = COMPLETED
  │
  └──> END

Error handling:
  Every step has a Catch → update job status to FAILED with error message → END
```

---

## 7. Chatbot (Bedrock Claude)

Not a full conversational agent — it's a **structured Bedrock call** that helps frame the business problem.

### How it works

1. User describes their problem: *"I want to know which customers might stop buying"*
2. Lambda sends message + system prompt to Bedrock Claude (Haiku — cheapest, fastest)
3. Claude returns a friendly reply + a structured `suggestedConfig` JSON
4. Frontend displays the suggestion, user can accept or tweak
5. Max 3 follow-up turns per session

```python
SYSTEM_PROMPT = """
You are RetailMind, an AI assistant for retail business analysts.
Help users frame their business question as a data analytics task.
Suggest the task type, target column, and useful features.
Speak in business terms, not technical jargon.

Always include a suggestedConfig JSON in your response:
{
  "useCase": "churn_prediction|sales_forecasting|customer_segmentation|demand_forecasting|custom",
  "taskType": "classification|regression|clustering",
  "suggestedTarget": "column_name",
  "suggestedFeatures": ["col1", "col2"],
  "businessContext": "one-line summary"
}
"""
```

### Result Interpretation (post-training)

After training, a separate Lambda calls Bedrock to turn metrics into business advice:

```
Input:  model type, metrics, feature importance, business context
Output: 3-5 plain-English recommendations

Example:
"1. Contract type matters most. Month-to-month customers are 3x more
    likely to churn — consider incentives for annual plans.
 2. New customers are at risk. Tenure < 6 months has 45% churn rate.
    Focus onboarding efforts on this group.
 3. Support tickets are a warning sign. 3+ tickets in the last quarter
    doubles churn probability. Prioritize quick resolution."
```

**Cost:** Claude Haiku is ~$0.0005 per chatbot turn. Negligible.

---

## 8. Training Containers

Two containers in ECR:

| Tag | Models | Use case |
|---|---|---|
| `tabular-sklearn` | Logistic Regression, Linear Regression, Random Forest, Decision Tree | Small datasets, simple models |
| `tabular-xgboost` | XGBoost | Medium-large datasets, best general performance |

### Container contract

Every container reads env vars set by Step Functions:

```
TASK_TYPE       = "classification" | "regression"
MODEL_TYPE      = "xgboost" | "logistic" | ...
DATA_S3_PATH    = "s3://cloudforge-data-xxx/users/{userId}/{projectId}/processed/"
OUTPUT_S3_PATH  = "s3://cloudforge-data-xxx/users/{userId}/{projectId}/models/{jobId}/"
HYPERPARAMS     = '{"max_depth": 6, "n_estimators": 200}'

Flow:
  1. Download train.csv + val.csv from S3
  2. Train model
  3. Evaluate on val set
  4. Upload model.pkl + metrics.json to S3
  5. Exit 0 (success) or 1 (failure)
```

**Fargate resources:** 1 vCPU, 2 GB RAM for most jobs. ~$0.004 per 5-minute run.

---

## 9. Inference

Lambda-based, not a persistent endpoint. Model loads from S3 on each call.

```
POST /projects/{id}/jobs/{jobId}/infer
Body: { "data": [{ "tenure": 3, "monthly_spend": 29.99, "contract": "monthly" }] }

Lambda flow:
  1. Verify user owns project (JWT userId → DynamoDB)
  2. Download model.pkl + pipeline.json from S3 to /tmp
  3. Apply same preprocessing as training (using saved pipeline.json)
  4. model.predict() + model.predict_proba()
  5. Return prediction + confidence

Response:
{
  "predictions": [{
    "prediction": "churned",
    "confidence": 0.87,
    "probabilities": { "churned": 0.87, "retained": 0.13 }
  }]
}
```

Cold start is ~3-5 seconds (loading model). Fine for a demo.

---

## 10. Preloaded Kaggle Datasets

| Dataset | Use Case | Rows | Suggested Target |
|---|---|---|---|
| Telco Customer Churn | Churn prediction | 7,043 | `Churn` |
| Supermarket Sales | Sales analysis | 1,000 | `gross income` |
| Mall Customers | Customer segmentation | 200 | N/A (clustering) |
| Store Item Demand | Demand forecasting | 913,000 | `sales` |

Each has a `metadata.json`:
```json
{
  "id": "retail-churn",
  "name": "Telco Customer Churn",
  "description": "Predict which customers will cancel their subscription.",
  "rows": 7043,
  "columns": 21,
  "suggestedUseCase": "churn_prediction",
  "suggestedTaskType": "classification",
  "suggestedTarget": "Churn",
  "sampleColumns": ["gender", "tenure", "MonthlyCharges", "Churn"]
}
```

Uploaded to S3 once during setup via a seed script. When a user picks one, Lambda copies it to their `users/{userId}/{projectId}/raw/` path.

---

## 11. Authentication

```
Cognito User Pool: cloudforge-users (ap-southeast-1)
  - Sign up with email + password
  - JWT access token valid 1 hour, refresh token 30 days

API Gateway: Cognito Authorizer on all routes
  - Validates JWT automatically
  - Lambda receives verified userId via:
    event["requestContext"]["authorizer"]["claims"]["sub"]

Data isolation:
  - DynamoDB: PK = userId → query only returns your data
  - S3: paths built with userId from JWT → can't access other users' files
  - Jobs: always verify project ownership before returning job data
```

---

## 12. Frontend

```
Next.js 14 (static export) → S3 + CloudFront
TypeScript, Ant Design or shadcn/ui
Auth via AWS Amplify JS (Cognito only)
Charts via Recharts
```

| Route | Page |
|---|---|
| `/` | Landing page |
| `/auth/login` | Login |
| `/auth/signup` | Sign up |
| `/dashboard` | Project list with status badges |
| `/projects/new` | Use case templates + chatbot |
| `/projects/[id]` | Upload CSV or pick preloaded dataset |
| `/projects/[id]/train` | Pipeline progress (polling) |
| `/projects/[id]/results` | Metrics, charts, business recommendations |
| `/projects/[id]/infer` | Input data, get predictions |

---

## 13. Evaluation Plan

| Dimension | What we test |
|---|---|
| **Architecture quality** | API latency (<500ms), pipeline end-to-end time (<10 min for 5K rows), chatbot response (<3s) |
| **Scalability** | Load test with 5/20/50 concurrent users, check Lambda scales, Fargate handles parallel jobs |
| **Security** | Cross-tenant access test (User A can't see User B's data), invalid JWT rejected, S3 not publicly accessible |
| **Business KPIs** | Time-to-insight, pipeline success rate, cost per tenant |

---

## 14. Cost Estimate (demo scale: ~10 users)

| Service | Cost |
|---|---|
| S3, CloudFront, Cognito, API Gateway, Lambda, DynamoDB, Step Functions, ECR, EventBridge, CloudWatch | **Free tier** |
| Fargate (~50 training jobs × 5 min) | ~$0.50 |
| Bedrock Haiku (~200 calls) | ~$0.20 |
| **Total** | **< $1/month** |

No VPC, no NAT Gateway — Fargate runs in default VPC public subnets. This keeps costs near zero for a demo. Production would use private subnets + NAT Gateway (~$33/month) but that's out of scope.

---

## 15. Implementation Phases (4 weeks)

### Week 1: Foundation
- CDK: S3, DynamoDB, Cognito, API Gateway, Lambda scaffold
- Backend: create/list/get project, upload URL, shared utilities
- Frontend: Next.js scaffold, auth flow, dashboard
- Seed preloaded datasets

### Week 1-2: Pipeline
- Lambdas: profile, ETL, auto-select, evaluate, deploy
- Training containers → ECR
- Step Functions state machine + ECS Fargate setup
- Test: trigger pipeline manually → model in S3

### Week 2-3: Chatbot + Inference + Full API
- Bedrock chatbot Lambda + result interpretation Lambda
- Inference Lambda
- trigger_pipeline, job status endpoints
- Test: full flow via Postman

### Week 2-4: Frontend (parallel)
- All pages: project creation, upload, pipeline monitor, results, inference
- Charts (Recharts), business insights display
- Polling for job status

### Week 4: Integration + Demo
- End-to-end testing
- CloudWatch dashboard
- Security tests, light load test
- Demo prep
