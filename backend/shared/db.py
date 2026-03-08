import json
import logging
from decimal import Decimal
from typing import Any, Optional

import boto3
from boto3.dynamodb.conditions import Key

from shared.config import JOBS_TABLE, PROJECTS_TABLE

logger = logging.getLogger(__name__)

dynamodb = boto3.resource("dynamodb")
projects_table = dynamodb.Table(PROJECTS_TABLE)
jobs_table = dynamodb.Table(JOBS_TABLE)


def _convert_decimals(obj: Any) -> Any:
    if isinstance(obj, Decimal):
        return int(obj) if obj == int(obj) else float(obj)
    if isinstance(obj, dict):
        return {k: _convert_decimals(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert_decimals(i) for i in obj]
    return obj


def _convert_floats(obj: Any) -> Any:
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _convert_floats(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert_floats(i) for i in obj]
    return obj


# --- Projects ---

def put_project(project: dict) -> None:
    projects_table.put_item(Item=_convert_floats(project))


def get_project(user_id: str, project_id: str) -> Optional[dict]:
    resp = projects_table.get_item(Key={"userId": user_id, "projectId": project_id})
    item = resp.get("Item")
    return _convert_decimals(item) if item else None


def list_projects(user_id: str) -> list[dict]:
    resp = projects_table.query(KeyConditionExpression=Key("userId").eq(user_id))
    return [_convert_decimals(i) for i in resp.get("Items", [])]


def update_project(user_id: str, project_id: str, updates: dict) -> None:
    expr_parts = []
    names = {}
    values = {}
    for i, (k, v) in enumerate(updates.items()):
        alias = f"#k{i}"
        val_alias = f":v{i}"
        expr_parts.append(f"{alias} = {val_alias}")
        names[alias] = k
        values[val_alias] = _convert_floats(v) if isinstance(v, (dict, list, float)) else v
    projects_table.update_item(
        Key={"userId": user_id, "projectId": project_id},
        UpdateExpression="SET " + ", ".join(expr_parts),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


# --- Jobs ---

def put_job(job: dict) -> None:
    jobs_table.put_item(Item=_convert_floats(job))


def get_job(project_id: str, job_id: str) -> Optional[dict]:
    resp = jobs_table.get_item(Key={"projectId": project_id, "jobId": job_id})
    item = resp.get("Item")
    return _convert_decimals(item) if item else None


def list_jobs(project_id: str) -> list[dict]:
    resp = jobs_table.query(KeyConditionExpression=Key("projectId").eq(project_id))
    return [_convert_decimals(i) for i in resp.get("Items", [])]


def update_job(project_id: str, job_id: str, updates: dict) -> None:
    expr_parts = []
    names = {}
    values = {}
    for i, (k, v) in enumerate(updates.items()):
        alias = f"#k{i}"
        val_alias = f":v{i}"
        expr_parts.append(f"{alias} = {val_alias}")
        names[alias] = k
        values[val_alias] = _convert_floats(v) if isinstance(v, (dict, list, float)) else v
    jobs_table.update_item(
        Key={"projectId": project_id, "jobId": job_id},
        UpdateExpression="SET " + ", ".join(expr_parts),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def get_latest_job(project_id: str) -> Optional[dict]:
    resp = jobs_table.query(
        KeyConditionExpression=Key("projectId").eq(project_id),
        ScanIndexForward=False,
        Limit=1,
    )
    items = resp.get("Items", [])
    return _convert_decimals(items[0]) if items else None
