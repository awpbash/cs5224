import json
import logging

import boto3

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")


def handler(event, context):
    class_labels = event["classLabels"]
    images_per_class = event.get("imagesPerClass", 20)

    prompts = []
    for label in class_labels:
        response = bedrock.invoke_model(
            modelId="anthropic.claude-3-haiku-20240307-v1:0",
            contentType="application/json",
            accept="application/json",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 1024,
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            f"Generate {images_per_class} short, varied image descriptions for the class '{label}'. "
                            "Each should be a one-sentence visual description suitable for an image generator. "
                            "Return as a JSON array of strings, nothing else."
                        ),
                    }
                ],
            }),
        )
        body = json.loads(response["body"].read())
        text = body["content"][0]["text"]

        try:
            descriptions = json.loads(text)
        except json.JSONDecodeError:
            import re
            match = re.search(r'\[.*\]', text, re.DOTALL)
            descriptions = json.loads(match.group()) if match else [f"A photo of {label}"] * images_per_class

        for desc in descriptions[:images_per_class]:
            prompts.append({"label": label, "prompt": desc})

    return {**event, "imagePrompts": prompts}
