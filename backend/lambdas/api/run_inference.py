import json
import logging
import os
import pickle
import tempfile

import boto3

from shared.db import get_latest_job, get_job
from shared.s3_utils import download_file

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")
DATA_BUCKET = os.environ["DATA_BUCKET"]

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
}


def handler(event, context):
    try:
        user_id = event["requestContext"]["authorizer"]["claims"]["sub"]
        project_id = event["pathParameters"]["id"]
        job_id = event["pathParameters"].get("jobId")

        # Validate user owns the project
        from shared.db import get_project
        project = get_project(user_id, project_id)
        if not project:
            return {"statusCode": 404, "headers": CORS_HEADERS,
                    "body": json.dumps({"error": "Project not found"})}

        if job_id:
            job = get_job(project_id, job_id)
        else:
            job = get_latest_job(project_id)

        if not job or job["status"] != "COMPLETED":
            return {
                "statusCode": 400,
                "headers": CORS_HEADERS,
                "body": json.dumps({"error": "No completed model available"}),
            }

        model_path = job.get("modelArtifactS3Path")
        if not model_path:
            return {
                "statusCode": 400,
                "headers": CORS_HEADERS,
                "body": json.dumps({"error": "No model artifact found"}),
            }

        body = json.loads(event.get("body", "{}"))
        features = body.get("features", {})

        with tempfile.NamedTemporaryFile(suffix=".pkl") as tmp:
            download_file(model_path, tmp.name)
            with open(tmp.name, "rb") as f:
                model = pickle.load(f)

        import pandas as pd
        df = pd.DataFrame([features])
        prediction = model.predict(df)
        probabilities = []
        proba = None

        if hasattr(model, "predict_proba"):
            proba = model.predict_proba(df)[0]
            classes = model.classes_
            probabilities = [
                {"label": str(c), "probability": round(float(p), 4)}
                for c, p in zip(classes, proba)
            ]

        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps({
                "prediction": str(prediction[0]),
                "confidence": round(float(max(proba)) if proba is not None else 1.0, 4),
                "probabilities": probabilities,
            }),
        }
    except Exception as e:
        logger.exception("run_inference failed")
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": str(e)}),
        }
