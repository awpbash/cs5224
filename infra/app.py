#!/usr/bin/env python3
import aws_cdk as cdk

from stacks.network_stack import NetworkStack
from stacks.storage_stack import StorageStack
from stacks.auth_stack import AuthStack
from stacks.pipeline_stack import PipelineStack
from stacks.api_stack import ApiStack
from stacks.frontend_stack import FrontendStack
from stacks.monitoring_stack import MonitoringStack

app = cdk.App()

env = cdk.Environment(region="ap-southeast-1")
tags = {"project": "retailmind", "environment": "dev"}

network = NetworkStack(app, "CloudForgeNetwork", env=env)
storage = StorageStack(app, "CloudForgeStorage", env=env)
auth = AuthStack(app, "CloudForgeAuth", env=env)

pipeline = PipelineStack(
    app, "CloudForgePipeline",
    vpc=network.vpc,
    data_bucket=storage.data_bucket,
    projects_table=storage.projects_table,
    jobs_table=storage.jobs_table,
    env=env,
)
pipeline.add_dependency(network)
pipeline.add_dependency(storage)

api = ApiStack(
    app, "CloudForgeApi",
    data_bucket=storage.data_bucket,
    projects_table=storage.projects_table,
    jobs_table=storage.jobs_table,
    chats_table=storage.chats_table,
    user_pool=auth.user_pool,
    state_machine=pipeline.state_machine,
    env=env,
)
api.add_dependency(storage)
api.add_dependency(auth)
api.add_dependency(pipeline)

frontend = FrontendStack(app, "CloudForgeFrontend", env=env)

monitoring = MonitoringStack(
    app, "CloudForgeMonitoring",
    api=api.api,
    state_machine=pipeline.state_machine,
    env=env,
)
monitoring.add_dependency(api)
monitoring.add_dependency(pipeline)

for stack in [network, storage, auth, pipeline, api, frontend, monitoring]:
    for k, v in tags.items():
        cdk.Tags.of(stack).add(k, v)

app.synth()
