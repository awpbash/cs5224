import json
import logging
import uuid
from datetime import datetime

from shared.db import put_project

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
        body = json.loads(event.get("body", "{}"))

        project_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()

        name = body.get("projectName") or body.get("name", "Untitled")
        task_type = body.get("taskType", "classification")
        use_case = body.get("useCase", "custom")

        project = {
            "userId": user_id,
            "projectId": project_id,
            "projectName": name,
            "taskType": task_type,
            "useCase": use_case,
            "status": "CREATED",
            "createdAt": now,
            "updatedAt": now,
        }

        put_project(project)

        return {
            "statusCode": 201,
            "headers": CORS_HEADERS,
            "body": json.dumps({
                "projectId": project_id,
                "projectName": name,
                "taskType": task_type,
                "useCase": use_case,
                "status": "CREATED",
                "createdAt": now,
                "updatedAt": now,
            }),
        }
    except Exception as e:
        logger.exception("create_project failed")
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": str(e)}),
        }
