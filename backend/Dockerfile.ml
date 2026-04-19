FROM public.ecr.aws/lambda/python:3.12

# Install ML libraries — container image Lambdas have 10GB limit (not 250MB)
RUN pip install --no-cache-dir \
    scikit-learn \
    xgboost \
    lightgbm \
    pandas \
    numpy \
    boto3 \
    pydantic

# Copy backend code from build context (context = backend/)
COPY shared/ ${LAMBDA_TASK_ROOT}/shared/
COPY lambdas/api/run_inference.py ${LAMBDA_TASK_ROOT}/api/run_inference.py
COPY lambdas/api/recompute_profile.py ${LAMBDA_TASK_ROOT}/api/recompute_profile.py
COPY lambdas/api/__init__.py ${LAMBDA_TASK_ROOT}/api/__init__.py
COPY lambdas/pipeline/profile_data.py ${LAMBDA_TASK_ROOT}/pipeline/profile_data.py
COPY lambdas/pipeline/etl_preprocess.py ${LAMBDA_TASK_ROOT}/pipeline/etl_preprocess.py
COPY lambdas/pipeline/__init__.py ${LAMBDA_TASK_ROOT}/pipeline/__init__.py

# Default handler — overridden per function in CDK
CMD ["api.run_inference.handler"]
