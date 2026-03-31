import json
import logging

from shared.db import get_project, update_project

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
}

ALLOWED_FIELDS = {"targetColumn", "selectedFeatures", "taskType", "useCase",
                  "status", "suggestedConfig", "projectName"}


def handler(event, context):
    try:
        user_id = event["requestContext"]["authorizer"]["claims"]["sub"]
        project_id = event["pathParameters"]["id"]
        body = json.loads(event.get("body", "{}"))

        project = get_project(user_id, project_id)
        if not project:
            return {"statusCode": 404, "headers": CORS_HEADERS,
                    "body": json.dumps({"error": "Project not found"})}

        updates = {k: v for k, v in body.items() if k in ALLOWED_FIELDS}
        if updates:
            update_project(user_id, project_id, updates)

        updated = get_project(user_id, project_id)
        return {"statusCode": 200, "headers": CORS_HEADERS,
                "body": json.dumps(updated)}
    except Exception as e:
        logger.exception("update_project failed")
        return {"statusCode": 500, "headers": CORS_HEADERS,
                "body": json.dumps({"error": str(e)})}
