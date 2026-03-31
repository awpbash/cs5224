import json
import logging
import os

import boto3

from shared.db import get_project, get_job

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

bedrock = boto3.client("bedrock-runtime", region_name=os.environ.get("REGION", "ap-southeast-1"))

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
}

SYSTEM_PROMPT = """You are RetailMind's Business Analyst AI, specializing in interpreting ML results for retail SMEs.

Help the user understand:
- What the model metrics mean in business terms
- Which features drive predictions and why
- Actionable next steps based on the results
- How to improve model performance

Be conversational, concise, and business-focused. Avoid ML jargon unless asked.
Keep responses to 3-5 sentences unless asked for detail."""

MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0"


def _invoke_bedrock(system: str, messages: list[dict]) -> str:
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 800,
        "temperature": 0.6,
        "system": system,
        "messages": messages,
    }
    response = bedrock.invoke_model(
        modelId=MODEL_ID,
        contentType="application/json",
        accept="application/json",
        body=json.dumps(body),
    )
    result = json.loads(response["body"].read())
    return result["content"][0]["text"]


def handler(event, context):
    try:
        user_id = event["requestContext"]["authorizer"]["claims"]["sub"]
        project_id = event["pathParameters"]["id"]
        body = json.loads(event.get("body", "{}"))
        message = body.get("message", "")
        history = body.get("history", [])

        project = get_project(user_id, project_id)
        job = None
        if project and project.get("latestJobId"):
            job = get_job(project_id, project["latestJobId"])

        system = SYSTEM_PROMPT
        if project:
            system += f"\n\n--- PROJECT ---\nName: {project.get('projectName', '')}"
            system += f"\nUse Case: {project.get('useCase', '')}"
            system += f"\nTask: {project.get('taskType', '')}"
            system += f"\nTarget: {project.get('targetColumn', '')}"
            if project.get("dataProfile"):
                dp = project["dataProfile"]
                system += f"\nDataset: {dp.get('rowCount', '?')} rows, {dp.get('columnCount', '?')} cols"

        if job:
            system += f"\n\n--- RESULTS ---\nModel: {job.get('modelType', '')}"
            system += f"\nStatus: {job.get('status', '')}"
            if job.get("metrics"):
                system += f"\nMetrics: {json.dumps(job['metrics'])}"
            if job.get("featureImportance"):
                fi = job["featureImportance"]
                if isinstance(fi, list):
                    fi = fi[:5]
                system += f"\nFeatures: {json.dumps(fi)}"

        messages = list(history)
        messages.append({"role": "user", "content": message})

        reply = _invoke_bedrock(system, messages)

        return {"statusCode": 200, "headers": CORS_HEADERS,
                "body": json.dumps({"reply": reply})}
    except Exception as e:
        logger.exception("results_chat failed")
        return {"statusCode": 500, "headers": CORS_HEADERS,
                "body": json.dumps({"error": str(e)})}
