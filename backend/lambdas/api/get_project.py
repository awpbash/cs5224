import json
import logging

from shared.db import get_project

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

        item = get_project(user_id, project_id)
        if not item:
            return {
                "statusCode": 404,
                "headers": CORS_HEADERS,
                "body": json.dumps({"error": "Project not found"}),
            }

        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps({
                "projectId": item["projectId"],
                "userId": item.get("userId", ""),
                "projectName": item.get("projectName", ""),
                "useCase": item.get("useCase", "custom"),
                "taskType": item.get("taskType", "classification"),
                "dataSource": item.get("dataSource"),
                "datasetS3Path": item.get("datasetS3Path"),
                "preloadedDataset": item.get("preloadedDataset"),
                "targetColumn": item.get("targetColumn"),
                "selectedFeatures": item.get("selectedFeatures"),
                "status": item.get("status", "created"),
                "dataProfile": item.get("dataProfile"),
                "classLabels": item.get("classLabels"),
                "latestJobId": item.get("latestJobId"),
                "createdAt": item.get("createdAt", ""),
                "updatedAt": item.get("updatedAt", ""),
            }),
        }
    except Exception as e:
        logger.exception("get_project failed")
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": "Internal server error"}),
        }
