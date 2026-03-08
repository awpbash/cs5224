import json
import logging
import os
import pickle
import tempfile

import boto3

from shared.db import get_latest_job
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
        project_id = event["pathParameters"]["id"]

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

        content_type = event.get("headers", {}).get("content-type", "")

        if "multipart/form-data" in content_type:
            return _handle_image_inference(event, job, model_path)
        else:
            return _handle_tabular_inference(event, job, model_path)

    except Exception as e:
        logger.exception("run_inference failed")
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": str(e)}),
        }


def _handle_tabular_inference(event, job, model_path: str) -> dict:
    body = json.loads(event.get("body", "{}"))
    features = body.get("features", {})

    with tempfile.NamedTemporaryFile(suffix=".pkl") as tmp:
        download_file(model_path, tmp.name)
        model = pickle.load(open(tmp.name, "rb"))

    import pandas as pd
    df = pd.DataFrame([features])
    prediction = model.predict(df)
    probabilities = []

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
            "confidence": round(float(max(proba)) if probabilities else 1.0, 4),
            "probabilities": probabilities,
        }),
    }


def _handle_image_inference(event, job, model_path: str) -> dict:
    import base64
    import io

    body = base64.b64decode(event.get("body", ""))

    with tempfile.NamedTemporaryFile(suffix=".pth") as tmp:
        download_file(model_path, tmp.name)

        import torch
        import torchvision.transforms as transforms
        from PIL import Image

        model = torch.load(tmp.name, map_location="cpu")
        model.eval()

        transform = transforms.Compose([
            transforms.Resize(256),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])

        image = Image.open(io.BytesIO(body)).convert("RGB")
        tensor = transform(image).unsqueeze(0)

        with torch.no_grad():
            outputs = model(tensor)
            proba = torch.nn.functional.softmax(outputs[0], dim=0)
            confidence, predicted = torch.max(proba, 0)

        metrics_path = job.get("metricsS3Path", "")
        class_labels = []
        if metrics_path:
            from shared.s3_utils import read_json
            metrics = read_json(metrics_path)
            class_labels = metrics.get("classLabels", [])

        pred_label = class_labels[predicted.item()] if class_labels else str(predicted.item())
        probabilities = [
            {"label": class_labels[i] if i < len(class_labels) else str(i), "probability": round(float(p), 4)}
            for i, p in enumerate(proba)
        ]

    return {
        "statusCode": 200,
        "headers": CORS_HEADERS,
        "body": json.dumps({
            "prediction": pred_label,
            "confidence": round(float(confidence.item()), 4),
            "probabilities": probabilities,
        }),
    }
