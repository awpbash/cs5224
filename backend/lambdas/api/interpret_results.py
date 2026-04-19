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

SYSTEM_PROMPT = """You are RetailMind, a senior retail business strategist interpreting ML model results for small-to-medium retail businesses. You have 20 years of experience in retail analytics, customer lifecycle management, and revenue optimization.

Your job: turn ML model outputs into a concrete action plan that a non-technical store owner can execute THIS WEEK.

RULES:
1. NEVER use jargon (no "F1 score", "precision", "feature importance"). Translate everything into business language.
2. Every recommendation MUST include:
   - A specific action (WHO does WHAT by WHEN)
   - An expected outcome tied to the model's findings
   - A rough dollar/percentage impact estimate based on the metrics
3. Reference actual data: use the feature names, their importance rankings, and the model's accuracy to ground your advice.
4. For classification models: explain the split between outcomes (e.g., "Out of every 100 customers, the model identifies ~30 who are likely to leave") and what separates the groups.
5. For regression models: explain what drives the predicted number up or down, with concrete examples (e.g., "Each additional month of tenure adds roughly $X to predicted lifetime value").
6. The executive summary should answer: "What is the ONE thing I should do differently starting tomorrow?"
7. Recommendations should be ordered by estimated business impact, not by feature importance score.

FORMAT - respond with ONLY this JSON, no other text:
```json
{
  "summary": "3-4 sentence executive summary: what the model found, the key business implication, and the single most important action to take",
  "recommendations": [
    {
      "title": "Verb-first action title (5-8 words)",
      "description": "WHO should do WHAT, HOW, and the expected business outcome in 2-3 sentences. Be specific - name features, thresholds, customer segments.",
      "impact": "high|medium|low"
    }
  ],
  "insights": [
    {
      "feature": "exact_feature_name_from_model",
      "explanation": "What this tells us about the business and WHY it matters for the bottom line (2 sentences max)"
    }
  ]
}
```

Return 4-5 recommendations (at least 2 high-impact) and insights for the top 5 features."""

# Use Claude 3.5 Haiku for better reasoning at low cost
MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "global.anthropic.claude-haiku-4-5-20251001-v1:0")


def _invoke_bedrock(system: str, user_message: str) -> str:
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 2048,
        "temperature": 0.4,
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
        body = json.loads(event.get("body") or "{}")

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
        data_profile = project.get("dataProfile", {})
        row_count = data_profile.get("rowCount", "unknown")
        col_count = data_profile.get("columnCount", "unknown")

        # Get class balance for classification context
        class_balance = data_profile.get("classBalance", [])
        class_balance_str = ""
        if class_balance:
            class_balance_str = "\nClass distribution in target: " + ", ".join(
                f"{c.get('label', '?')}: {c.get('count', '?')}" for c in class_balance
            )

        # Get business context from chatbot session if available
        business_context = project.get("businessContext", "")

        # Build feature importance summary in readable form
        fi_summary = "Not available"
        if feature_importance:
            if isinstance(feature_importance, list):
                sorted_fi = sorted(feature_importance, key=lambda x: x.get("importance", 0), reverse=True)
                fi_lines = []
                for i, f in enumerate(sorted_fi[:10], 1):
                    pct = round(f.get("importance", 0) * 100, 1)
                    fi_lines.append(f"  {i}. {f.get('feature', '?')} - {pct}% importance")
                fi_summary = "\n".join(fi_lines)
            else:
                fi_summary = json.dumps(feature_importance, indent=2)

        # Summarize metrics in plain language
        metrics_summary = json.dumps({k: v for k, v in metrics.items()
                                       if k not in ("featureImportance", "confusionMatrix", "classLabels")}, indent=2)

        prompt = f"""## Business Context
Project: {project_name}
Use case: {use_case}
{f"Business objective: {business_context}" if business_context else ""}
Target variable: {target_col} ({task_type})
Dataset: {row_count} rows, {col_count} columns
{class_balance_str}

## Model Results
Algorithm: {job.get('modelType', 'unknown')}
Performance metrics: {metrics_summary}
Training duration: {job.get('trainingDurationSec', 'unknown')} seconds

## Feature Rankings (what drives predictions)
{fi_summary}

## Your Task
Analyze these results and generate:
1. An executive summary a store owner can understand in 30 seconds
2. 4-5 specific, implementable recommendations ranked by business impact
3. Plain-English explanations of what the top features mean for the business

Remember: the audience is a retail store owner, NOT a data scientist. Every insight should answer "So what? What do I do about this?" """

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
            "body": json.dumps({"error": "Internal server error"}),
        }
