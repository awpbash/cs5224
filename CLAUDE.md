# RetailMind — Project Guide

## Project Overview

RetailMind is an AI-powered analytics SaaS platform for retail SMEs, built for CS5224 Cloud Computing. Users describe a business problem via a chatbot, upload a CSV or select a preloaded Kaggle dataset, and receive a trained model with plain-English business recommendations — no data science expertise required. Built on 12 AWS services orchestrated via Step Functions.

**Key docs:**
- `docs/ARCHITECTURE.md` — full architecture design (source of truth for all service decisions)
- `docs/Preliminary.md` — preliminary report for submission
- `Project_Specification.pdf` — module requirements

**Deadlines:**
- Preliminary report: 09/03/26 at 18:00 (submit as Preliminary.pdf)
- Final report: 19/04/26 at 23:59
- Video presentation: 19/04/26 at 23:59

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (TypeScript), Ant Design / shadcn/ui, deployed as static export to S3+CloudFront |
| Backend (Lambdas) | Python 3.12 |
| Training containers | Python 3.12, scikit-learn, XGBoost, LightGBM (single AutoML container) |
| Infrastructure-as-Code | AWS CDK (Python) |
| Database | DynamoDB (on-demand) |
| Storage | S3 |
| Auth | Cognito User Pools |
| Orchestration | Step Functions (ASL via CDK) |
| Container registry | ECR |
| Container runtime | ECS Fargate |
| GenAI | Bedrock (Claude Haiku — chatbot + result interpretation) |
| Monitoring | CloudWatch |
| Events | EventBridge |

**Frontend note:** Next.js is used with `output: 'export'` for static site generation. The app is a pure client-side SPA — no SSR, no API routes in Next.js. All API calls go to API Gateway. This keeps deployment simple (S3 + CloudFront).

---

## Monorepo Structure

```
retailmind/
├── CLAUDE.md                          # THIS FILE — project guide
├── README.md                          # Setup instructions, quick start
│
├── frontend/                          # Next.js + TypeScript
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.ts
│   ├── .env.local                     # API_URL, COGNITO_POOL_ID, etc.
│   ├── src/
│   │   ├── app/                       # Next.js App Router pages
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx               # Landing page
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx           # Project list
│   │   │   ├── projects/
│   │   │   │   ├── new/
│   │   │   │   │   └── page.tsx       # Create project via chatbot + use case templates
│   │   │   │   └── [id]/
│   │   │   │       ├── page.tsx       # Project detail (upload CSV or pick preloaded dataset)
│   │   │   │       ├── upload/
│   │   │   │       │   └── page.tsx   # CSV upload + preloaded dataset picker + data preview
│   │   │   │       ├── chat/
│   │   │   │       │   └── page.tsx   # Chatbot problem refinement (split layout)
│   │   │   │       ├── profile/
│   │   │   │       │   └── page.tsx   # Data profile + feature selection + target selector
│   │   │   │       ├── train/
│   │   │   │       │   └── page.tsx   # Auto-config display + advanced override + cost estimate
│   │   │   │       ├── results/
│   │   │   │       │   └── page.tsx   # Business summary, KPIs, features, recommendations
│   │   │   │       └── infer/
│   │   │   │           └── page.tsx   # Tabular form input, get prediction
│   │   │   └── auth/
│   │   │       ├── login/
│   │   │       │   └── page.tsx
│   │   │       └── signup/
│   │   │           └── page.tsx
│   │   ├── components/
│   │   │   ├── ui/                    # Reusable UI primitives (button, card, input, etc.)
│   │   │   ├── layout/               # Navbar, sidebar, footer
│   │   │   ├── dashboard/            # ProjectCard, StatusBadge
│   │   │   ├── upload/               # FileDropzone, PreloadedDatasetPicker, DataPreviewTable, DataIssueCard
│   │   │   ├── chatbot/             # ChatWindow, ProblemSummaryCard, SuggestedColumnsCard
│   │   │   ├── profile/             # DataProfileStats, ColumnHistogram, FeatureSelector, TargetColumnPicker
│   │   │   ├── pipeline/             # StepProgressTracker, LogViewer, CostEstimator
│   │   │   ├── results/              # BusinessSummary, KPICard, FeatureImportanceCard, RecommendationsPanel, PredictionTable
│   │   │   └── inference/            # TabularInputForm, PredictionResult
│   │   ├── lib/
│   │   │   ├── api.ts                # API client (fetch wrapper for all endpoints)
│   │   │   ├── auth.ts               # Cognito auth helpers (sign-in, sign-up, get token)
│   │   │   ├── s3-upload.ts          # Presigned URL upload helper
│   │   │   └── types.ts              # Shared TypeScript types (Project, Job, DataProfile, etc.)
│   │   ├── hooks/
│   │   │   ├── useAuth.ts            # Auth state hook
│   │   │   ├── useProject.ts         # Project CRUD hook
│   │   │   └── useJobPolling.ts      # Poll job status at interval
│   │   └── styles/
│   │       └── globals.css
│   └── public/
│       └── logo.svg
│
├── backend/                           # Python Lambda functions
│   ├── requirements.txt               # Shared deps (boto3, etc.)
│   ├── lambdas/
│   │   ├── api/                       # API Gateway handlers
│   │   │   ├── create_project.py      # POST /projects
│   │   │   ├── list_projects.py       # GET /projects
│   │   │   ├── get_project.py         # GET /projects/{id}
│   │   │   ├── delete_project.py      # DELETE /projects/{id}
│   │   │   ├── get_upload_url.py      # POST /projects/{id}/upload-url
│   │   │   ├── select_preloaded.py    # POST /projects/{id}/select-preloaded
│   │   │   ├── trigger_pipeline.py    # POST /projects/{id}/train
│   │   │   ├── get_job_status.py      # GET /projects/{id}/jobs/{jobId}
│   │   │   ├── run_inference.py       # POST /projects/{id}/jobs/{jobId}/infer
│   │   │   ├── get_model_download.py  # GET /projects/{id}/jobs/{jobId}/download
│   │   │   ├── chat.py               # POST /chat (Bedrock chatbot)
│   │   │   ├── interpret_results.py   # POST /projects/{id}/jobs/{jobId}/interpret (Bedrock recommendations)
│   │   │   └── list_preloaded.py      # GET /preloaded-datasets
│   │   │
│   │   ├── pipeline/                  # Step Functions task handlers
│   │   │   ├── profile_data.py        # Analyze CSV: types, nulls, distributions
│   │   │   ├── etl_preprocess.py      # Impute, encode, scale, split train/val
│   │   │   ├── auto_select_model.py   # Pick model + hyperparams based on data profile
│   │   │   ├── evaluate_model.py      # Load model, run on val set, compute metrics
│   │   │   └── deploy_model.py        # Register model in DynamoDB, mark as ready
│   │   │
│   │   └── events/                    # EventBridge handlers
│   │       └── on_fargate_complete.py # Handle ECS task completion/failure
│   │
│   └── shared/                        # Shared Python utilities (packaged as Lambda layer)
│       ├── __init__.py
│       ├── db.py                      # DynamoDB get/put/query helpers
│       ├── s3_utils.py                # S3 read/write/presign helpers
│       ├── models.py                  # Pydantic models for Project, Job, DataProfile
│       └── config.py                  # Environment variable loading (table names, bucket names)
│
├── containers/                        # Docker images for training (pushed to ECR)
│   └── tabular-automl/
│       ├── Dockerfile
│       ├── requirements.txt           # scikit-learn, xgboost, lightgbm, pandas, boto3
│       ├── train.py                   # AutoML: auto mode (try multiple models, pick best) or single mode
│       └── models.py                  # Model registry: 20 models (10 clf + 10 reg) with search grids
│
├── infra/                             # AWS CDK (Python)
│   ├── app.py                         # CDK app entry point
│   ├── cdk.json
│   ├── requirements.txt               # aws-cdk-lib, constructs
│   └── stacks/
│       ├── __init__.py
│       ├── storage_stack.py           # S3 buckets, DynamoDB tables
│       ├── auth_stack.py              # Cognito User Pool, App Client
│       ├── api_stack.py               # API Gateway, Lambda functions, Cognito authorizer
│       ├── pipeline_stack.py          # Step Functions state machine, ECS cluster, Fargate task defs, ECR
│       ├── frontend_stack.py          # S3 bucket for SPA, CloudFront distribution
│       └── monitoring_stack.py        # CloudWatch dashboards, alarms
│
├── scripts/                           # Developer utility scripts
│   ├── deploy.sh                      # Full deploy: cdk deploy + build containers + push ECR + build frontend
│   ├── build-containers.sh            # Build and push all Docker images to ECR
│   ├── seed-data.sh                   # Upload sample datasets to S3 for testing
│   └── test-pipeline.sh              # Trigger a test pipeline run via CLI
│
├── tests/
│   ├── backend/                       # pytest tests for Lambda handlers
│   │   ├── test_profile_data.py
│   │   ├── test_etl_preprocess.py
│   │   └── test_inference.py
│   ├── containers/                    # Local training container tests
│   │   └── test_tabular_train.py
│   └── integration/                   # End-to-end pipeline tests
│       └── test_full_pipeline.py
│
└── docs/
    ├── ARCHITECTURE.md                # Full architecture (moved from root)
    ├── Preliminary.md                 # Preliminary report draft
    └── diagrams/                      # draw.io / Figma exports for report
```

---

## Coding Conventions

### Python (backend + containers)
- Python 3.12
- Type hints on all function signatures
- Pydantic for data validation and serialization (Project, Job, DataProfile models)
- `boto3` for all AWS SDK calls
- Each Lambda handler is a single file with a `handler(event, context)` entry point
- Shared utilities go in `backend/shared/` and are deployed as a Lambda Layer
- Use `os.environ` for config (table names, bucket names, region) — never hardcode
- Logging via `import logging; logger = logging.getLogger(__name__)`
- No frameworks (no Flask/FastAPI) — Lambda handlers are plain functions

### TypeScript (frontend)
- Strict TypeScript (`strict: true` in tsconfig)
- Next.js App Router (not Pages Router)
- All API types defined in `lib/types.ts` — shared across components
- `fetch` for API calls (no axios) — wrapped in `lib/api.ts`
- AWS Amplify JS SDK for Cognito auth only (not for API calls)
- Component files use PascalCase: `ProjectCard.tsx`
- Hook files use camelCase: `useJobPolling.ts`
- Prefer server components where possible; use `'use client'` only when needed for interactivity

### CDK (infra)
- Python CDK with `aws_cdk` library
- One stack per concern (storage, auth, api, pipeline, frontend, monitoring)
- Cross-stack references via stack outputs and imports
- All resource names prefixed with `cloudforge-` (kept for consistency with S3/DynamoDB naming in architecture)
- Tags on all resources: `project=retailmind`, `environment=dev`

### General
- No secrets in code — use environment variables or AWS Secrets Manager
- All S3 paths follow: `users/{userId}/{projectId}/...` for data isolation
- DynamoDB keys: `PK=userId, SK=projectId` (Projects), `PK=projectId, SK=jobId` (Jobs), `PK=userId, SK=sessionId` (Chats)
- UTC timestamps everywhere (`datetime.utcnow().isoformat()`)
- Git commit messages: imperative mood, concise (`Add data profiling Lambda`)

---

## AWS Resource Naming

| Resource | Name Pattern |
|---|---|
| S3 (data) | `cloudforge-data-{account_id}` |
| S3 (frontend) | `cloudforge-frontend-{account_id}` |
| DynamoDB (projects) | `cloudforge-projects` |
| DynamoDB (jobs) | `cloudforge-jobs` |
| DynamoDB (chats) | `cloudforge-chats` |
| Cognito User Pool | `cloudforge-users` |
| API Gateway | `cloudforge-api` |
| ECR Repository | `cloudforge-training` |
| ECS Cluster | `cloudforge-cluster` |
| Step Functions | `cloudforge-pipeline` |
| CloudFront | `cloudforge-cdn` |

---

## Lambda Handler Pattern

Every Lambda follows this pattern:

```python
import json
import logging
import os
from shared.db import get_project, put_project
from shared.models import Project

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ["PROJECTS_TABLE"]

def handler(event, context):
    try:
        # Extract user ID from Cognito JWT (set by API Gateway authorizer)
        user_id = event["requestContext"]["authorizer"]["claims"]["sub"]

        # Parse request
        body = json.loads(event.get("body", "{}"))

        # Business logic here
        ...

        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps(result)
        }
    except Exception as e:
        logger.exception("Handler error")
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps({"error": str(e)})
        }
```

---

## Training Container Contract

Single unified AutoML container (`containers/tabular-automl/`). Supports two modes:

**Environment variables:**
```
DATA_S3_PATH    s3://bucket/users/{userId}/{projectId}/processed/
OUTPUT_S3_PATH  s3://bucket/users/{userId}/{projectId}/models/{jobId}/
TASK_TYPE       "classification" | "regression"
MODE            "auto" | "single"  (default: auto)
MODEL_TYPE      model name for single mode (e.g. "xgboost_clf")
HYPERPARAMS     JSON string of hyperparameter overrides
CV_FOLDS        number of CV folds (default: 5)
MAX_CANDIDATES  max models to try in auto mode (default: 8)
```

**Auto mode (`MODE=auto`):**
1. Selects candidate models based on dataset size (skips SVM/KNN for large datasets, skips complex ensembles for small)
2. Runs cross-validation + RandomizedSearchCV for each candidate
3. Ranks by validation score, picks the best
4. Uploads: `model.pkl`, `metrics.json`, `leaderboard.json`, `config.json`

**Single mode (`MODE=single`):**
1. Trains the specified `MODEL_TYPE` with optional `HYPERPARAMS` overrides
2. Uploads: `model.pkl`, `metrics.json`, `config.json`

**Available models (20 total):**
- Classification: logistic_regression, decision_tree_clf, random_forest_clf, gradient_boosting_clf, xgboost_clf, lightgbm_clf, knn_clf, svm_clf
- Regression: linear_regression, ridge, lasso, elasticnet, decision_tree_reg, random_forest_reg, gradient_boosting_reg, xgboost_reg, lightgbm_reg, knn_reg, svm_reg
- All models include hyperparameter search grids for auto-tuning

---

## Step Functions State Machine (Pseudocode)

```
Input: { userId, projectId, jobId, targetColumn, modelType?, hyperparams? }

START
  → Lambda: profile_data
  → Lambda: etl_preprocess
  → Lambda: auto_select_model
  → ECS RunTask (Fargate): train model
  → Lambda: evaluate_model
  → Lambda: deploy_model
  → END

[Error handler at every step]
  → Update DynamoDB job status to FAILED
  → END
```

---

## UI/UX Decisions (from mockups)

**Design system:** Purple/navy color scheme, clean and professional. Persistent chat FAB (bottom-right) on every page for contextual help.

### User Flow
```
Upload/Select Data → Use Case Selection (templates or free-text) → Chatbot Problem Refinement
→ Data Profile + Feature Selection → Model Training (auto-config) → Cost Estimate (static) → Results
```

### Key Decisions

1. **One linear flow, not two modes.** The "dashboard" shown in mockups is the data profiling step — summary stats and visualizations shown after upload, before training. Not a separate analytics product.

2. **Data profile display:** Show row count, column types, null rates, basic histograms from `profile_data.py` output. No AI-generated KPI cards.

3. **Preloaded datasets:** Shown as a separate section on the upload page — "Upload your own" vs "Choose from sample datasets" as two distinct paths.

4. **Cost estimator:** Build as a static mockup page with hardcoded/placeholder values. Good for demo, not connected to real quotas. Shows compute hours, storage, tokens with pricing breakdown.

5. **"Reject and Modify":** Continues the chatbot conversation. User types what they want to change, chatbot updates the problem summary (Target, Time frame, Outcome).

6. **Data issues handling:** Auto-handle with sensible defaults, but show issues as informational (e.g., "We found 5% missing values in Feature 2 — we'll fill with median"). User can override strategy if they want.

7. **Feature selection:** Must-have. Users can toggle columns on/off before training. "Auto Feature Selection" uses correlation/variance thresholds to pre-select relevant features. Shown on the upload/profile page.

8. **Model selection:** No complexity slider. `auto_select_model` picks model + hyperparams based on data size (per architecture). Show the auto-selected config with an "Advanced" toggle for manual override (model type, train/test split, hyperparams).

### Page-by-Page Spec

| Page | Key Elements |
|---|---|
| **Upload (Page 1)** | Drag-drop CSV zone OR "Choose from sample datasets" section; data preview table (first 5 rows); data issues cards with auto-fix info + override option; "Analyse my data" CTA |
| **Use Case (Page 2)** | 3 template cards (Marketing, Propensity Modeling, Inventory Management) OR free-text input field for custom business problem |
| **Chatbot (Page 3)** | Split layout — chat on left, problem summary on right (Target, Time frame, Outcome); suggested columns from data; "Accept and Proceed" / "Reject and Modify" (continues chat) |
| **Data Profile** | Summary stats, histograms, column type badges; feature selection checkboxes with "Auto Feature Selection" toggle; target column selector |
| **Model Training (Page 5)** | Auto-selected model + config displayed; "Advanced" toggle reveals: model picker, train/test split, hyperparams; "Train Model" CTA |
| **Cost Estimate (Page 6)** | Static/placeholder — current package (FREE-TIER), quota bars (compute, storage, tokens), pricing breakdown, total estimated cost |
| **Results (Page 7)** | Business-language summary at top ("Which customers are likely to churn?"); KPI cards (count at risk, revenue impact, accuracy); top 3 feature importance cards with plain-English explanations; recommendations section (Bedrock-generated); prediction table; "Save Results" / "Retrain" buttons |
| **Dashboard** | Project list with status badges; each card shows project name, use case, status, last updated |

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
**Goal: AWS infrastructure up, basic API working, empty frontend shell**

- [ ] Initialize monorepo structure (all folders, package.json, requirements.txt)
- [ ] `infra/stacks/storage_stack.py` — S3 buckets + DynamoDB tables (projects, jobs, chats)
- [ ] `infra/stacks/auth_stack.py` — Cognito User Pool + App Client
- [ ] `infra/stacks/api_stack.py` — API Gateway + first Lambda (create_project)
- [ ] `backend/shared/` — db.py, s3_utils.py, models.py, config.py
- [ ] `backend/lambdas/api/create_project.py` + `list_projects.py` + `get_project.py`
- [ ] Seed preloaded Kaggle datasets to S3
- [ ] `frontend/` — Next.js scaffold, Cognito auth flow, dashboard page with API calls
- [ ] Verify: can sign up, log in, create a project, see it on dashboard

### Phase 2: Training Containers + Pipeline (Week 1–2)
**Goal: Can train a model end-to-end via Step Functions**

- [x] `containers/tabular-automl/` — Unified AutoML container (20 models, auto/single modes, CV, hyperparameter search)
- [ ] `scripts/build-containers.sh` — build + push to ECR
- [ ] `infra/stacks/pipeline_stack.py` — ECR, ECS cluster, Fargate task defs, Step Functions state machine
- [ ] `backend/lambdas/pipeline/auto_select_model.py`
- [ ] `backend/lambdas/pipeline/evaluate_model.py`
- [ ] `backend/lambdas/pipeline/deploy_model.py`
- [ ] Test: manually trigger Step Functions with a sample dataset → model appears in S3

### Phase 3: Data Pipelines + Chatbot (Week 2)
**Goal: Tabular ETL path works, chatbot helps frame problems**

- [ ] `backend/lambdas/pipeline/profile_data.py` — CSV profiling
- [ ] `backend/lambdas/pipeline/etl_preprocess.py` — imputation, encoding, scaling, split
- [ ] `backend/lambdas/api/get_upload_url.py` — S3 presigned URL generation
- [ ] `backend/lambdas/api/select_preloaded.py` — copy Kaggle dataset to user's project
- [ ] `backend/lambdas/api/chat.py` — Bedrock Claude Haiku chatbot
- [ ] Wire profiling + ETL into Step Functions
- [ ] Test: upload CSV → auto profile → preprocess → train → model ready
- [ ] Test: select preloaded dataset → same pipeline

### Phase 4: Inference + Full API (Week 2–3)
**Goal: Users can run predictions on trained models**

- [ ] `backend/lambdas/api/run_inference.py` — load model from S3, apply preprocessing pipeline, predict
- [ ] `backend/lambdas/api/get_job_status.py` — poll Step Functions execution
- [ ] `backend/lambdas/api/get_model_download.py` — presigned URL for model artifact
- [ ] `backend/lambdas/api/trigger_pipeline.py` — start Step Functions execution
- [ ] `backend/lambdas/api/interpret_results.py` — Bedrock Claude business recommendations
- [ ] Test: full API flow from create project → train → infer via curl/Postman

### Phase 5: Frontend (Week 1–3, parallel with backend)
**Goal: Full UI matching mockups (see UI/UX Decisions section above)**

- [ ] Auth pages (login, signup) with Cognito
- [ ] Dashboard (project list with status badges)
- [ ] Upload page (drag-drop CSV + preloaded dataset picker, data preview table, data issues with auto-fix info)
- [ ] Use case page (3 template cards + free-text business problem input)
- [ ] Chatbot page (split layout: chat left, problem summary right, accept/reject flow)
- [ ] Data profile page (summary stats, histograms, feature selection checkboxes, target column selector)
- [ ] Model training page (auto-selected config display, "Advanced" toggle for manual override)
- [ ] Cost estimator page (static/placeholder with quota bars and pricing breakdown)
- [ ] Results page (business-language summary, KPI cards, feature importance, Bedrock recommendations, prediction table)
- [ ] Inference page (tabular form input, prediction display)
- [ ] Persistent chat FAB on all pages

### Phase 6: Integration + Polish (Week 3–4)
**Goal: Everything works end-to-end, demo-ready**

- [ ] `infra/stacks/frontend_stack.py` — S3 bucket + CloudFront distribution
- [ ] `infra/stacks/monitoring_stack.py` — CloudWatch dashboards
- [ ] End-to-end testing
- [ ] Error handling and loading states across UI
- [ ] `scripts/deploy.sh` — one-command full deployment
- [ ] Demo preparation: rehearse live classifier build
- [ ] Final report + video presentation

---

## Environment Variables

### Backend Lambdas (set via CDK)
```
PROJECTS_TABLE=cloudforge-projects
JOBS_TABLE=cloudforge-jobs
CHATS_TABLE=cloudforge-chats
DATA_BUCKET=cloudforge-data-{account_id}
STEP_FUNCTION_ARN=arn:aws:states:...
ECS_CLUSTER=cloudforge-cluster
REGION=ap-southeast-1
```

### Frontend (.env.local)
```
NEXT_PUBLIC_API_URL=https://xxx.execute-api.ap-southeast-1.amazonaws.com/prod
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-southeast-1_xxxxx
NEXT_PUBLIC_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxx
NEXT_PUBLIC_COGNITO_REGION=ap-southeast-1
```

---

## Development Workflow

### Local development
```bash
# Frontend
cd frontend && npm install && npm run dev    # http://localhost:3000

# Backend (test Lambda locally)
cd backend && pip install -r requirements.txt
python -m pytest tests/backend/

# Containers (test training locally)
cd containers/tabular-automl
docker build -t cloudforge-training:tabular-automl .
docker run -e DATA_S3_PATH=... -e OUTPUT_S3_PATH=... -e TASK_TYPE=classification -e MODE=auto cloudforge-training:tabular-automl

# Infrastructure
cd infra && pip install -r requirements.txt
cdk synth    # preview CloudFormation
cdk deploy   # deploy to AWS
```

### Deployment
```bash
# Full deploy (run from repo root)
./scripts/deploy.sh

# This does:
# 1. cdk deploy --all
# 2. docker build + push containers to ECR
# 3. next build + next export → upload to S3
# 4. CloudFront invalidation
```

---

## Key Constraints & Assumptions

- **Budget: $50–100 total.** Use free tier wherever possible. Fargate spot for training.
- **Region: ap-southeast-1** (Singapore) — closest to NUS.
- **Dataset size limit: ~500 MB** per project (Lambda memory + processing time constraint).
- **No VPC, no NAT Gateway.** Fargate runs in default VPC public subnets. Keeps costs near zero for demo.
- **Tabular-only.** No image classification pipeline. Focus on CSV data (uploaded or preloaded Kaggle datasets).
- **Next.js static export only.** No SSR, no API routes. Pure SPA served from S3.
- **Cognito hosted UI is acceptable** for auth if custom forms take too long. Prioritize pipeline functionality over auth UX.
- **AI declaration required.** Per project spec, all AI-generated code/content must be explicitly declared in the final report.

---

## Out of Scope (for this submission)

- Real-time training progress streaming (WebSocket) — polling is sufficient
- Multi-region deployment
- Custom model code upload by users
- Model marketplace / sharing between users
- Payment integration (Stripe etc.) — pricing tiers are conceptual for the business model section
- Mobile-responsive design (desktop-first is fine for demo)
