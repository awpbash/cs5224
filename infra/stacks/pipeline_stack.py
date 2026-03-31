import os
from pathlib import Path

from aws_cdk import (
    BundlingOptions,
    BundlingOutput,
    Duration,
    RemovalPolicy,
    Stack,
    aws_ec2 as ec2,
    aws_ecr_assets as ecr_assets,
    aws_ecs as ecs,
    aws_lambda as _lambda,
    aws_logs as logs,
    aws_s3 as s3,
    aws_dynamodb as dynamodb,
    aws_stepfunctions as sfn,
    aws_stepfunctions_tasks as tasks,
)
from constructs import Construct

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = str(PROJECT_ROOT / "backend")
CONTAINERS_DIR = str(PROJECT_ROOT / "containers")


class PipelineStack(Stack):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        vpc: ec2.IVpc,
        data_bucket: s3.IBucket,
        projects_table: dynamodb.ITable,
        jobs_table: dynamodb.ITable,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ── Shared Lambda layer (shared/ module + pydantic) ──
        shared_layer = _lambda.LayerVersion(
            self, "PipelineSharedLayer",
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
        )

        # ── Combined sklearn+pandas layer (includes numpy, scipy, pandas) ──
        sklearn_layer = _lambda.LayerVersion(
            self, "SklearnLayer",
            code=_lambda.Code.from_asset(
                str(PROJECT_ROOT / "layers" / "sklearn-layer.zip"),
            ),
            compatible_runtimes=[_lambda.Runtime.PYTHON_3_12],
            description="scikit-learn + pandas for Lambda",
        )

        common_env = {
            "PROJECTS_TABLE": projects_table.table_name,
            "JOBS_TABLE": jobs_table.table_name,
            "DATA_BUCKET": data_bucket.bucket_name,
            "REGION": "ap-southeast-1",
        }

        def make_pipeline_lambda(
            name: str, handler_path: str, timeout: int = 60, memory: int = 256,
            extra_layers: list | None = None,
        ) -> _lambda.Function:
            all_layers = [shared_layer] + (extra_layers or [])
            fn = _lambda.Function(
                self, name,
                function_name=f"cloudforge-{name.lower()}",
                runtime=_lambda.Runtime.PYTHON_3_12,
                handler=handler_path,
                code=_lambda.Code.from_asset(os.path.join(BACKEND_DIR, "lambdas")),
                layers=all_layers,
                environment=common_env,
                timeout=Duration.seconds(timeout),
                memory_size=memory,
            )
            projects_table.grant_read_write_data(fn)
            jobs_table.grant_read_write_data(fn)
            data_bucket.grant_read_write(fn)
            return fn

        # ── Pipeline Lambdas ──
        profile_fn = make_pipeline_lambda(
            "ProfileData", "pipeline.profile_data.handler",
            timeout=120, memory=512,
            extra_layers=[sklearn_layer],
        )
        etl_fn = make_pipeline_lambda(
            "EtlPreprocess", "pipeline.etl_preprocess.handler",
            timeout=300, memory=1024,
            extra_layers=[sklearn_layer],
        )
        auto_select_fn = make_pipeline_lambda(
            "AutoSelectModel", "pipeline.auto_select_model.handler",
        )
        evaluate_fn = make_pipeline_lambda(
            "EvaluateModel", "pipeline.evaluate_model.handler",
        )
        deploy_fn = make_pipeline_lambda(
            "DeployModel", "pipeline.deploy_model.handler",
        )

        # ── ECS Cluster ──
        cluster = ecs.Cluster(
            self, "TrainingCluster",
            cluster_name="cloudforge-cluster",
            vpc=vpc,
        )

        # ── Single AutoML container (builds + pushes to ECR automatically) ──
        automl_image = ecr_assets.DockerImageAsset(
            self, "AutomlImage",
            directory=os.path.join(CONTAINERS_DIR, "tabular-automl"),
        )

        automl_task_def = ecs.FargateTaskDefinition(
            self, "AutomlTaskDef",
            cpu=1024,
            memory_limit_mib=2048,
        )
        automl_task_def.add_container(
            "train",
            image=ecs.ContainerImage.from_docker_image_asset(automl_image),
            logging=ecs.LogDrivers.aws_logs(
                stream_prefix="automl",
                log_retention=logs.RetentionDays.ONE_WEEK,
            ),
        )
        data_bucket.grant_read_write(automl_task_def.task_role)

        # ── Step Functions tasks ──
        profile_task = tasks.LambdaInvoke(
            self, "ProfileDataTask", lambda_function=profile_fn,
            output_path="$.Payload",
        )
        etl_task = tasks.LambdaInvoke(
            self, "EtlPreprocessTask", lambda_function=etl_fn,
            output_path="$.Payload",
        )
        auto_select_task = tasks.LambdaInvoke(
            self, "AutoSelectModelTask", lambda_function=auto_select_fn,
            output_path="$.Payload",
        )

        # ── ECS Fargate RunTask (single unified container) ──
        automl_run = tasks.EcsRunTask(
            self, "RunTraining",
            integration_pattern=sfn.IntegrationPattern.RUN_JOB,
            cluster=cluster,
            task_definition=automl_task_def,
            launch_target=tasks.EcsFargateLaunchTarget(
                platform_version=ecs.FargatePlatformVersion.LATEST,
            ),
            container_overrides=[
                tasks.ContainerOverride(
                    container_definition=automl_task_def.default_container,
                    environment=[
                        tasks.TaskEnvironmentVariable(
                            name="DATA_S3_PATH",
                            value=sfn.JsonPath.format(
                                "s3://{}/{}",
                                data_bucket.bucket_name,
                                sfn.JsonPath.string_at("$.processedS3Path"),
                            ),
                        ),
                        tasks.TaskEnvironmentVariable(
                            name="OUTPUT_S3_PATH",
                            value=sfn.JsonPath.format(
                                "s3://{}/{}/{}/{}/",
                                data_bucket.bucket_name,
                                sfn.JsonPath.string_at("$.userId"),
                                sfn.JsonPath.string_at("$.projectId"),
                                sfn.JsonPath.string_at("$.jobId"),
                            ),
                        ),
                        tasks.TaskEnvironmentVariable(
                            name="TASK_TYPE",
                            value=sfn.JsonPath.string_at("$.taskType"),
                        ),
                        tasks.TaskEnvironmentVariable(
                            name="MODE",
                            value=sfn.JsonPath.string_at("$.mode"),
                        ),
                        tasks.TaskEnvironmentVariable(
                            name="MODEL_TYPE",
                            value=sfn.JsonPath.string_at("$.modelType"),
                        ),
                        tasks.TaskEnvironmentVariable(
                            name="HYPERPARAMS",
                            value=sfn.JsonPath.json_to_string(
                                sfn.JsonPath.object_at("$.hyperparameters")
                            ),
                        ),
                    ],
                ),
            ],
            subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PUBLIC),
            assign_public_ip=True,
            result_path="$.ecsResult",
        )

        evaluate_task = tasks.LambdaInvoke(
            self, "EvaluateModelTask", lambda_function=evaluate_fn,
            output_path="$.Payload",
        )
        deploy_task = tasks.LambdaInvoke(
            self, "DeployModelTask", lambda_function=deploy_fn,
            output_path="$.Payload",
        )

        # ── Chain: linear pipeline (no branching) ──
        definition = (
            profile_task
            .next(etl_task)
            .next(auto_select_task)
            .next(automl_run)
            .next(evaluate_task)
            .next(deploy_task)
        )

        self.state_machine = sfn.StateMachine(
            self, "PipelineStateMachine",
            state_machine_name="cloudforge-pipeline",
            definition_body=sfn.DefinitionBody.from_chainable(definition),
            timeout=Duration.hours(2),
            logs=sfn.LogOptions(
                destination=logs.LogGroup(
                    self, "SfnLogGroup",
                    log_group_name="/aws/stepfunctions/cloudforge-pipeline",
                    retention=logs.RetentionDays.ONE_WEEK,
                    removal_policy=RemovalPolicy.DESTROY,
                ),
                level=sfn.LogLevel.ALL,
            ),
        )
