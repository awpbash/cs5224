import json
import logging

from shared.db import get_job, get_project

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
        job_id = event["pathParameters"]["jobId"]

        project = get_project(user_id, project_id)
        if not project:
            return {
                "statusCode": 404,
                "headers": CORS_HEADERS,
                "body": json.dumps({"error": "Project not found"}),
            }

        job = get_job(project_id, job_id)
        if not job:
            return {
                "statusCode": 404,
                "headers": CORS_HEADERS,
                "body": json.dumps({"error": "Job not found"}),
            }

        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps({
                "jobId": job["jobId"],
                "projectId": job["projectId"],
                "userId": job.get("userId", ""),
                "status": job["status"],
                "currentStep": job.get("currentStep"),
                "modelType": job.get("modelType"),
                "hyperparameters": job.get("hyperparameters", {}),
                "metrics": job.get("metrics"),
                "featureImportance": job.get("featureImportance"),
                "confusionMatrix": job.get("confusionMatrix"),
                "modelS3Key": job.get("modelArtifactS3Path"),
                "trainingDurationSec": job.get("trainingDurationSec"),
                "isRegression": job.get("isRegression", False),
                "createdAt": job["createdAt"],
                "completedAt": job.get("completedAt"),
                "failureReason": job.get("failureReason") or job.get("error"),
            }),
        }
    except Exception as e:
        logger.exception("get_job_status failed")
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": "Internal server error"}),
        }
