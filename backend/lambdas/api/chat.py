import json
import logging
import os
import uuid

import boto3

from shared.db import get_project

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

bedrock = boto3.client("bedrock-runtime", region_name=os.environ.get("REGION", "ap-southeast-1"))

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
}

# In-memory session store (local dev only; in prod use DynamoDB)
_sessions: dict[str, list[dict]] = {}

SYSTEM_PROMPT = """You are RetailMind, a senior data scientist and business strategist embedded in an analytics platform for retail SMEs.

You have deep expertise in:
- Machine learning (classification, regression, clustering, time series)
- Retail analytics (churn, CLV, demand forecasting, market basket, RFM segmentation)
- Feature engineering for tabular data
- Translating business problems into ML tasks

RULES:
- Be direct and decisive. Don't ask unnecessary questions — infer from context.
- When the user describes a problem, propose the ML framing (target column, task type, relevant features) based on the data you can see.
- Give concrete, specific answers. Instead of "you could try..." say "Use column X as target, task type: classification. Key features: A, B, C because..."
- If you have the data profile, analyze it proactively: mention class balance issues, high-cardinality columns to watch, null rates that matter, and which features look predictive.
- Keep responses SHORT — 2-4 sentences max unless the user asks for detail.
- ANY column can be a target — not just the obvious or last one. If the user says "I want to predict X", use X as target even if it's unusual.
- If the user asks to change the target or use a different column, update your config immediately. Respect user preferences over your own suggestions.
- When the user changes the target, also update taskType (numeric target = regression, categorical/binary target = classification) and adjust suggestedFeatures to exclude the new target.

When you're ready to propose a config (do this ASAP, even on the first message if the data makes it clear), include a JSON block:
```json
{
  "useCase": "churn_prediction | sales_forecasting | customer_segmentation | demand_forecasting | custom",
  "taskType": "classification | regression",
  "suggestedTarget": "exact_column_name",
  "suggestedFeatures": ["col1", "col2", "col3"],
  "businessContext": "one sentence: what we're predicting and why it matters",
  "timeFrame": "relevant time period or N/A"
}
```

Always output the JSON config when you have enough information — don't wait to be asked."""

MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0"


def _invoke_bedrock(system: str, messages: list[dict]) -> str:
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 1024,
        "temperature": 0.5,
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


def _build_data_context(project_id: str, user_id: str) -> str:
    try:
        project = get_project(user_id, project_id)
        if not project or not project.get("dataProfile"):
            return ""

        dp = project["dataProfile"]
        lines = [
            f"\n\n--- UPLOADED DATA PROFILE ---",
            f"Dataset: {dp.get('rowCount', '?')} rows, {dp.get('columnCount', '?')} columns",
            f"\nColumns:"
        ]

        for col in dp.get("columns", []):
            desc = f"  - {col['name']} ({col['dtype']})"
            desc += f" — {col['uniqueCount']} unique"
            if col.get("nullCount", 0) > 0:
                pct = round(col["nullCount"] / dp["rowCount"] * 100, 1)
                desc += f", {col['nullCount']} nulls ({pct}%)"
            if col.get("mean") is not None:
                desc += f", mean={col['mean']}, std={col.get('std', '?')}"
            lines.append(desc)

        preview = dp.get("preview", [])
        if preview:
            lines.append(f"\nFirst {len(preview)} rows (sample):")
            lines.append(json.dumps(preview[:3], indent=2))

        return "\n".join(lines)
    except Exception:
        return ""


def handler(event, context):
    try:
        body = json.loads(event.get("body", "{}"))
        user_id = event["requestContext"]["authorizer"]["claims"]["sub"]

        message = body.get("message", "")
        session_id = body.get("sessionId") or str(uuid.uuid4())
        project_id = body.get("projectId", "")
        data_columns = body.get("dataColumns", [])

        # Get or create session history
        if session_id not in _sessions:
            _sessions[session_id] = []

        if message:
            _sessions[session_id].append({"role": "user", "content": message})

        if body.get("messages") and not message:
            _sessions[session_id] = body["messages"]

        # Build system prompt with data context
        system_content = SYSTEM_PROMPT

        if project_id:
            data_context = _build_data_context(project_id, user_id)
            if data_context:
                system_content += data_context

        if data_columns and not project_id:
            system_content += f"\n\nDataset columns: {', '.join(data_columns)}"

        reply = _invoke_bedrock(system_content, _sessions[session_id])
        _sessions[session_id].append({"role": "assistant", "content": reply})

        suggested_config = _extract_config(reply)

        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps({
                "sessionId": session_id,
                "reply": reply,
                "suggestedConfig": suggested_config,
                "messages": _sessions[session_id],
            }),
        }
    except Exception as e:
        logger.exception("chat failed")
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": str(e)}),
        }


def _extract_config(text: str) -> dict | None:
    if "```json" not in text:
        return None
    try:
        json_str = text.split("```json")[1].split("```")[0].strip()
        return json.loads(json_str)
    except (json.JSONDecodeError, IndexError):
        return None
