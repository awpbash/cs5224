import os
from pathlib import Path

from aws_cdk import (
    BundlingOptions,
    BundlingOutput,
    CfnOutput,
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

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = str(PROJECT_ROOT / "backend")


class ApiStack(Stack):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        data_bucket: s3.IBucket,
        projects_table: dynamodb.ITable,
        jobs_table: dynamodb.ITable,
        chats_table: dynamodb.ITable,
        user_pool: cognito.IUserPool,
        state_machine: sfn.IStateMachine,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ── Shared layer (shared/ + pydantic) ──
        shared_layer = _lambda.LayerVersion(
            self, "SharedLayer",
            code=_lambda.Code.from_asset(
                BACKEND_DIR,
                bundling=BundlingOptions(
                    image=_lambda.Runtime.PYTHON_3_12.bundling_image,
                    command=[
                        "bash", "-c",
                        "pip install pydantic -t /asset-output/python/ --no-cache-dir && "
                        "cp -r shared /asset-output/python/shared"
                    ],
                    output_type=BundlingOutput.AUTO_DISCOVER,
                ),
            ),
            compatible_runtimes=[_lambda.Runtime.PYTHON_3_12],
            description="CloudForge shared utilities",
        )

        # ── Common environment ──
        common_env = {
            "PROJECTS_TABLE": projects_table.table_name,
            "JOBS_TABLE": jobs_table.table_name,
            "CHATS_TABLE": chats_table.table_name,
            "DATA_BUCKET": data_bucket.bucket_name,
            "STEP_FUNCTION_ARN": state_machine.state_machine_arn,
            "REGION": "ap-southeast-1",
            "BEDROCK_MODEL_ID": "global.anthropic.claude-haiku-4-5-20251001-v1:0",
        }

        def make_lambda(
            name: str, handler_path: str,
            timeout: int = 30, memory: int = 256,
            extra_layers: list | None = None,
            extra_env: dict | None = None,
        ) -> _lambda.Function:
            env = {**common_env, **(extra_env or {})}
            fn = _lambda.Function(
                self, name,
                function_name=f"retailmind-{name.lower()}",
                runtime=_lambda.Runtime.PYTHON_3_12,
                handler=handler_path,
                code=_lambda.Code.from_asset(os.path.join(BACKEND_DIR, "lambdas")),
                layers=[shared_layer] + (extra_layers or []),
                environment=env,
                timeout=Duration.seconds(timeout),
                memory_size=memory,
            )
            projects_table.grant_read_write_data(fn)
            jobs_table.grant_read_write_data(fn)
            chats_table.grant_read_write_data(fn)
            data_bucket.grant_read_write(fn)
            return fn

        # ── Existing API Lambdas ──
        create_project_fn = make_lambda("CreateProject", "api.create_project.handler")
        list_projects_fn = make_lambda("ListProjects", "api.list_projects.handler")
        get_project_fn = make_lambda("GetProject", "api.get_project.handler")
        get_upload_url_fn = make_lambda("GetUploadUrl", "api.get_upload_url.handler")
        trigger_pipeline_fn = make_lambda("TriggerPipeline", "api.trigger_pipeline.handler")
        get_job_status_fn = make_lambda("GetJobStatus", "api.get_job_status.handler")
        get_job_metrics_fn = make_lambda("GetJobMetrics", "api.get_job_metrics.handler")
        get_model_download_fn = make_lambda("GetModelDownload", "api.get_model_download.handler")

        # Inference uses a container-based Lambda (10GB limit) so it can include
        # xgboost + lightgbm + sklearn without hitting the 250MB zip layer limit.
        ml_dockerfile = "Dockerfile.ml"
        run_inference_fn = _lambda.DockerImageFunction(
            self, "RunInferenceContainer",
            code=_lambda.DockerImageCode.from_image_asset(BACKEND_DIR, file=ml_dockerfile),
            timeout=Duration.seconds(60),
            memory_size=1024,
            environment={**common_env},
        )
        projects_table.grant_read_write_data(run_inference_fn)
        jobs_table.grant_read_write_data(run_inference_fn)
        chats_table.grant_read_write_data(run_inference_fn)
        data_bucket.grant_read_write(run_inference_fn)

        # ── NEW API Lambdas ──
        delete_project_fn = make_lambda("DeleteProject", "api.delete_project.handler")
        update_project_fn = make_lambda("UpdateProject", "api.update_project.handler")

        select_preloaded_fn = make_lambda(
            "SelectPreloaded", "api.select_preloaded.handler",
        )

        list_preloaded_fn = make_lambda("ListPreloaded", "api.list_preloaded.handler")

        # Recompute profile also needs sklearn - use the same container image
        recompute_profile_fn = _lambda.DockerImageFunction(
            self, "RecomputeProfileContainer",
            code=_lambda.DockerImageCode.from_image_asset(
                BACKEND_DIR,
                file=ml_dockerfile,
                cmd=["api.recompute_profile.handler"],
            ),
            timeout=Duration.seconds(120),
            memory_size=512,
            environment={**common_env},
        )
        projects_table.grant_read_write_data(recompute_profile_fn)
        jobs_table.grant_read_write_data(recompute_profile_fn)
        chats_table.grant_read_write_data(recompute_profile_fn)
        data_bucket.grant_read_write(recompute_profile_fn)

        # ── Bedrock-powered Lambdas (no external API key needed) ──
        chat_fn = make_lambda(
            "Chat", "api.chat.handler",
            timeout=60, memory=256,
        )

        interpret_fn = make_lambda(
            "InterpretResults", "api.interpret_results.handler",
            timeout=60, memory=256,
        )

        results_chat_fn = make_lambda(
            "ResultsChat", "api.results_chat.handler",
            timeout=60, memory=256,
        )

        # Grant Bedrock InvokeModel to all AI Lambdas (foundation models + inference profiles)
        bedrock_policy = iam.PolicyStatement(
            actions=["bedrock:InvokeModel"],
            resources=[
                "arn:aws:bedrock:*::foundation-model/anthropic.*",
                "arn:aws:bedrock:*:*:inference-profile/apac.anthropic.*",
                "arn:aws:bedrock:*:*:inference-profile/us.anthropic.*",
                "arn:aws:bedrock:*:*:inference-profile/global.anthropic.*",
            ],
        )
        chat_fn.add_to_role_policy(bedrock_policy)
        interpret_fn.add_to_role_policy(bedrock_policy)
        results_chat_fn.add_to_role_policy(bedrock_policy)

        # Marketplace permissions required for newer Bedrock models
        marketplace_policy = iam.PolicyStatement(
            actions=[
                "aws-marketplace:ViewSubscriptions",
                "aws-marketplace:Subscribe",
            ],
            resources=["*"],
        )
        chat_fn.add_to_role_policy(marketplace_policy)
        interpret_fn.add_to_role_policy(marketplace_policy)
        results_chat_fn.add_to_role_policy(marketplace_policy)

        # Grant SFN permission
        state_machine.grant_start_execution(trigger_pipeline_fn)

        # Grant chats table to chat Lambda
        chats_table.grant_read_write_data(chat_fn)

        # ── REST API ──
        self.api = apigw.RestApi(
            self, "CloudForgeApi",
            rest_api_name="retailmind-api",
            default_cors_preflight_options=apigw.CorsOptions(
                allow_origins=apigw.Cors.ALL_ORIGINS,
                allow_methods=apigw.Cors.ALL_METHODS,
                allow_headers=["Content-Type", "Authorization"],
            ),
        )

        # Add CORS headers to 4XX/5XX gateway responses (auth failures, etc.)
        self.api.add_gateway_response(
            "GatewayResponse4XX",
            type=apigw.ResponseType.DEFAULT_4_XX,
            response_headers={
                "Access-Control-Allow-Origin": "'*'",
                "Access-Control-Allow-Headers": "'Content-Type,Authorization'",
                "Access-Control-Allow-Methods": "'*'",
            },
        )
        self.api.add_gateway_response(
            "GatewayResponse5XX",
            type=apigw.ResponseType.DEFAULT_5_XX,
            response_headers={
                "Access-Control-Allow-Origin": "'*'",
                "Access-Control-Allow-Headers": "'Content-Type,Authorization'",
                "Access-Control-Allow-Methods": "'*'",
            },
        )

        cog_authorizer = apigw.CognitoUserPoolsAuthorizer(
            self, "CognitoAuthorizer",
            cognito_user_pools=[user_pool],
        )
        auth_kwargs = {
            "authorizer": cog_authorizer,
            "authorization_type": apigw.AuthorizationType.COGNITO,
        }

        # ── Routes ──
        # /projects
        projects = self.api.root.add_resource("projects")
        projects.add_method("GET", apigw.LambdaIntegration(list_projects_fn), **auth_kwargs)
        projects.add_method("POST", apigw.LambdaIntegration(create_project_fn), **auth_kwargs)

        # /projects/{id}
        project = projects.add_resource("{id}")
        project.add_method("GET", apigw.LambdaIntegration(get_project_fn), **auth_kwargs)
        project.add_method("DELETE", apigw.LambdaIntegration(delete_project_fn), **auth_kwargs)
        project.add_method("PATCH", apigw.LambdaIntegration(update_project_fn), **auth_kwargs)

        # /projects/{id}/upload-url
        upload_url = project.add_resource("upload-url")
        upload_url.add_method("POST", apigw.LambdaIntegration(get_upload_url_fn), **auth_kwargs)

        # /projects/{id}/select-preloaded
        select_preloaded = project.add_resource("select-preloaded")
        select_preloaded.add_method("POST", apigw.LambdaIntegration(select_preloaded_fn), **auth_kwargs)

        # /projects/{id}/recompute-profile
        recompute = project.add_resource("recompute-profile")
        recompute.add_method("POST", apigw.LambdaIntegration(recompute_profile_fn), **auth_kwargs)

        # /projects/{id}/train
        train = project.add_resource("train")
        train.add_method("POST", apigw.LambdaIntegration(trigger_pipeline_fn), **auth_kwargs)

        # /projects/{id}/results
        results = project.add_resource("results")
        results.add_method("GET", apigw.LambdaIntegration(get_job_metrics_fn), **auth_kwargs)

        # /projects/{id}/results-chat
        results_chat = project.add_resource("results-chat")
        results_chat.add_method("POST", apigw.LambdaIntegration(results_chat_fn), **auth_kwargs)

        # /projects/{id}/jobs/{jobId}
        jobs_resource = project.add_resource("jobs")
        job = jobs_resource.add_resource("{jobId}")
        job.add_method("GET", apigw.LambdaIntegration(get_job_status_fn), **auth_kwargs)

        # /projects/{id}/jobs/{jobId}/download
        download = job.add_resource("download")
        download.add_method("GET", apigw.LambdaIntegration(get_model_download_fn), **auth_kwargs)

        # /projects/{id}/jobs/{jobId}/interpret
        interpret = job.add_resource("interpret")
        interpret.add_method("POST", apigw.LambdaIntegration(interpret_fn), **auth_kwargs)

        # /projects/{id}/jobs/{jobId}/infer
        infer = job.add_resource("infer")
        infer.add_method("POST", apigw.LambdaIntegration(run_inference_fn), **auth_kwargs)

        # /chat (top-level)
        chat_resource = self.api.root.add_resource("chat")
        chat_resource.add_method("POST", apigw.LambdaIntegration(chat_fn), **auth_kwargs)

        # /preloaded-datasets (top-level)
        preloaded = self.api.root.add_resource("preloaded-datasets")
        preloaded.add_method("GET", apigw.LambdaIntegration(list_preloaded_fn), **auth_kwargs)

        CfnOutput(self, "ApiUrl", value=self.api.url)
