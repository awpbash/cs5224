import json
import logging

from shared.db import list_projects

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
        items = list_projects(user_id)

        projects = [
            {
                "projectId": item["projectId"],
                "projectName": item.get("projectName", ""),
                "useCase": item.get("useCase", "custom"),
                "taskType": item.get("taskType", "classification"),
                "status": item.get("status", "created"),
                "dataSource": item.get("dataSource"),
                "dataProfile": item.get("dataProfile"),
                "latestJobId": item.get("latestJobId"),
                "createdAt": item.get("createdAt", ""),
                "updatedAt": item.get("updatedAt", ""),
            }
            for item in items
        ]

        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps(projects),
        }
    except Exception as e:
        logger.exception("list_projects failed")
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": str(e)}),
        }
