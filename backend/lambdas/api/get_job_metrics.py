import json
import logging

from shared.db import get_latest_job, get_project
from shared.s3_utils import read_json

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
}


def handler(event, context):
    try:
        user_id = event["requestContext"]["authorizer"]["claims"]["sub"]
        project_id = event["pathParameters"]["id"]

        # Verify user owns the project
        project = get_project(user_id, project_id)
        if not project:
            return {
                "statusCode": 404,
                "headers": CORS_HEADERS,
                "body": json.dumps({"error": "Project not found"}),
            }

        job = get_latest_job(project_id)
        if not job:
            return {
                "statusCode": 404,
                "headers": CORS_HEADERS,
                "body": json.dumps({"error": "No jobs found"}),
            }

        metrics = job.get("metrics")
        if not metrics and job.get("metricsS3Path"):
            metrics = read_json(job["metricsS3Path"])

        if not metrics:
            return {
                "statusCode": 404,
                "headers": CORS_HEADERS,
                "body": json.dumps({"error": "No metrics available yet"}),
            }

        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps(metrics),
        }
    except Exception as e:
        logger.exception("get_job_metrics failed")
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": "Internal server error"}),
        }
