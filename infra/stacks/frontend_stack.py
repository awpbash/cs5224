from pathlib import Path

from aws_cdk import (
    CfnOutput,
    RemovalPolicy,
    Stack,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_s3 as s3,
    aws_s3_deployment as s3_deploy,
)
from constructs import Construct

FRONTEND_OUT = str(Path(__file__).resolve().parent.parent.parent / "frontend" / "out")


class FrontendStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        bucket = s3.Bucket(
            self, "FrontendBucket",
            bucket_name=f"cloudforge-frontend-{self.account}",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
        )

        oai = cloudfront.OriginAccessIdentity(self, "OAI")
        bucket.grant_read(oai)

        # CloudFront Function: rewrite /projects/{unknown-id}/subpage/
        # to /projects/proj_001/subpage/index.html so Next.js client router
        # can hydrate with the correct page shell, then useParams() reads
        # the REAL id from window.location
        rewrite_fn = cloudfront.Function(
            self, "SpaRewriteFunction",
            code=cloudfront.FunctionCode.from_inline(
                "function handler(event) {\n"
                "  var request = event.request;\n"
                "  var uri = request.uri;\n"
                "  if (uri.match(/\\.[a-zA-Z0-9]+$/)) { return request; }\n"
                "  var m = uri.match(/^\\/projects\\/([^\\/]+)(\\/.+)?$/);\n"
                "  if (m) {\n"
                "    var id = m[1];\n"
                "    var sub = m[2] || '/';\n"
                "    var known = ['proj_001','proj_002','proj_003','demo_project','new'];\n"
                "    if (known.indexOf(id) === -1) {\n"
                "      request.uri = '/projects/proj_001' + sub;\n"
                "      if (!request.uri.endsWith('/')) request.uri += '/';\n"
                "      request.uri += 'index.html';\n"
                "      return request;\n"
                "    }\n"
                "  }\n"
                "  if (uri.endsWith('/')) { request.uri += 'index.html'; }\n"
                "  else if (!uri.includes('.')) { request.uri += '/index.html'; }\n"
                "  return request;\n"
                "}\n"
            ),
            function_name="cloudforge-spa-rewrite",
        )

        self.distribution = cloudfront.Distribution(
            self, "CloudForgeCDN",
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3Origin(bucket, origin_access_identity=oai),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                function_associations=[
                    cloudfront.FunctionAssociation(
                        function=rewrite_fn,
                        event_type=cloudfront.FunctionEventType.VIEWER_REQUEST,
                    ),
                ],
            ),
            default_root_object="index.html",
            error_responses=[
                cloudfront.ErrorResponse(
                    http_status=404,
                    response_http_status=200,
                    response_page_path="/index.html",
                    ttl=None,
                ),
                cloudfront.ErrorResponse(
                    http_status=403,
                    response_http_status=200,
                    response_page_path="/index.html",
                    ttl=None,
                ),
            ],
        )

        s3_deploy.BucketDeployment(
            self, "DeployFrontend",
            sources=[s3_deploy.Source.asset(FRONTEND_OUT)],
            destination_bucket=bucket,
            distribution=self.distribution,
            distribution_paths=["/*"],
        )

        CfnOutput(self, "CloudFrontDomain", value=self.distribution.distribution_domain_name)
