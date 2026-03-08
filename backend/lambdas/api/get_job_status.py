import json
import logging

from shared.db import get_job

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
                "failureReason": job.get("error"),
            }),
        }
    except Exception as e:
        logger.exception("get_job_status failed")
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": str(e)}),
        }
