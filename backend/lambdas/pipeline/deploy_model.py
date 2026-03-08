import logging
from datetime import datetime

from shared.db import update_job, update_project

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def handler(event, context):
    project_id = event["projectId"]
    job_id = event["jobId"]
    user_id = event["userId"]
    now = datetime.utcnow().isoformat()

    update_job(project_id, job_id, {
        "status": "COMPLETED",
        "currentStep": "deployment",
        "completedAt": now,
    })

    update_project(user_id, project_id, {
        "status": "COMPLETED",
        "latestJobId": job_id,
        "updatedAt": now,
    })

    return {**event, "status": "COMPLETED"}
