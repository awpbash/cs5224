import json
import logging
from typing import Any

import boto3

from shared.config import DATA_BUCKET, REGION

logger = logging.getLogger(__name__)

s3 = boto3.client("s3", region_name=REGION)


def generate_presigned_upload_url(key: str, content_type: str = "text/csv", expires: int = 3600) -> str:
    return s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": DATA_BUCKET, "Key": key, "ContentType": content_type},
        ExpiresIn=expires,
    )


def generate_presigned_download_url(key: str, expires: int = 3600) -> str:
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": DATA_BUCKET, "Key": key},
        ExpiresIn=expires,
    )


def read_json(key: str) -> Any:
    resp = s3.get_object(Bucket=DATA_BUCKET, Key=key)
    return json.loads(resp["Body"].read().decode("utf-8"))


def write_json(key: str, data: Any) -> None:
    s3.put_object(
        Bucket=DATA_BUCKET,
        Key=key,
        Body=json.dumps(data),
        ContentType="application/json",
    )


def download_file(key: str, local_path: str) -> None:
    s3.download_file(DATA_BUCKET, key, local_path)


def upload_file(local_path: str, key: str) -> None:
    s3.upload_file(local_path, DATA_BUCKET, key)


def list_objects(prefix: str) -> list[str]:
    resp = s3.list_objects_v2(Bucket=DATA_BUCKET, Prefix=prefix)
    return [obj["Key"] for obj in resp.get("Contents", [])]
