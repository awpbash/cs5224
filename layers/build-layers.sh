#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "Building sklearn layer..."
rm -rf sklearn-layer sklearn-layer.zip
docker run --rm -v "$(pwd):/out" public.ecr.aws/lambda/python:3.12 bash -c \
  "pip install scikit-learn -t /out/sklearn-layer/python/ --no-cache-dir && \
   cd /out/sklearn-layer && zip -r /out/sklearn-layer.zip python/"
rm -rf sklearn-layer

echo "Done! Layers built:"
ls -lh *.zip
