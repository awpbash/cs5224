import json
import logging

from shared.db import get_job
from shared.s3_utils import generate_presigned_download_url

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
}


def handler(event, context):
    try:
        project_id = event["pathParameters"]["id"]
        job_id = event["pathParameters"]["jobId"]

        job = get_job(project_id, job_id)
        if not job:
            return {
                "statusCode": 404,
                "headers": CORS_HEADERS,
                "body": json.dumps({"error": "Job not found"}),
            }

        model_path = job.get("modelArtifactS3Path")
        if not model_path:
            return {
                "statusCode": 400,
                "headers": CORS_HEADERS,
                "body": json.dumps({"error": "No model artifact available"}),
            }

        url = generate_presigned_download_url(model_path)

        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps({"downloadUrl": url}),
        }
    except Exception as e:
        logger.exception("get_model_download failed")
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": str(e)}),
        }
