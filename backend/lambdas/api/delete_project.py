import json
import logging

from shared.db import get_project, delete_project

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

        project = get_project(user_id, project_id)
        if not project:
            return {"statusCode": 404, "headers": CORS_HEADERS,
                    "body": json.dumps({"error": "Project not found"})}

        delete_project(user_id, project_id)

        return {"statusCode": 200, "headers": CORS_HEADERS,
                "body": json.dumps({"deleted": True, "projectId": project_id})}
    except Exception as e:
        logger.exception("delete_project failed")
        return {"statusCode": 500, "headers": CORS_HEADERS,
                "body": json.dumps({"error": "Internal server error"})}
