import os
from pathlib import Path

from aws_cdk import (
    Duration,
    Stack,
    aws_apigateway as apigw,
    aws_cognito as cognito,
    aws_dynamodb as dynamodb,
    aws_iam as iam,
    aws_lambda as _lambda,
    aws_s3 as s3,
    aws_stepfunctions as sfn,
)
from constructs import Construct

BACKEND_DIR = str(Path(__file__).resolve().parent.parent.parent / "backend")


class ApiStack(Stack):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        data_bucket: s3.IBucket,
        projects_table: dynamodb.ITable,
        jobs_table: dynamodb.ITable,
        user_pool: cognito.IUserPool,
        state_machine: sfn.IStateMachine,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Shared Lambda layer for backend/shared/
        shared_layer = _lambda.LayerVersion(
            self, "SharedLayer",
            code=_lambda.Code.from_asset(BACKEND_DIR, exclude=["lambdas/*", "__pycache__", "*.pyc"]),
            compatible_runtimes=[_lambda.Runtime.PYTHON_3_12],
            description="CloudForge shared utilities",
        )

        # Common env vars
        common_env = {
            "PROJECTS_TABLE": projects_table.table_name,
            "JOBS_TABLE": jobs_table.table_name,
            "DATA_BUCKET": data_bucket.bucket_name,
            "STEP_FUNCTION_ARN": state_machine.state_machine_arn,
            "REGION": "ap-southeast-1",
        }

        def make_lambda(name: str, handler_path: str, timeout: int = 30, memory: int = 256) -> _lambda.Function:
            fn = _lambda.Function(
                self, name,
                function_name=f"cloudforge-{name.lower()}",
                runtime=_lambda.Runtime.PYTHON_3_12,
                handler=handler_path,
                code=_lambda.Code.from_asset(os.path.join(BACKEND_DIR, "lambdas")),
                layers=[shared_layer],
                environment=common_env,
                timeout=Duration.seconds(timeout),
                memory_size=memory,
            )
            projects_table.grant_read_write_data(fn)
            jobs_table.grant_read_write_data(fn)
            data_bucket.grant_read_write(fn)
            return fn

        # API Lambdas
        create_project_fn = make_lambda("CreateProject", "api.create_project.handler")
        list_projects_fn = make_lambda("ListProjects", "api.list_projects.handler")
        get_project_fn = make_lambda("GetProject", "api.get_project.handler")
        get_upload_url_fn = make_lambda("GetUploadUrl", "api.get_upload_url.handler")
        trigger_pipeline_fn = make_lambda("TriggerPipeline", "api.trigger_pipeline.handler")
        get_job_status_fn = make_lambda("GetJobStatus", "api.get_job_status.handler")
        get_job_metrics_fn = make_lambda("GetJobMetrics", "api.get_job_metrics.handler")
        get_model_download_fn = make_lambda("GetModelDownload", "api.get_model_download.handler")

        # Inference Lambda needs more memory + longer timeout
        run_inference_fn = make_lambda("RunInference", "api.run_inference.handler", timeout=60, memory=1024)

        # Grant SFN start permission to trigger_pipeline
        state_machine.grant_start_execution(trigger_pipeline_fn)

        # REST API
        self.api = apigw.RestApi(
            self, "CloudForgeApi",
            rest_api_name="cloudforge-api",
            default_cors_preflight_options=apigw.CorsOptions(
                allow_origins=apigw.Cors.ALL_ORIGINS,
                allow_methods=apigw.Cors.ALL_METHODS,
                allow_headers=["Content-Type", "Authorization"],
            ),
        )

        # Cognito authorizer
        authorizer = apigw.CognitoUserPoolsAuthorizer(
            self, "CognitoAuthorizer",
            cognito_user_pools=[user_pool],
        )
        auth_opts = apigw.MethodOptions(authorizer=authorizer, authorization_type=apigw.AuthorizationType.COGNITO)

        # Routes
        projects = self.api.root.add_resource("projects")
        projects.add_method("GET", apigw.LambdaIntegration(list_projects_fn), method_options=auth_opts)
        projects.add_method("POST", apigw.LambdaIntegration(create_project_fn), method_options=auth_opts)

        project = projects.add_resource("{id}")
        project.add_method("GET", apigw.LambdaIntegration(get_project_fn), method_options=auth_opts)

        upload_url = project.add_resource("upload-url")
        upload_url.add_method("POST", apigw.LambdaIntegration(get_upload_url_fn), method_options=auth_opts)

        train = project.add_resource("train")
        train.add_method("POST", apigw.LambdaIntegration(trigger_pipeline_fn), method_options=auth_opts)

        results = project.add_resource("results")
        results.add_method("GET", apigw.LambdaIntegration(get_job_metrics_fn), method_options=auth_opts)

        infer = project.add_resource("infer")
        infer.add_method("POST", apigw.LambdaIntegration(run_inference_fn), method_options=auth_opts)

        jobs = project.add_resource("jobs")
        job = jobs.add_resource("{jobId}")
        job.add_method("GET", apigw.LambdaIntegration(get_job_status_fn), method_options=auth_opts)

        download = job.add_resource("download")
        download.add_method("GET", apigw.LambdaIntegration(get_model_download_fn), method_options=auth_opts)
