import json
import logging
import os

from openai import OpenAI

from shared.db import get_job, get_latest_job

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
}

SYSTEM_PROMPT = """You are RetailMind, a business analytics advisor for retail SMEs.

Given ML model results (metrics, feature importance, task type), generate:
1. A plain-English business summary (2-3 sentences)
2. 3-5 actionable business recommendations
3. Key insights about what drives the predictions

Format your response as JSON:
```json
{
  "summary": "Business-friendly summary of what the model found",
  "recommendations": [
    {"title": "Short title", "description": "Actionable recommendation"},
    ...
  ],
  "insights": [
    {"feature": "feature_name", "explanation": "Why this matters in business terms"},
    ...
  ]
}
```

Keep language simple, avoid ML jargon. Focus on business impact."""


def handler(event, context):
    try:
        project_id = event["pathParameters"]["id"]
        job_id = event["pathParameters"].get("jobId")
        body = json.loads(event.get("body", "{}"))

        # Use specific jobId if provided, otherwise fall back to latest
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
        task_type = "regression" if is_regression else body.get("taskType", "classification")

        prompt = f"""Project: {project_name}
Task type: {task_type}
Model metrics: {json.dumps(metrics, indent=2)}
Top features: {json.dumps(feature_importance, indent=2) if feature_importance else 'Not available'}

Generate business insights and recommendations."""

        client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=1024,
        )

        reply = response.choices[0].message.content

        # Try to parse as JSON, fallback to raw text
        try:
            # Extract JSON from markdown code block if present
            if "```json" in reply:
                json_str = reply.split("```json")[1].split("```")[0].strip()
            elif "```" in reply:
                json_str = reply.split("```")[1].split("```")[0].strip()
            else:
                json_str = reply
            interpretation = json.loads(json_str)
        except (json.JSONDecodeError, IndexError):
            interpretation = {"summary": reply, "recommendations": [], "insights": []}

        # Normalize keys for frontend compatibility
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
