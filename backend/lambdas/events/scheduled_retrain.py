"""Scheduled retraining handler — triggered by EventBridge cron rule.

Scans for projects with auto-retrain enabled and triggers a new
training pipeline for each one using the same configuration as
the last successful job.

EventBridge rule: rate(30 days) or cron(0 2 1 * ? *)  (1st of month at 2am)
"""

import json
import logging
import os
import uuid
from datetime import datetime

import boto3

from shared.db import get_job, update_project

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource("dynamodb")
sfn = boto3.client("stepfunctions")

PROJECTS_TABLE = os.environ.get("PROJECTS_TABLE", "cloudforge-projects")
JOBS_TABLE = os.environ.get("JOBS_TABLE", "cloudforge-jobs")
STEP_FUNCTION_ARN = os.environ.get("STEP_FUNCTION_ARN", "")


def handler(event, context):
    """Scan for projects needing retraining and trigger pipelines."""
    try:
        table = dynamodb.Table(PROJECTS_TABLE)

        # Scan for completed projects (in production, use a GSI or flag)
        response = table.scan(
            FilterExpression="attribute_exists(latestJobId) AND #s = :completed AND autoRetrain = :enabled",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":completed": "COMPLETED",
                ":enabled": True,
            },
        )

        projects = response.get("Items", [])
        triggered = 0

        for project in projects:
            try:
                user_id = project["userId"]
                project_id = project["projectId"]
                latest_job_id = project.get("latestJobId")

                if not latest_job_id:
                    continue

                # Get the last job config to replicate
                last_job = get_job(project_id, latest_job_id)
                if not last_job or last_job.get("status") != "COMPLETED":
                    continue

                job_id = str(uuid.uuid4())
                now = datetime.utcnow().isoformat()

                sfn_input = {
                    "userId": user_id,
                    "projectId": project_id,
                    "jobId": job_id,
                    "taskType": project.get("taskType", "classification"),
                    "dataSource": project.get("dataSource", "uploaded"),
                    "datasetS3Path": project.get("datasetS3Path", ""),
                    "targetColumn": project.get("targetColumn"),
                    "selectedFeatures": project.get("selectedFeatures"),
                    "mode": "auto",
                    "isScheduledRetrain": True,
                }

                sfn.start_execution(
                    stateMachineArn=STEP_FUNCTION_ARN,
                    name=f"retrain-{project_id}-{job_id[:8]}",
                    input=json.dumps(sfn_input),
                )

                # Create job record
                jobs_table = dynamodb.Table(JOBS_TABLE)
                jobs_table.put_item(Item={
                    "projectId": project_id,
                    "jobId": job_id,
                    "userId": user_id,
                    "status": "STARTING",
                    "currentStep": "starting",
                    "isScheduledRetrain": True,
                    "createdAt": now,
                })

                update_project(user_id, project_id, {
                    "status": "TRAINING",
                    "updatedAt": now,
                })

                triggered += 1
                logger.info("Triggered retrain for project %s (job %s)", project_id, job_id)

            except Exception as e:
                logger.warning("Failed to retrain project %s: %s", project.get("projectId"), str(e))
                continue

        logger.info("Scheduled retraining complete: %d/%d projects triggered", triggered, len(projects))

        return {"triggered": triggered, "total": len(projects)}

    except Exception as e:
        logger.exception("scheduled_retrain failed")
        raise
