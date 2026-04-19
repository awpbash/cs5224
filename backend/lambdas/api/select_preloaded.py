import json
import logging
import os

import boto3

from shared.db import get_project, update_project
from shared.config import DATA_BUCKET

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
}

PRELOADED_DATASETS = {
    "retail-churn", "supermarket-sales", "customer-segmentation", "store-demand",
}


def handler(event, context):
    try:
        user_id = event["requestContext"]["authorizer"]["claims"]["sub"]
        project_id = event["pathParameters"]["id"]
        body = json.loads(event.get("body", "{}"))
        dataset_id = body.get("datasetId", "")

        if dataset_id not in PRELOADED_DATASETS:
            return {"statusCode": 404, "headers": CORS_HEADERS,
                    "body": json.dumps({"error": f"Dataset '{dataset_id}' not found"})}

        project = get_project(user_id, project_id)
        if not project:
            return {"statusCode": 404, "headers": CORS_HEADERS,
                    "body": json.dumps({"error": "Project not found"})}

        # Copy from preloaded/ to user's project path
        src_key = f"preloaded/{dataset_id}.csv"
        dst_key = f"{user_id}/{project_id}/raw/{dataset_id}.csv"

        s3.copy_object(
            Bucket=DATA_BUCKET,
            CopySource={"Bucket": DATA_BUCKET, "Key": src_key},
            Key=dst_key,
        )

        update_project(user_id, project_id, {
            "dataSource": "preloaded",
            "preloadedDataset": dataset_id,
            "datasetS3Path": dst_key,
            "status": "DATA_UPLOADED",
        })

        updated = get_project(user_id, project_id)
        return {"statusCode": 200, "headers": CORS_HEADERS,
                "body": json.dumps(updated)}
    except Exception as e:
        logger.exception("select_preloaded failed")
        return {"statusCode": 500, "headers": CORS_HEADERS,
                "body": json.dumps({"error": "Internal server error"})}
