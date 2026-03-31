import json
import logging
import os

import boto3

from shared.db import get_job, get_latest_job

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

bedrock = boto3.client("bedrock-runtime", region_name=os.environ.get("REGION", "ap-southeast-1"))

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
}

SYSTEM_PROMPT = """You are RetailMind, a senior retail business consultant interpreting ML model results for small-to-medium retail businesses.

Given ML model results, generate actionable business insights that a store owner can act on TODAY.

Rules:
- Write like a consultant presenting to a CEO, not a data scientist
- Every recommendation must be SPECIFIC and ACTIONABLE (e.g., "Offer a 10% loyalty discount to customers with tenure > 2 years" not "Consider retention strategies")
- Tie each insight to a DOLLAR IMPACT when possible (e.g., "This could reduce churn by ~15%, saving an estimated $X/month in lost revenue")
- Reference the actual feature names and their importance scores
- For classification: explain what drives positive vs negative outcomes
- For regression: explain what increases or decreases the target variable

Format your response as JSON:
```json
{
  "summary": "2-3 sentence executive summary of what the model reveals about the business",
  "recommendations": [
    {"title": "Action item title (5-8 words)", "description": "Specific, actionable recommendation with expected impact (2-3 sentences)", "impact": "high"},
    {"title": "...", "description": "...", "impact": "medium"},
    {"title": "...", "description": "...", "impact": "low"}
  ],
  "insights": [
    {"feature": "exact_feature_name", "explanation": "What this feature tells us about the business in plain English (1-2 sentences)"},
    ...
  ]
}
```

Impact levels: "high" = immediate revenue/cost impact, "medium" = operational improvement, "low" = nice-to-have optimization.
Return 3-5 recommendations sorted by impact (high first).
Return insights for the top 3-5 most important features.
IMPORTANT: Return ONLY the JSON block, no other text."""

MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0"


def _invoke_bedrock(system: str, user_message: str) -> str:
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 1024,
        "temperature": 0.7,
        "system": system,
        "messages": [{"role": "user", "content": user_message}],
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
        job_id = event["pathParameters"].get("jobId")
        body = json.loads(event.get("body", "{}"))

        # Validate user owns the project
        from shared.db import get_project
        project = get_project(user_id, project_id)
        if not project:
            return {
                "statusCode": 404,
                "headers": CORS_HEADERS,
                "body": json.dumps({"error": "Project not found"}),
            }

        if job_id:
            job = get_job(project_id, job_id)
        else:
            job = get_latest_job(project_id)
        if not job:
            return {
                "statusCode": 404,
                "headers": CORS_HEADERS,
                "body": json.dumps({"error": "No jobs found"}),
            }

        metrics = job.get("metrics", {})
        feature_importance = job.get("featureImportance", {})
        project_name = body.get("projectName", job.get("projectName", "Untitled"))
        is_regression = job.get("isRegression", False)
        task_type = "regression" if is_regression else job.get("taskType", "classification")

        # Build richer context
        use_case = project.get("useCase", "custom")
        target_col = project.get("targetColumn", "unknown")
        row_count = project.get("dataProfile", {}).get("rowCount", "unknown")

        prompt = f"""Project: {project_name}
Use case: {use_case}
Task type: {task_type}
Target variable: {target_col}
Dataset size: {row_count} rows
Model used: {job.get('modelType', 'unknown')}
Model metrics: {json.dumps(metrics, indent=2)}
Top features by importance: {json.dumps(feature_importance, indent=2) if feature_importance else 'Not available'}

Based on these results, generate actionable business insights and recommendations that a retail store owner can implement immediately."""

        reply = _invoke_bedrock(SYSTEM_PROMPT, prompt)

        # Try to parse as JSON, fallback to raw text
        try:
            if "```json" in reply:
                json_str = reply.split("```json")[1].split("```")[0].strip()
            elif "```" in reply:
                json_str = reply.split("```")[1].split("```")[0].strip()
            else:
                json_str = reply
            interpretation = json.loads(json_str)
        except (json.JSONDecodeError, IndexError):
            interpretation = {"summary": reply, "recommendations": [], "insights": []}

        if "summary" in interpretation and "businessSummary" not in interpretation:
            interpretation["businessSummary"] = interpretation.pop("summary")

        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps(interpretation),
        }
    except Exception as e:
        logger.exception("interpret_results failed")
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": str(e)}),
        }
