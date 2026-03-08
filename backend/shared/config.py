import os

PROJECTS_TABLE = os.environ["PROJECTS_TABLE"]
JOBS_TABLE = os.environ["JOBS_TABLE"]
DATA_BUCKET = os.environ["DATA_BUCKET"]
STEP_FUNCTION_ARN = os.environ.get("STEP_FUNCTION_ARN", "")
REGION = os.environ.get("REGION", "ap-southeast-1")
