import os
from pathlib import Path

from aws_cdk import (
    Duration,
    RemovalPolicy,
    Stack,
    aws_dynamodb as dynamodb,
    aws_ec2 as ec2,
    aws_ecr_assets as ecr_assets,
    aws_ecs as ecs,
    aws_iam as iam,
    aws_lambda as _lambda,
    aws_logs as logs,
    aws_s3 as s3,
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

        # --- Shared Lambda layer ---
        shared_layer = _lambda.LayerVersion(
            self, "PipelineSharedLayer",
            code=_lambda.Code.from_asset(BACKEND_DIR, exclude=["lambdas/*", "__pycache__", "*.pyc"]),
            compatible_runtimes=[_lambda.Runtime.PYTHON_3_12],
        )

        common_env = {
            "PROJECTS_TABLE": projects_table.table_name,
            "JOBS_TABLE": jobs_table.table_name,
            "DATA_BUCKET": data_bucket.bucket_name,
            "REGION": "ap-southeast-1",
        }

        def make_pipeline_lambda(
            name: str, handler_path: str, timeout: int = 60, memory: int = 256,
            extra_env: dict | None = None, layers: list | None = None,
        ) -> _lambda.Function:
            all_layers = [shared_layer] + (layers or [])
            env = {**common_env, **(extra_env or {})}
            fn = _lambda.Function(
                self, name,
                function_name=f"cloudforge-{name.lower()}",
                runtime=_lambda.Runtime.PYTHON_3_12,
                handler=handler_path,
                code=_lambda.Code.from_asset(os.path.join(BACKEND_DIR, "lambdas")),
                layers=all_layers,
                environment=env,
                timeout=Duration.seconds(timeout),
                memory_size=memory,
            )
            projects_table.grant_read_write_data(fn)
            jobs_table.grant_read_write_data(fn)
            data_bucket.grant_read_write(fn)
            return fn

        # --- Pipeline Lambdas ---
        # AWS SDK pandas layer for data processing
        pandas_layer = _lambda.LayerVersion.from_layer_version_arn(
            self, "PandasLayer",
            f"arn:aws:lambda:ap-southeast-1:336392948345:layer:AWSSDKPandas-Python312:16",
        )

        profile_fn = make_pipeline_lambda(
            "ProfileData", "pipeline.profile_data.handler",
            timeout=120, memory=512, layers=[pandas_layer],
        )
        etl_fn = make_pipeline_lambda(
            "EtlPreprocess", "pipeline.etl_preprocess.handler",
            timeout=300, memory=1024, layers=[pandas_layer],
        )
        expand_prompts_fn = make_pipeline_lambda(
            "ExpandPrompts", "pipeline.expand_prompts.handler",
            timeout=120, memory=256,
        )
        expand_prompts_fn.add_to_role_policy(iam.PolicyStatement(
            actions=["bedrock:InvokeModel"],
            resources=["*"],
        ))

        generate_image_fn = make_pipeline_lambda(
            "GenerateImage", "pipeline.generate_image.handler",
            timeout=60, memory=256,
        )
        generate_image_fn.add_to_role_policy(iam.PolicyStatement(
            actions=["bedrock:InvokeModel"],
            resources=["*"],
        ))

        auto_select_fn = make_pipeline_lambda(
            "AutoSelectModel", "pipeline.auto_select_model.handler",
        )
        evaluate_fn = make_pipeline_lambda(
            "EvaluateModel", "pipeline.evaluate_model.handler",
        )
        deploy_fn = make_pipeline_lambda(
            "DeployModel", "pipeline.deploy_model.handler",
        )

        # --- ECS Cluster + Fargate (tabular) ---
        cluster = ecs.Cluster(
            self, "TrainingCluster",
            cluster_name="cloudforge-cluster",
            vpc=vpc,
        )

        # Docker image assets
        sklearn_image = ecr_assets.DockerImageAsset(
            self, "SklearnImage",
            directory=os.path.join(CONTAINERS_DIR, "tabular-sklearn"),
        )
        xgboost_image = ecr_assets.DockerImageAsset(
            self, "XgboostImage",
            directory=os.path.join(CONTAINERS_DIR, "tabular-xgboost"),
        )

        # Fargate task definitions
        sklearn_task_def = ecs.FargateTaskDefinition(
            self, "SklearnTaskDef",
            cpu=1024, memory_limit_mib=2048,
        )
        sklearn_task_def.add_container(
            "train",
            image=ecs.ContainerImage.from_docker_image_asset(sklearn_image),
            logging=ecs.LogDrivers.aws_logs(stream_prefix="sklearn", log_retention=logs.RetentionDays.ONE_WEEK),
        )
        data_bucket.grant_read_write(sklearn_task_def.task_role)

        xgboost_task_def = ecs.FargateTaskDefinition(
            self, "XgboostTaskDef",
            cpu=1024, memory_limit_mib=2048,
        )
        xgboost_task_def.add_container(
            "train",
            image=ecs.ContainerImage.from_docker_image_asset(xgboost_image),
            logging=ecs.LogDrivers.aws_logs(stream_prefix="xgboost", log_retention=logs.RetentionDays.ONE_WEEK),
        )
        data_bucket.grant_read_write(xgboost_task_def.task_role)

        # --- SageMaker (image-resnet) ---
        resnet_image = ecr_assets.DockerImageAsset(
            self, "ResnetImage",
            directory=os.path.join(CONTAINERS_DIR, "image-resnet"),
        )

        sagemaker_role = iam.Role(
            self, "SageMakerTrainingRole",
            assumed_by=iam.ServicePrincipal("sagemaker.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name("AmazonSageMakerFullAccess"),
            ],
        )
        data_bucket.grant_read_write(sagemaker_role)

        # --- Step Functions ---

        # SFN task: profile
        profile_task = tasks.LambdaInvoke(
            self, "ProfileData",
            lambda_function=profile_fn,
            output_path="$.Payload",
        )

        # SFN task: ETL
        etl_task = tasks.LambdaInvoke(
            self, "EtlPreprocess",
            lambda_function=etl_fn,
            output_path="$.Payload",
        )

        # SFN task: expand prompts
        expand_task = tasks.LambdaInvoke(
            self, "ExpandPrompts",
            lambda_function=expand_prompts_fn,
            output_path="$.Payload",
        )

        # SFN task: generate images (Map)
        generate_single = tasks.LambdaInvoke(
            self, "GenerateSingleImage",
            lambda_function=generate_image_fn,
            output_path="$.Payload",
        )
        generate_map = sfn.Map(
            self, "GenerateImages",
            items_path="$.imagePrompts",
            max_concurrency=10,
            parameters={
                "userId.$": "$$.Execution.Input.userId",
                "projectId.$": "$$.Execution.Input.projectId",
                "label.$": "$$.Map.Item.Value.label",
                "prompt.$": "$$.Map.Item.Value.prompt",
                "index.$": "$$.Map.Item.Index",
            },
        )
        generate_map.item_processor(generate_single)

        # SFN task: auto-select
        auto_select_task = tasks.LambdaInvoke(
            self, "AutoSelectModel",
            lambda_function=auto_select_fn,
            output_path="$.Payload",
        )

        # SFN task: ECS RunTask (tabular — sklearn)
        sklearn_run = tasks.EcsRunTask(
            self, "RunSklearn",
            integration_pattern=sfn.IntegrationPattern.RUN_JOB,
            cluster=cluster,
            task_definition=sklearn_task_def,
            launch_target=tasks.EcsFargateLaunchTarget(platform_version=ecs.FargatePlatformVersion.LATEST),
            container_overrides=[
                tasks.ContainerOverride(
                    container_definition=sklearn_task_def.default_container,
                    environment=[
                        tasks.TaskEnvironmentVariable(name="DATA_S3_PATH", value=sfn.JsonPath.format("s3://{}/{}", data_bucket.bucket_name, sfn.JsonPath.string_at("$.processedS3Path"))),
                        tasks.TaskEnvironmentVariable(name="OUTPUT_S3_PATH", value=sfn.JsonPath.format("s3://{}/{}/{}/{}/", data_bucket.bucket_name, sfn.JsonPath.string_at("$.userId"), sfn.JsonPath.string_at("$.projectId"), sfn.JsonPath.string_at("$.jobId"))),
                        tasks.TaskEnvironmentVariable(name="MODEL_TYPE", value=sfn.JsonPath.string_at("$.modelType")),
                        tasks.TaskEnvironmentVariable(name="HYPERPARAMS", value=sfn.JsonPath.json_to_string(sfn.JsonPath.object_at("$.hyperparameters"))),
                    ],
                )
            ],
            subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS),
            result_path="$.ecsResult",
        )

        # SFN task: ECS RunTask (tabular — xgboost)
        xgboost_run = tasks.EcsRunTask(
            self, "RunXgboost",
            integration_pattern=sfn.IntegrationPattern.RUN_JOB,
            cluster=cluster,
            task_definition=xgboost_task_def,
            launch_target=tasks.EcsFargateLaunchTarget(platform_version=ecs.FargatePlatformVersion.LATEST),
            container_overrides=[
                tasks.ContainerOverride(
                    container_definition=xgboost_task_def.default_container,
                    environment=[
                        tasks.TaskEnvironmentVariable(name="DATA_S3_PATH", value=sfn.JsonPath.format("s3://{}/{}", data_bucket.bucket_name, sfn.JsonPath.string_at("$.processedS3Path"))),
                        tasks.TaskEnvironmentVariable(name="OUTPUT_S3_PATH", value=sfn.JsonPath.format("s3://{}/{}/{}/{}/", data_bucket.bucket_name, sfn.JsonPath.string_at("$.userId"), sfn.JsonPath.string_at("$.projectId"), sfn.JsonPath.string_at("$.jobId"))),
                        tasks.TaskEnvironmentVariable(name="MODEL_TYPE", value=sfn.JsonPath.string_at("$.modelType")),
                        tasks.TaskEnvironmentVariable(name="HYPERPARAMS", value=sfn.JsonPath.json_to_string(sfn.JsonPath.object_at("$.hyperparameters"))),
                    ],
                )
            ],
            subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS),
            result_path="$.ecsResult",
        )

        # SFN task: SageMaker training (image)
        sagemaker_train = tasks.SageMakerCreateTrainingJob(
            self, "SageMakerTrain",
            integration_pattern=sfn.IntegrationPattern.RUN_JOB,
            training_job_name=sfn.JsonPath.format("cloudforge-{}-{}", sfn.JsonPath.string_at("$.projectId"), sfn.JsonPath.string_at("$.jobId")),
            algorithm_specification=tasks.AlgorithmSpecification(
                training_image=ecs.ContainerImage.from_docker_image_asset(resnet_image),
                training_input_mode=tasks.InputMode.FILE,
            ),
            input_data_config=[
                tasks.Channel(
                    channel_name="training",
                    data_source=tasks.DataSource(
                        s3_data_source=tasks.S3DataSource(
                            s3_location=tasks.S3Location.from_json_expression("$.imageDataS3Uri"),
                        ),
                    ),
                ),
            ],
            output_data_config=tasks.OutputDataConfig(
                s3_output_location=tasks.S3Location.from_bucket(data_bucket, "sagemaker-output/"),
            ),
            resource_config=tasks.ResourceConfig(
                instance_count=1,
                instance_type=ec2.InstanceType("ml.g4dn.xlarge"),
                volume_size_in_gb=30,
            ),
            stopping_condition=tasks.StoppingCondition(max_runtime=Duration.hours(1)),
            role=sagemaker_role,
            hyperparameters={
                "HYPERPARAMS.$": "States.JsonToString($.hyperparameters)",
            },
            result_path="$.sagemakerResult",
        )

        # SFN task: evaluate + deploy
        evaluate_task = tasks.LambdaInvoke(
            self, "EvaluateModel",
            lambda_function=evaluate_fn,
            output_path="$.Payload",
        )
        deploy_task = tasks.LambdaInvoke(
            self, "DeployModel",
            lambda_function=deploy_fn,
            output_path="$.Payload",
        )

        # --- Choose container for tabular ---
        choose_tabular_container = sfn.Choice(self, "ChooseTabularContainer")
        choose_tabular_container.when(
            sfn.Condition.string_equals("$.containerName", "tabular-xgboost"),
            xgboost_run,
        )
        choose_tabular_container.otherwise(sklearn_run)

        # Tabular path
        tabular_chain = (
            profile_task
            .next(etl_task)
            .next(auto_select_task)
            .next(choose_tabular_container)
        )
        # Both container runs converge to evaluate
        sklearn_run.next(evaluate_task)
        xgboost_run.next(evaluate_task)

        # Image path — separate SFN state instances since states can't be reused
        auto_select_image = tasks.LambdaInvoke(
            self, "AutoSelectModelImage",
            lambda_function=auto_select_fn,
            output_path="$.Payload",
        )
        evaluate_image = tasks.LambdaInvoke(
            self, "EvaluateModelImage",
            lambda_function=evaluate_fn,
            output_path="$.Payload",
        )
        deploy_image = tasks.LambdaInvoke(
            self, "DeployModelImage",
            lambda_function=deploy_fn,
            output_path="$.Payload",
        )

        image_chain = (
            expand_task
            .next(generate_map)
            .next(auto_select_image)
            .next(sagemaker_train)
            .next(evaluate_image)
            .next(deploy_image)
        )

        evaluate_task.next(deploy_task)

        # Top-level choice
        task_type_choice = sfn.Choice(self, "TaskTypeChoice")
        task_type_choice.when(
            sfn.Condition.string_equals("$.taskType", "image-classification"),
            image_chain,
        )
        task_type_choice.otherwise(tabular_chain)

        self.state_machine = sfn.StateMachine(
            self, "PipelineStateMachine",
            state_machine_name="cloudforge-pipeline",
            definition_body=sfn.DefinitionBody.from_chainable(task_type_choice),
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
