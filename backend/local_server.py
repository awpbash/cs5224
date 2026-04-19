"""
Local development server that wraps Lambda handlers with Flask + moto mocks.
Run: python local_server.py
"""
import json
import logging
import os
import sys

logger = logging.getLogger(__name__)

# --- Load .env FIRST ---
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# --- Start moto mocks BEFORE importing shared modules ---
import boto3
from moto import mock_aws

mock = mock_aws()
mock.start()

# Create mock resources
dynamodb = boto3.resource("dynamodb", region_name="ap-southeast-1")
s3 = boto3.client("s3", region_name="ap-southeast-1")

# Create DynamoDB tables
dynamodb.create_table(
    TableName="cloudforge-projects",
    KeySchema=[
        {"AttributeName": "userId", "KeyType": "HASH"},
        {"AttributeName": "projectId", "KeyType": "RANGE"},
    ],
    AttributeDefinitions=[
        {"AttributeName": "userId", "AttributeType": "S"},
        {"AttributeName": "projectId", "AttributeType": "S"},
    ],
    BillingMode="PAY_PER_REQUEST",
)

dynamodb.create_table(
    TableName="cloudforge-jobs",
    KeySchema=[
        {"AttributeName": "projectId", "KeyType": "HASH"},
        {"AttributeName": "jobId", "KeyType": "RANGE"},
    ],
    AttributeDefinitions=[
        {"AttributeName": "projectId", "AttributeType": "S"},
        {"AttributeName": "jobId", "AttributeType": "S"},
    ],
    BillingMode="PAY_PER_REQUEST",
)

# Create S3 bucket
s3.create_bucket(
    Bucket="cloudforge-data-local",
    CreateBucketConfiguration={"LocationConstraint": "ap-southeast-1"},
)

# --- Now add backend to path and import modules ---
sys.path.insert(0, os.path.dirname(__file__))

from flask import Flask, request, jsonify
from flask_cors import CORS

# Import Lambda handlers
from lambdas.api.create_project import handler as create_project_handler
from lambdas.api.list_projects import handler as list_projects_handler
from lambdas.api.get_project import handler as get_project_handler
from lambdas.api.get_upload_url import handler as get_upload_url_handler
from lambdas.api.get_job_status import handler as get_job_status_handler
from lambdas.api.get_job_metrics import handler as get_job_metrics_handler
from lambdas.pipeline.profile_data import handler as profile_data_handler
from lambdas.pipeline.etl_preprocess import handler as etl_preprocess_handler
from lambdas.pipeline.auto_select_model import handler as auto_select_model_handler
from lambdas.pipeline.evaluate_model import handler as evaluate_model_handler
from lambdas.pipeline.deploy_model import handler as deploy_model_handler
from lambdas.api.chat import handler as chat_handler
from lambdas.api.interpret_results import handler as interpret_handler

app = Flask(__name__)
CORS(app)

# Fake user ID for local dev (no Cognito)
LOCAL_USER_ID = "local-dev-user"


def make_api_event(body=None, path_params=None, query_params=None):
    """Build a Lambda API Gateway proxy event from Flask request."""
    return {
        "requestContext": {
            "authorizer": {
                "claims": {"sub": LOCAL_USER_ID}
            }
        },
        "body": json.dumps(body) if body else "{}",
        "pathParameters": path_params or {},
        "queryStringParameters": query_params or {},
        "headers": dict(request.headers),
    }


def lambda_response(result):
    """Convert Lambda response dict to Flask response."""
    body = json.loads(result.get("body", "{}"))
    return jsonify(body), result.get("statusCode", 200)


# ==================== API Routes ====================

@app.route("/projects", methods=["POST"])
def create_project():
    event = make_api_event(body=request.get_json(force=True))
    return lambda_response(create_project_handler(event, None))


@app.route("/projects", methods=["GET"])
def list_projects():
    event = make_api_event()
    return lambda_response(list_projects_handler(event, None))


@app.route("/projects/<project_id>", methods=["GET"])
def get_project(project_id):
    event = make_api_event(path_params={"id": project_id})
    return lambda_response(get_project_handler(event, None))


@app.route("/projects/<project_id>", methods=["PATCH"])
def update_project_route(project_id):
    from shared.db import get_project, update_project
    project = get_project(LOCAL_USER_ID, project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404
    body = request.get_json(force=True)
    # Only allow updating specific fields
    allowed = {"targetColumn", "selectedFeatures", "taskType", "useCase", "status", "suggestedConfig"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if updates:
        update_project(LOCAL_USER_ID, project_id, updates)
    # Return updated project
    updated = get_project(LOCAL_USER_ID, project_id)
    return jsonify(updated)


@app.route("/projects/<project_id>/recompute-profile", methods=["POST"])
def recompute_profile(project_id):
    """Recompute correlation/PCA for a given target + features selection."""
    import tempfile
    import numpy as np
    import pandas as pd

    from shared.db import get_project as _get_proj

    project = _get_proj(LOCAL_USER_ID, project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    dataset_path = project.get("datasetS3Path")
    if not dataset_path:
        return jsonify({"error": "No dataset uploaded"}), 400

    body = request.get_json(force=True)
    target_col = body.get("targetColumn") or project.get("targetColumn")
    selected_features = body.get("selectedFeatures")

    # Download CSV
    s3_client = boto3.client("s3", region_name="ap-southeast-1")
    tmp = tempfile.mktemp(suffix=".csv")
    s3_client.download_file("cloudforge-data-local", dataset_path, tmp)
    df = pd.read_csv(tmp)
    os.remove(tmp)

    if not target_col or target_col not in df.columns:
        target_col = df.columns[-1]

    # Filter to selected features + target
    if selected_features:
        valid = [f for f in selected_features if f in df.columns and f != target_col]
        if valid:
            df = df[valid + [target_col]]

    result = {}

    # Correlation with target
    try:
        numeric_cols = df.select_dtypes(include=["number"]).columns.tolist()
        if target_col in numeric_cols and len(numeric_cols) > 1:
            corr = df[numeric_cols].corr()
            # Full correlation matrix
            correlation = {
                col: {
                    other: round(float(corr.loc[col, other]), 4)
                    for other in numeric_cols if other != col
                }
                for col in numeric_cols[:10]
            }
            result["correlation"] = correlation
    except Exception:
        pass

    # PCA
    try:
        from sklearn.decomposition import PCA
        from sklearn.preprocessing import StandardScaler

        numeric_df = df.select_dtypes(include=["number"]).dropna()
        if numeric_df.shape[1] >= 2 and numeric_df.shape[0] >= 10:
            n_components = min(numeric_df.shape[1], 10)
            scaled = StandardScaler().fit_transform(numeric_df)
            pca = PCA(n_components=n_components)
            pca.fit(scaled)
            result["pca"] = {
                "varianceExplained": [round(float(v), 4) for v in pca.explained_variance_ratio_],
                "cumulativeVariance": [round(float(v), 4) for v in np.cumsum(pca.explained_variance_ratio_)],
                "components": n_components,
                "featureNames": numeric_df.columns.tolist(),
                "loadings": [
                    {
                        "pc": i + 1,
                        "topFeatures": [
                            {"feature": numeric_df.columns[j], "loading": round(float(pca.components_[i][j]), 4)}
                            for j in np.argsort(np.abs(pca.components_[i]))[::-1][:5]
                        ],
                    }
                    for i in range(min(2, n_components))
                ],
            }
    except Exception:
        pass

    # Class balance / target distribution
    try:
        if pd.api.types.is_numeric_dtype(df[target_col]) and df[target_col].nunique() > 20:
            counts, edges = np.histogram(df[target_col].dropna(), bins=20)
            result["targetDistribution"] = {
                "type": "numeric",
                "column": target_col,
                "histogram": [
                    {"bin": f"{edges[i]:.1f}-{edges[i+1]:.1f}", "count": int(counts[i])}
                    for i in range(len(counts))
                ],
            }
            result["classBalance"] = []
        elif df[target_col].nunique() <= 20:
            vc = df[target_col].value_counts()
            result["classBalance"] = [
                {"label": str(v), "count": int(c)} for v, c in vc.items()
            ]
            result["targetDistribution"] = {}
    except Exception:
        pass

    return jsonify(result)


@app.route("/projects/<project_id>/upload-url", methods=["POST"])
def get_upload_url(project_id):
    event = make_api_event(
        body=request.get_json(force=True),
        path_params={"id": project_id},
    )
    return lambda_response(get_upload_url_handler(event, None))


@app.route("/projects/<project_id>/jobs/<job_id>", methods=["GET"])
def get_job_status(project_id, job_id):
    event = make_api_event(path_params={"id": project_id, "jobId": job_id})
    return lambda_response(get_job_status_handler(event, None))


@app.route("/projects/<project_id>/jobs/<job_id>/metrics", methods=["GET"])
def get_job_metrics(project_id, job_id):
    event = make_api_event(path_params={"id": project_id, "jobId": job_id})
    return lambda_response(get_job_metrics_handler(event, None))


# ==================== Upload CSV directly (local only) ====================

@app.route("/projects/<project_id>/upload", methods=["POST"])
def upload_csv(project_id):
    """Local-only: upload CSV directly to mocked S3 (no presigned URL needed)."""
    from shared.db import get_project, update_project

    project = get_project(LOCAL_USER_ID, project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    file = request.files.get("file")
    if not file:
        return jsonify({"error": "No file provided"}), 400

    filename = file.filename or "dataset.csv"
    s3_key = f"{LOCAL_USER_ID}/{project_id}/raw/{filename}"

    s3_client = boto3.client("s3", region_name="ap-southeast-1")
    s3_client.put_object(
        Bucket="cloudforge-data-local",
        Key=s3_key,
        Body=file.read(),
        ContentType="text/csv",
    )

    update_project(LOCAL_USER_ID, project_id, {
        "dataSource": "uploaded",
        "datasetS3Path": s3_key,
        "status": "DATA_UPLOADED",
    })

    # Auto-profile the uploaded data
    try:
        profile_event = {
            "userId": LOCAL_USER_ID,
            "projectId": project_id,
            "datasetS3Path": s3_key,
        }
        profile_result = profile_data_handler(profile_event, None)
        return jsonify({"s3Key": s3_key, "status": "DATA_UPLOADED", "dataProfile": profile_result.get("dataProfile")})
    except Exception as e:
        print(f"  [auto-profile] warning: {e}")
        return jsonify({"s3Key": s3_key, "status": "DATA_UPLOADED"})


@app.route("/projects/<project_id>/select-preloaded", methods=["POST"])
def select_preloaded(project_id):
    """Select a preloaded dataset: copy it to S3, profile it, update project."""
    from shared.db import get_project, update_project

    project = get_project(LOCAL_USER_ID, project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    body = request.get_json(force=True)
    dataset_id = body.get("datasetId", "")

    # Map dataset IDs to local CSV files
    test_data_dir = os.path.join(os.path.dirname(__file__), "test_data")
    dataset_files = {
        "retail-churn": os.path.join(test_data_dir, "sample_churn.csv"),
        "supermarket-sales": os.path.join(test_data_dir, "sample_supermarket_sales.csv"),
        "customer-segmentation": os.path.join(test_data_dir, "sample_mall_customers.csv"),
        "store-demand": os.path.join(test_data_dir, "sample_store_demand.csv"),
    }

    csv_path = dataset_files.get(dataset_id)
    if not csv_path or not os.path.exists(csv_path):
        return jsonify({"error": f"Dataset '{dataset_id}' not found"}), 404

    # Upload to mocked S3
    filename = os.path.basename(csv_path)
    s3_key = f"{LOCAL_USER_ID}/{project_id}/raw/{filename}"
    s3_client = boto3.client("s3", region_name="ap-southeast-1")
    with open(csv_path, "rb") as f:
        s3_client.put_object(
            Bucket="cloudforge-data-local",
            Key=s3_key,
            Body=f.read(),
            ContentType="text/csv",
        )

    update_project(LOCAL_USER_ID, project_id, {
        "dataSource": "preloaded",
        "preloadedDataset": dataset_id,
        "datasetS3Path": s3_key,
        "status": "DATA_UPLOADED",
    })

    # Auto-profile
    try:
        profile_event = {
            "userId": LOCAL_USER_ID,
            "projectId": project_id,
            "datasetS3Path": s3_key,
        }
        profile_result = profile_data_handler(profile_event, None)
        return jsonify({
            "s3Key": s3_key,
            "status": "DATA_UPLOADED",
            "dataProfile": profile_result.get("dataProfile"),
        })
    except Exception as e:
        print(f"  [auto-profile] warning: {e}")
        return jsonify({"s3Key": s3_key, "status": "DATA_UPLOADED"})


# ==================== Pipeline Routes (local orchestration) ====================

@app.route("/projects/<project_id>/train", methods=["POST"])
def train_pipeline(project_id):
    """
    Run the full training pipeline locally (synchronous).
    Replaces Step Functions + Fargate with direct Python execution.
    """
    import uuid
    import traceback
    from datetime import datetime
    from shared.db import get_project, put_job, update_job

    project = get_project(LOCAL_USER_ID, project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    dataset_path = project.get("datasetS3Path")
    if not dataset_path:
        return jsonify({"error": "No dataset uploaded"}), 400

    job_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    body = request.get_json(force=True) if request.data else {}

    job = {
        "projectId": project_id,
        "jobId": job_id,
        "userId": LOCAL_USER_ID,
        "status": "STARTING",
        "currentStep": "starting",
        "createdAt": now,
    }
    put_job(job)

    pipeline_event = {
        "userId": LOCAL_USER_ID,
        "projectId": project_id,
        "jobId": job_id,
        "taskType": project.get("taskType", "classification"),
        "dataSource": project.get("dataSource", "uploaded"),
        "datasetS3Path": dataset_path,
        "targetColumn": project.get("targetColumn"),
        "selectedFeatures": project.get("selectedFeatures"),
        "classLabels": project.get("classLabels", []),
        "hyperparameters": body.get("hyperparameters", {}),
        "trainSplit": body.get("trainSplit", 0.8),
        "cvFolds": body.get("cvFolds", 5),
        "selectedModels": body.get("selectedModels"),
        "modelType": body.get("modelType"),
    }

    steps = [
        ("profiling", profile_data_handler),
        ("preprocessing", etl_preprocess_handler),
        ("model_selection", auto_select_model_handler),
        ("training", _run_local_training),
        ("evaluation", evaluate_model_handler),
        ("deployment", deploy_model_handler),
    ]

    try:
        for step_name, step_fn in steps:
            update_job(project_id, job_id, {
                "currentStep": step_name,
                "status": "RUNNING",
            })
            print(f"  [{step_name}] running...")
            pipeline_event = step_fn(pipeline_event, None)
            print(f"  [{step_name}] done.")

        return jsonify({
            "jobId": job_id,
            "status": "COMPLETED",
            "message": "Pipeline completed successfully",
        })

    except Exception as e:
        traceback.print_exc()
        update_job(project_id, job_id, {
            "status": "FAILED",
            "error": {"message": str(e)},
        })
        return jsonify({
            "jobId": job_id,
            "status": "FAILED",
            "error": str(e),
        }), 500


def _run_local_training(event, context):
    """
    Run the AutoML training container logic directly (no Docker needed).
    Imports train.py from containers/tabular-automl/.
    """
    import importlib.util

    user_id = event["userId"]
    project_id = event["projectId"]
    job_id = event["jobId"]
    task_type = event["taskType"]
    bucket = "cloudforge-data-local"

    is_regression = event.get("isRegression", False)

    # Set env vars that the training container expects (s3:// URI format)
    os.environ["DATA_S3_PATH"] = f"s3://{bucket}/{user_id}/{project_id}/processed/"
    os.environ["OUTPUT_S3_PATH"] = f"s3://{bucket}/{user_id}/{project_id}/{job_id}/"
    os.environ["TASK_TYPE"] = "regression" if is_regression else "classification"
    cv_folds = str(event.get("cvFolds", 5))
    os.environ["CV_FOLDS"] = cv_folds

    # Train/test split ratio
    train_split = event.get("trainSplit", 0.8)
    os.environ["TRAIN_SPLIT"] = str(train_split)

    # Model selection: auto, single, or multi
    candidate_models = event.get("candidateModels")
    model_type = event.get("modelType")
    if candidate_models and len(candidate_models) > 1:
        os.environ["MODE"] = "auto"
        os.environ["CANDIDATE_MODELS"] = ",".join(candidate_models)
        os.environ["MAX_CANDIDATES"] = str(len(candidate_models))
    elif model_type:
        os.environ["MODE"] = "single"
        os.environ["MODEL_TYPE"] = model_type
        os.environ["MAX_CANDIDATES"] = "1"
        os.environ.pop("CANDIDATE_MODELS", None)
    else:
        os.environ["MODE"] = "auto"
        os.environ["MAX_CANDIDATES"] = "5"
        os.environ.pop("CANDIDATE_MODELS", None)

    # Add containers dir to path so train.py can import models.py
    container_dir = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "containers", "tabular-automl"))
    if container_dir not in sys.path:
        sys.path.insert(0, container_dir)

    train_path = os.path.join(container_dir, "train.py")
    if not os.path.exists(train_path):
        raise FileNotFoundError(f"Training script not found: {train_path}")

    spec = importlib.util.spec_from_file_location("train_module", train_path)
    train_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(train_module)

    if hasattr(train_module, "main"):
        train_module.main()

    return {**event, "trainingComplete": True}


# ==================== Chatbot ====================

@app.route("/chat", methods=["POST"])
def chat():
    from flask import Response, stream_with_context
    from openai import OpenAI
    from lambdas.api.chat import _sessions, _extract_config, _build_data_context, SYSTEM_PROMPT

    body = request.get_json(force=True)
    stream = body.get("stream", False)

    if not stream:
        event = make_api_event(body=body)
        return lambda_response(chat_handler(event, None))

    # --- Streaming path ---
    import uuid
    message = body.get("message", "")
    session_id = body.get("sessionId") or str(uuid.uuid4())
    project_id = body.get("projectId", "")

    if session_id not in _sessions:
        _sessions[session_id] = []
    if message:
        _sessions[session_id].append({"role": "user", "content": message})

    system_content = SYSTEM_PROMPT
    if project_id:
        data_context = _build_data_context(project_id, LOCAL_USER_ID)
        if data_context:
            system_content += data_context

    openai_messages = [{"role": "system", "content": system_content}]
    openai_messages.extend(_sessions[session_id])

    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))

    def generate():
        full_reply = ""
        try:
            stream_resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=openai_messages,
                temperature=0.5,
                max_tokens=1024,
                stream=True,
            )
            for chunk in stream_resp:
                delta = chunk.choices[0].delta
                if delta.content:
                    full_reply += delta.content
                    yield f"data: {json.dumps({'token': delta.content})}\n\n"

            _sessions[session_id].append({"role": "assistant", "content": full_reply})
            suggested_config = _extract_config(full_reply)
            yield f"data: {json.dumps({'done': True, 'sessionId': session_id, 'suggestedConfig': suggested_config})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
        },
    )


@app.route("/projects/<project_id>/interpret", methods=["POST"])
@app.route("/projects/<project_id>/jobs/<job_id>/interpret", methods=["POST"])
def interpret_results(project_id, job_id=None):
    event = make_api_event(
        body=request.get_json(force=True) if request.data else {},
        path_params={"id": project_id, "jobId": job_id or ""},
    )
    return lambda_response(interpret_handler(event, None))


# ==================== Inference ====================

@app.route("/projects/<project_id>/infer", methods=["POST"])
def run_inference(project_id):
    """Run inference on a trained model."""
    from lambdas.api.run_inference import handler as inference_handler

    event = make_api_event(
        body=request.get_json(force=True),
        path_params={"id": project_id},
    )
    return lambda_response(inference_handler(event, None))


# ==================== Results Chat ====================

@app.route("/projects/<project_id>/results-chat", methods=["POST"])
def results_chat(project_id):
    """Chat about training results - business-focused Q&A."""
    from openai import OpenAI
    from shared.db import get_project, get_job

    body = request.get_json(force=True)
    message = body.get("message", "")
    history = body.get("history", [])

    # Get project + job data for context
    project = get_project(LOCAL_USER_ID, project_id)
    job = None
    if project:
        job_id_val = project.get("latestJobId")
        if job_id_val:
            job = get_job(project_id, job_id_val)

    system_prompt = """You are RetailMind's Business Analyst AI, specializing in interpreting ML results for retail SMEs.

You have access to the training results and data profile. Help the user understand:
- What the model metrics mean in business terms
- Which features drive predictions and why
- Actionable next steps based on the results
- Data quality observations
- How to improve model performance

Be conversational, concise, and business-focused. Avoid ML jargon unless asked.
Use bullet points and bold text for key insights. Keep responses to 3-5 sentences unless asked for detail."""

    if project:
        system_prompt += f"\n\n--- PROJECT CONTEXT ---"
        system_prompt += f"\nProject: {project.get('projectName', 'Untitled')}"
        system_prompt += f"\nUse Case: {project.get('useCase', 'custom')}"
        system_prompt += f"\nTask Type: {project.get('taskType', 'classification')}"
        system_prompt += f"\nTarget: {project.get('targetColumn', 'unknown')}"
        if project.get("dataProfile"):
            dp = project["dataProfile"]
            system_prompt += f"\nDataset: {dp.get('rowCount', '?')} rows, {dp.get('columnCount', '?')} columns"
            col_names = [c["name"] for c in dp.get("columns", [])]
            system_prompt += f"\nColumns: {', '.join(col_names)}"

    if job:
        system_prompt += f"\n\n--- MODEL RESULTS ---"
        system_prompt += f"\nModel: {job.get('modelType', 'unknown')}"
        system_prompt += f"\nStatus: {job.get('status', 'unknown')}"
        if job.get("metrics"):
            system_prompt += f"\nMetrics: {json.dumps(job['metrics'], indent=2)}"
        if job.get("featureImportance"):
            system_prompt += f"\nFeature Importance: {json.dumps(job['featureImportance'], indent=2)}"
        if job.get("trainingDurationSec"):
            system_prompt += f"\nTraining Duration: {job['trainingDurationSec']}s"

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(history)
    messages.append({"role": "user", "content": message})

    try:
        client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.6,
            max_tokens=800,
        )
        reply = response.choices[0].message.content
        return jsonify({"reply": reply})
    except Exception as e:
        logger.exception("results-chat failed")
        return jsonify({"error": str(e)}), 500


# ==================== Health Check ====================

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "mode": "local-dev", "user": LOCAL_USER_ID})


if __name__ == "__main__":
    print("=" * 60)
    print("  RetailMind Local Dev Server")
    print("  Mocked AWS: DynamoDB, S3 (via moto)")
    print("  User ID: local-dev-user")
    print("=" * 60)
    print()
    print("Endpoints:")
    print("  GET    /health")
    print("  POST   /projects                    Create project")
    print("  GET    /projects                    List projects")
    print("  GET    /projects/<id>               Get project")
    print("  POST   /projects/<id>/upload        Upload CSV (local)")
    print("  POST   /projects/<id>/select-preloaded  Select preloaded dataset")
    print("  POST   /projects/<id>/upload-url    Get presigned URL")
    print("  POST   /projects/<id>/train         Run full pipeline")
    print("  GET    /projects/<id>/jobs/<jid>     Get job status")
    print("  POST   /projects/<id>/infer         Run inference")
    print("  POST   /chat                         Chatbot (GPT-4o-mini)")
    print("  POST   /projects/<id>/interpret      Interpret results (GPT-4o-mini)")
    print("  POST   /projects/<id>/results-chat  Results Q&A chatbot (GPT-4o-mini)")
    print()
    app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=False)
