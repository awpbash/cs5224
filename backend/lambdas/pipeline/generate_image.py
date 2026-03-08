import base64
import json
import logging
import os

import boto3

from shared.config import DATA_BUCKET

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")
s3 = boto3.client("s3")


def handler(event, context):
    """Called per-image from a Map state."""
    user_id = event["userId"]
    project_id = event["projectId"]
    label = event["label"]
    prompt = event["prompt"]
    index = event.get("index", 0)

    response = bedrock.invoke_model(
        modelId="amazon.titan-image-generator-v1",
        contentType="application/json",
        accept="application/json",
        body=json.dumps({
            "textToImageParams": {"text": prompt},
            "taskType": "TEXT_IMAGE",
            "imageGenerationConfig": {
                "numberOfImages": 1,
                "height": 512,
                "width": 512,
                "cfgScale": 8.0,
            },
        }),
    )

    body = json.loads(response["body"].read())
    image_b64 = body["images"][0]
    image_bytes = base64.b64decode(image_b64)

    s3_key = f"{user_id}/{project_id}/images/{label}/{index:04d}.png"
    s3.put_object(Bucket=DATA_BUCKET, Key=s3_key, Body=image_bytes, ContentType="image/png")

    return {"s3Key": s3_key, "label": label, "index": index}
