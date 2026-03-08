import json
import logging
import os
import uuid
from datetime import datetime

import boto3

from shared.db import get_project, put_job, update_project

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

sfn = boto3.client("stepfunctions")
STEP_FUNCTION_ARN = os.environ["STEP_FUNCTION_ARN"]

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
}


def handler(event, context):
    try:
        user_id = event["requestContext"]["authorizer"]["claims"]["sub"]
        project_id = event["pathParameters"]["id"]
        body = json.loads(event.get("body", "{}"))

        project = get_project(user_id, project_id)
        if not project:
            return {
                "statusCode": 404,
                "headers": CORS_HEADERS,
                "body": json.dumps({"error": "Project not found"}),
            }

        job_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()

        sfn_input = {
            "userId": user_id,
            "projectId": project_id,
            "jobId": job_id,
            "taskType": project["taskType"],
            "dataSource": project.get("dataSource", "uploaded"),
            "datasetS3Path": project.get("datasetS3Path", ""),
            "classLabels": project.get("classLabels", []),
            "hyperparameters": body.get("hyperparameters", {}),
        }

        execution = sfn.start_execution(
            stateMachineArn=STEP_FUNCTION_ARN,
            name=f"{project_id}-{job_id[:8]}",
            input=json.dumps(sfn_input),
        )

        job = {
            "projectId": project_id,
            "jobId": job_id,
            "userId": user_id,
            "stepFunctionArn": execution["executionArn"],
            "status": "STARTING",
            "currentStep": "starting",
            "createdAt": now,
        }
        put_job(job)

        update_project(user_id, project_id, {
            "status": "training",
            "updatedAt": now,
        })

        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps({
                "jobId": job_id,
                "executionArn": execution["executionArn"],
                "status": "STARTING",
            }),
        }
    except Exception as e:
        logger.exception("trigger_pipeline failed")
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": str(e)}),
        }
