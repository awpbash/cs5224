# RetailMind - AI-Powered Analytics Platform for Retail SMEs

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
│  ├── Chatbot: Bedrock Claude - problem alignment                    │
│  ├── Trigger: start Step Functions pipeline                         │
│  ├── Status: poll job progress                                      │
│  ├── Inference: load model from S3, predict                         │
│  └── Interpret: Bedrock Claude - business recommendations           │
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
| 8 | **ECS Fargate** | Runs training containers (scikit-learn, XGBoost, LightGBM) |
| 9 | **ECR** | Stores training Docker images |
| 10 | **Bedrock (Claude)** | Powers the chatbot + generates business recommendations from results |
| 11 | **EventBridge** | Routes Fargate completion/failure events |
| 12 | **CloudWatch** | Logs and monitoring |

**No ALB** - all HTTP goes through API Gateway → Lambda. Fargate only runs batch training jobs (invoked by Step Functions, not serving HTTP).

**No SQS** - the pipeline is sequential (profile → ETL → train → evaluate), which is exactly what Step Functions does. SQS is for fan-out/worker patterns.

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
            │   ├── X_train.csv             # Features, 80% split, preprocessed
            │   ├── X_val.csv               # Features, 20% split, preprocessed
            │   ├── y_train.csv             # Target, 80% split
            │   ├── y_val.csv               # Target, 20% split
            │   ├── pipeline.pkl            # Saved preprocessing pipeline (scaler, label encoders)
            │   └── profile.json            # Data profiling results
            └── models/
                └── {jobId}/
                    ├── model.pkl           # Trained model
                    ├── metrics.json        # Accuracy, F1, confusion matrix, feature importance
                    ├── leaderboard.json    # All candidate models ranked (auto mode)
                    └── config.json         # What model + hyperparams were used
```

Frontend is in a separate bucket: `cloudforge-frontend-{account_id}`

**Key rule:** Lambda always builds S3 paths using `userId` from the Cognito JWT, never from the request body. This prevents users from accessing each other's data.

```python
# CORRECT - userId from JWT
user_id = event["requestContext"]["authorizer"]["claims"]["sub"]
s3_key = f"users/{user_id}/{project_id}/raw/data.csv"

# WRONG - never trust user input for paths
user_id = json.loads(event["body"])["userId"]
```

**Presigned URLs** for upload: Lambda generates a PUT URL scoped to `users/{userId}/{projectId}/raw/data.csv`, valid for 15 minutes. Browser uploads directly to S3 - no file goes through Lambda.

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
  userId              (denormalized - for authorization checks)
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
| PUT | `/projects/{id}` | Update project (target, features, business context) |
| DELETE | `/projects/{id}` | Delete project |
| POST | `/projects/{id}/upload-url` | Get presigned S3 PUT URL |
| POST | `/projects/{id}/select-preloaded` | Copy a Kaggle dataset to user's project |
| POST | `/projects/{id}/recompute-profile` | Recompute data profile after feature selection |
| POST | `/projects/{id}/train` | Start the training pipeline |
| GET | `/projects/{id}/jobs/{jobId}` | Get job status + metrics |
| GET | `/projects/{id}/jobs/{jobId}/metrics` | Get detailed job metrics (confusion matrix, feature importance) |
| POST | `/projects/{id}/jobs/{jobId}/infer` | Run prediction on trained model |
| POST | `/projects/{id}/jobs/{jobId}/interpret` | Generate Bedrock business recommendations |
| GET | `/projects/{id}/jobs/{jobId}/download` | Get presigned URL for model download |
| POST | `/chat` | Send message to chatbot (problem refinement) |
| POST | `/results-chat` | Send follow-up question about results |
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
  │     Handle booleans, expand datetimes (year/month/dayofweek),
  │     impute nulls (median/mode), label-encode categoricals,
  │     scale numerics (StandardScaler), stratified 80/20 train/val split
  │     Write X_train, X_val, y_train, y_val, pipeline.pkl to S3
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

Not a full conversational agent - it's a **structured Bedrock call** that helps frame the business problem.

### Three Bedrock use cases

**1. Problem Refinement Chat (`chat.py`):**
1. User describes their problem: *"I want to know which customers might stop buying"*
2. Lambda sends message + data context (columns, row count, nulls) + system prompt to Bedrock Claude Haiku
3. Claude returns a friendly reply + a structured `suggestedConfig` JSON (use case, task type, target, features)
4. Frontend displays the suggestion, user can accept or tweak via multi-turn conversation

**2. Result Interpretation (`interpret_results.py`):**
- Takes model metrics, feature importance, and business context
- Returns executive summary, 4-5 actionable recommendations with impact levels (high/medium/low), top 5 feature insights
- Focuses on ROI and business language, not ML jargon

**3. Results Q&A Chat (`results_chat.py`):**
- Follow-up questions about model results, next steps, feature meanings
- Includes full project context + metrics in system prompt for grounded answers

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
    likely to churn - consider incentives for annual plans.
 2. New customers are at risk. Tenure < 6 months has 45% churn rate.
    Focus onboarding efforts on this group.
 3. Support tickets are a warning sign. 3+ tickets in the last quarter
    doubles churn probability. Prioritize quick resolution."
```

**Cost:** Claude Haiku is ~$0.0005 per chatbot turn. Negligible.

---

## 8. Training Container

One unified AutoML container in ECR: `tabular-automl`

**Supported models (19 total):**

| Category | Models |
|---|---|
| Classification (8) | Logistic Regression, Decision Tree, Random Forest, Gradient Boosting, XGBoost, LightGBM, KNN, SVM |
| Regression (11) | Linear Regression, Ridge, Lasso, ElasticNet, Decision Tree, Random Forest, Gradient Boosting, XGBoost, LightGBM, KNN, SVM |

Each model includes a hyperparameter search grid for auto-tuning via `RandomizedSearchCV`.

### Container contract

The container supports two modes:

```
MODE            = "auto" | "single"   (default: auto)
TASK_TYPE       = "classification" | "regression"
MODEL_TYPE      = model name for single mode (e.g. "xgboost_clf")
DATA_S3_PATH    = "s3://cloudforge-data-xxx/users/{userId}/{projectId}/processed/"
OUTPUT_S3_PATH  = "s3://cloudforge-data-xxx/users/{userId}/{projectId}/models/{jobId}/"
HYPERPARAMS     = '{"max_depth": 6, "n_estimators": 200}'
CV_FOLDS        = number of CV folds (default: 5)
MAX_CANDIDATES  = max models to try in auto mode (default: 8)
```

**Auto mode:** Selects candidate models based on dataset size (skips SVM/KNN for large datasets), runs cross-validation + hyperparameter search for each, picks the best. Uploads `model.pkl`, `metrics.json`, `leaderboard.json`, `config.json`.

**Single mode:** Trains the specified model with optional hyperparameter overrides. Uploads `model.pkl`, `metrics.json`, `config.json`.

```
Flow:
  1. Download X_train, X_val, y_train, y_val from S3
  2. Select candidate models (auto) or use specified model (single)
  3. Cross-validate with hyperparameter tuning
  4. Upload model.pkl + metrics.json + leaderboard.json to S3
  5. Exit 0 (success) or 1 (failure)
```

**Fargate resources:** 1 vCPU, 2 GB RAM for most jobs. ~$0.05 per training run.

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
TypeScript, Tailwind CSS, Radix UI / shadcn components
Auth via Cognito JS SDK
Charts via Recharts
Animations via Framer Motion
Icons via Lucide React
```

| Route | Page |
|---|---|
| `/` | Landing page |
| `/auth/login` | Login |
| `/auth/signup` | Sign up |
| `/auth/forgot-password` | Password reset flow |
| `/dashboard` | Project list with status badges, delete, filtering |
| `/projects/new` | Create project (name, use case, task type) |
| `/projects/[id]` | Project overview with step navigation |
| `/projects/[id]/upload` | Drag-drop CSV upload + preloaded dataset picker + data preview |
| `/projects/[id]/chat` | Data exploration chatbot (multi-turn, context-aware) |
| `/projects/[id]/profile` | Data profiling - column stats, null %, types, feature selection, target picker |
| `/projects/[id]/train` | Auto-config display, advanced override, cost estimate, pipeline trigger + status polling |
| `/projects/[id]/results` | Business summary, KPIs, feature importance, Bedrock recommendations, results Q&A chat |
| `/projects/[id]/infer` | Tabular form input built from features, prediction + confidence display |
| `/compare` | Side-by-side model comparison |
| `/models` | Browse trained models |

**Key components:** AuthGuard (protected routes), ChatFAB (floating chat), Navbar, OnboardingTour, ThemeToggle (light/dark mode), 10+ Radix UI primitives.

---

## 13. Evaluation Plan

| Dimension | What we test | Method |
|---|---|---|
| **Architecture quality** | API latency (<500ms), pipeline end-to-end time (<10 min for 5K rows), chatbot response (<3s) | CloudWatch metrics, end-to-end timing |
| **Scalability** | Load test with 50–200 concurrent requests, verify Lambda auto-scaling, Fargate handles parallel training jobs | loader.io free tier or `hey` CLI tool against API Gateway endpoints; monitor via CloudWatch dashboard |
| **Fault tolerance** | System recovers from component failures - Fargate task termination mid-training, Lambda cold starts, DynamoDB throttling | Terminate ECS task via `aws ecs stop-task` during training; verify Step Functions catches failure and updates job status to FAILED. Multi-AZ resilience is inherent: Lambda, DynamoDB, API Gateway, and S3 are all multi-AZ by default; Fargate runs across 2 public subnets in separate AZs |
| **Security** | Cross-tenant data isolation (User A can't see User B's data), invalid JWT rejected, S3 not publicly accessible, presigned URLs expire correctly | Manual penetration test: modify JWT claims, attempt cross-user API calls, verify S3 bucket policies |
| **Business KPIs** | Time-to-insight (<15 min from upload to recommendations), pipeline success rate (>95%), cost per tenant (<$0.10/run) | Track via CloudWatch custom metrics and DynamoDB job records |

---

## 14. Cost Estimate (demo scale: ~10 users)

| Service | Cost |
|---|---|
| S3, CloudFront, Cognito, API Gateway, Lambda, DynamoDB, Step Functions, ECR, EventBridge, CloudWatch | **Free tier** |
| VPC (2 public subnets, no NAT Gateway, S3 + DynamoDB endpoints) | **$0** |
| Fargate (~50 training jobs × 5 min each, 1 vCPU / 2 GB) | ~$2.50 |
| Bedrock Claude Haiku (~200 calls across chat, interpret, Q&A) | ~$0.20 |
| **Total** | **~$5–12/month** |

No NAT Gateway - Fargate runs in public subnets with public IPs. VPC endpoints for S3 and DynamoDB avoid data transfer charges. Production would use private subnets + NAT Gateway (~$33/month) but that's out of scope for this demo.

---

## 15. Implementation Phases (4 weeks)

### Week 1: Foundation [COMPLETED]
- CDK stacks: storage (S3, DynamoDB), auth (Cognito), API Gateway, network (VPC)
- Backend: all CRUD Lambdas (create/list/get/update/delete project), upload URL, shared utilities
- Frontend: Next.js scaffold, Cognito auth flow (login/signup/forgot-password), dashboard
- Seed preloaded datasets (4 Kaggle datasets)

### Week 1-2: Pipeline [COMPLETED]
- Unified AutoML container (`tabular-automl`) with 19 models (8 clf + 11 reg), auto/single modes, CV + hyperparameter search
- Pipeline Lambdas: profile_data, etl_preprocess, auto_select_model, evaluate_model, deploy_model
- CDK: Step Functions state machine, ECS Fargate cluster, ECR repository
- EventBridge handlers: on_fargate_complete, scheduled_retrain
- Test: trigger pipeline manually → model in S3

### Week 2-3: Chatbot + Inference + Full API [COMPLETED]
- Bedrock integration: chat (problem refinement), interpret_results (business recommendations), results_chat (follow-up Q&A)
- Inference Lambda with full preprocessing pipeline replay
- recompute_profile, trigger_pipeline, get_job_status, get_job_metrics endpoints
- Test: full API flow from create project → train → infer via curl/Postman

### Week 2-4: Frontend (parallel) [COMPLETED]
- All 15 pages: auth, dashboard, project creation, upload, chat, profile, train, results, inference, compare, models
- Components: AuthGuard, ChatFAB, Navbar, OnboardingTour, ThemeToggle, 10+ Radix UI primitives
- Charts (Recharts), Bedrock-powered business insights, results Q&A chat
- Polling for job status, presigned URL upload, dark mode

### Week 4: Integration + Evaluation [IN PROGRESS]
- End-to-end testing across all flows
- CloudWatch monitoring dashboard (5 widgets: API requests, errors, latency, pipeline runs, duration)
- Load testing: loader.io / `hey` against API Gateway (50-200 concurrent requests)
- Fault tolerance: Fargate task termination test, multi-AZ validation
- Security tests: cross-tenant isolation, JWT validation, S3 access policies
- Deploy script (`scripts/deploy.sh`) for one-command full deployment
- Final report + video presentation (due 19/04/26)
