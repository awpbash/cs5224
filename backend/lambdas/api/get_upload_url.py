import json
import logging

from shared.db import get_project, update_project
from shared.s3_utils import generate_presigned_upload_url

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
        body = json.loads(event.get("body", "{}"))

        project = get_project(user_id, project_id)
        if not project:
            return {
                "statusCode": 404,
                "headers": CORS_HEADERS,
                "body": json.dumps({"error": "Project not found"}),
            }

        filename = body.get("filename", "dataset.csv")
        content_type = body.get("contentType", "text/csv")
        s3_key = f"{user_id}/{project_id}/raw/{filename}"

        url = generate_presigned_upload_url(s3_key, content_type=content_type)

        update_project(user_id, project_id, {
            "dataSource": "uploaded",
            "datasetS3Path": s3_key,
            "status": "uploading",
        })

        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps({"uploadUrl": url, "s3Key": s3_key}),
        }
    except Exception as e:
        logger.exception("get_upload_url failed")
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": str(e)}),
        }
