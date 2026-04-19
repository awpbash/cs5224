"""Handle ECS Fargate task completion/failure events from EventBridge.

Triggered by EventBridge rule matching ECS task state changes.
Updates the job status in DynamoDB based on the Fargate task outcome.
"""

import json
import logging

from shared.db import update_job

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def handler(event, context):
    """Process ECS task state change events."""
    try:
        detail = event.get("detail", {})
        task_arn = detail.get("taskArn", "")
        last_status = detail.get("lastStatus", "")
        stopped_reason = detail.get("stoppedReason", "")

        # Extract job metadata from task overrides
        overrides = detail.get("overrides", {}).get("containerOverrides", [{}])
        env_vars = {}
        for override in overrides:
            for env in override.get("environment", []):
                env_vars[env["name"]] = env["value"]

        project_id = env_vars.get("PROJECT_ID")
        job_id = env_vars.get("JOB_ID")

        if not project_id or not job_id:
            logger.warning("No PROJECT_ID or JOB_ID in task overrides: %s", task_arn)
            return

        if last_status == "STOPPED":
            exit_code = None
            containers = detail.get("containers", [])
            if containers:
                exit_code = containers[0].get("exitCode")

            if exit_code == 0:
                logger.info("Fargate task completed successfully: %s", task_arn)
                update_job(project_id, job_id, {
                    "currentStep": "training_complete",
                })
            else:
                reason = stopped_reason or f"Container exited with code {exit_code}"
                logger.error("Fargate task failed: %s — %s", task_arn, reason)
                update_job(project_id, job_id, {
                    "status": "FAILED",
                    "failureReason": reason[:500],
                })

        logger.info("Processed event for task %s: status=%s", task_arn, last_status)

    except Exception as e:
        logger.exception("on_fargate_complete failed")
        raise
