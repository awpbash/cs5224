from aws_cdk import (
    Duration,
    Stack,
    aws_apigateway as apigw,
    aws_cloudwatch as cw,
    aws_stepfunctions as sfn,
)
from constructs import Construct


class MonitoringStack(Stack):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        api: apigw.RestApi,
        state_machine: sfn.IStateMachine,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        dashboard = cw.Dashboard(
            self, "CloudForgeDashboard",
            dashboard_name="cloudforge-dashboard",
        )

        # API Gateway metrics
        dashboard.add_widgets(
            cw.GraphWidget(
                title="API Gateway Requests",
                left=[
                    api.metric_count(period=Duration.minutes(5)),
                ],
                width=12,
            ),
            cw.GraphWidget(
                title="API Gateway Errors",
                left=[
                    api.metric_client_error(period=Duration.minutes(5)),
                    api.metric_server_error(period=Duration.minutes(5)),
                ],
                width=12,
            ),
        )

        # API latency
        dashboard.add_widgets(
            cw.GraphWidget(
                title="API Latency",
                left=[
                    api.metric_latency(period=Duration.minutes(5)),
                ],
                width=12,
            ),
        )

        # Step Functions metrics
        dashboard.add_widgets(
            cw.GraphWidget(
                title="Pipeline Executions",
                left=[
                    state_machine.metric_started(period=Duration.minutes(5)),
                    state_machine.metric_succeeded(period=Duration.minutes(5)),
                    state_machine.metric_failed(period=Duration.minutes(5)),
                ],
                width=12,
            ),
            cw.GraphWidget(
                title="Pipeline Duration",
                left=[
                    state_machine.metric_time(period=Duration.minutes(5)),
                ],
                width=12,
            ),
        )
