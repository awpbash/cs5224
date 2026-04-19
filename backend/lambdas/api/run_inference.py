import json
import logging
import os
import pickle
import tempfile

import boto3
import numpy as np
import pandas as pd

from shared.db import get_latest_job, get_job, get_project
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

        # Load the trained model
        with tempfile.NamedTemporaryFile(suffix=".pkl") as tmp:
            download_file(model_path, tmp.name)
            with open(tmp.name, "rb") as f:
                model = pickle.load(f)

        # Load the preprocessing pipeline if available
        pipeline_key = f"{user_id}/{project_id}/processed/pipeline.pkl"
        pipeline = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".pkl") as tmp:
                download_file(pipeline_key, tmp.name)
                with open(tmp.name, "rb") as f:
                    pipeline = pickle.load(f)
        except Exception:
            logger.warning("No pipeline.pkl found, using raw features")

        # Build input DataFrame
        df = pd.DataFrame([features])

        if pipeline:
            scaler = pipeline.get("scaler")
            label_encoders = pipeline.get("label_encoders", {})
            feature_columns = pipeline.get("feature_columns", [])

            # Apply label encoding to categorical columns
            for col, mapping in label_encoders.items():
                if col in df.columns:
                    val = str(df[col].iloc[0])
                    if isinstance(mapping, dict):
                        # New format: {category: index}
                        df[col] = mapping.get(val, 0)
                    elif isinstance(mapping, list):
                        # Legacy format: [category, category, ...]
                        df[col] = mapping.index(val) if val in mapping else 0
                    else:
                        df[col] = 0

            # Convert all feature columns to numeric
            for col in feature_columns:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

            # Ensure correct column order and fill missing columns with 0
            for col in feature_columns:
                if col not in df.columns:
                    df[col] = 0
            df = df[feature_columns]

            # Apply scaler
            if scaler is not None:
                df[feature_columns] = scaler.transform(df[feature_columns])

        prediction = model.predict(df)
        probabilities = []
        proba = None

        is_regression = pipeline.get("is_regression", False) if pipeline else False

        if hasattr(model, "predict_proba") and not is_regression:
            try:
                proba = model.predict_proba(df)[0]
                classes = model.classes_

                # Map encoded class labels back to original names
                class_labels = pipeline.get("class_labels", []) if pipeline else []
                probabilities = []
                for c, p in zip(classes, proba):
                    label = class_labels[int(c)] if class_labels and int(c) < len(class_labels) else str(c)
                    probabilities.append({"label": label, "probability": round(float(p), 4)})
            except Exception:
                proba = None  # Some models don't support predict_proba

        # Map prediction back to original label for classification
        pred_value = prediction[0]
        if not is_regression and pipeline and pipeline.get("class_labels"):
            class_labels = pipeline["class_labels"]
            idx = int(pred_value)
            if 0 <= idx < len(class_labels):
                pred_value = class_labels[idx]

        # Confidence: use max probability for classification, omit for regression
        if proba is not None:
            confidence = round(float(max(proba)), 4)
        elif is_regression:
            confidence = None  # no meaningful confidence for regression
        else:
            confidence = None

        result = {
            "prediction": str(pred_value),
            "probabilities": probabilities,
        }
        if confidence is not None:
            result["confidence"] = confidence

        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps(result),
        }
    except Exception as e:
        logger.exception("run_inference failed")
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": "Internal server error"}),
        }
