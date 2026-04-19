#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "Building sklearn layer (pipeline Lambdas only — inference uses container image)..."
rm -rf sklearn-layer sklearn-layer.zip
docker run --rm --entrypoint bash -v "$(pwd):/out" public.ecr.aws/lambda/python:3.12 -c \
  "pip install scikit-learn -t /out/sklearn-layer/python/ --no-cache-dir && \
   rm -rf /out/sklearn-layer/python/nvidia* && \
   dnf install -y zip && \
   cd /out/sklearn-layer && zip -r /out/sklearn-layer.zip python/"
rm -rf sklearn-layer

echo "Done! Layers built:"
ls -lh *.zip
