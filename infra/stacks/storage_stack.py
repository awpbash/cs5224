from aws_cdk import (
    CfnOutput,
    Stack,
    RemovalPolicy,
    aws_s3 as s3,
    aws_dynamodb as dynamodb,
)
from constructs import Construct


class StorageStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        self.data_bucket = s3.Bucket(
            self, "DataBucket",
            bucket_name=f"cloudforge-data-{self.account}",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            cors=[
                s3.CorsRule(
                    allowed_methods=[s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
                    allowed_origins=["*"],
                    allowed_headers=["*"],
                    max_age=3600,
                )
            ],
        )

        self.projects_table = dynamodb.Table(
            self, "ProjectsTable",
            table_name="cloudforge-projects",
            partition_key=dynamodb.Attribute(name="userId", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(name="projectId", type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )

        self.jobs_table = dynamodb.Table(
            self, "JobsTable",
            table_name="cloudforge-jobs",
            partition_key=dynamodb.Attribute(name="projectId", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(name="jobId", type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )

        self.chats_table = dynamodb.Table(
            self, "ChatsTable",
            table_name="cloudforge-chats",
            partition_key=dynamodb.Attribute(name="userId", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(name="sessionId", type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )

        CfnOutput(self, "DataBucketName", value=self.data_bucket.bucket_name)
