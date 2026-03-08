import json
import logging

import boto3

from shared.config import DATA_BUCKET
from shared.db import update_job

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")


def handler(event, context):
    project_id = event["projectId"]
    job_id = event["jobId"]
    user_id = event["userId"]
    model_type = event.get("modelType", "unknown")
    is_regression = event.get("isRegression", False)

    metrics_key = f"{user_id}/{project_id}/{job_id}/metrics.json"

    try:
        resp = s3.get_object(Bucket=DATA_BUCKET, Key=metrics_key)
        metrics = json.loads(resp["Body"].read().decode("utf-8"))
    except Exception:
        logger.warning("No metrics.json found at %s", metrics_key)
        metrics = {}

    # Extract feature importance (train.py saves it inside metrics)
    feature_importance = metrics.get("featureImportance", [])

    job_update = {
        "status": "EVALUATING",
        "currentStep": "evaluation",
        "metrics": metrics,
        "metricsS3Path": metrics_key,
        "modelArtifactS3Path": f"{user_id}/{project_id}/{job_id}/model.pkl",
        "modelType": metrics.get("modelType", model_type),
        "isRegression": is_regression,
    }

    if feature_importance:
        job_update["featureImportance"] = feature_importance

    # Save training duration if available
    if metrics.get("trainingDurationSec"):
        job_update["trainingDurationSec"] = metrics["trainingDurationSec"]

    update_job(project_id, job_id, job_update)

    return {**event, "metrics": metrics}
