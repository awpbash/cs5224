import json
import logging
import os
import tempfile

import boto3
import numpy as np
import pandas as pd

from shared.db import get_project, update_project
from shared.config import DATA_BUCKET

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
}


def _sanitize(obj):
    """Replace NaN/Infinity with None so DynamoDB doesn't choke."""
    if isinstance(obj, float):
        if obj != obj or obj == float('inf') or obj == float('-inf'):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(i) for i in obj]
    return obj


def _build_full_profile(df: pd.DataFrame) -> dict:
    """Build a complete data profile from a DataFrame."""
    columns = []
    for col in df.columns:
        profile = {
            "name": col,
            "dtype": str(df[col].dtype),
            "nullCount": int(df[col].isnull().sum()),
            "uniqueCount": int(df[col].nunique()),
        }
        if pd.api.types.is_numeric_dtype(df[col]):
            desc = df[col].describe()
            profile["mean"] = round(float(desc.get("mean", 0)), 4)
            profile["std"] = round(float(desc.get("std", 0)), 4)
            profile["min"] = round(float(desc.get("min", 0)), 4)
            profile["max"] = round(float(desc.get("max", 0)), 4)
            try:
                counts, edges = np.histogram(df[col].dropna(), bins=5)
                profile["distribution"] = [
                    {"bin": f"{edges[i]:.1f}-{edges[i+1]:.1f}", "count": int(counts[i])}
                    for i in range(len(counts))
                ]
            except Exception:
                pass
        else:
            try:
                top = df[col].value_counts().head(5)
                profile["topValues"] = [
                    {"value": str(v), "count": int(c)} for v, c in top.items()
                ]
            except Exception:
                pass
        columns.append(profile)

    preview = df.head(5).fillna("").astype(str).to_dict(orient="records")

    return {
        "rowCount": len(df),
        "columnCount": len(df.columns),
        "columns": columns,
        "preview": preview,
    }


def handler(event, context):
    try:
        user_id = event["requestContext"]["authorizer"]["claims"]["sub"]
        project_id = event["pathParameters"]["id"]
        body = json.loads(event.get("body", "{}"))

        project = get_project(user_id, project_id)
        if not project:
            return {"statusCode": 404, "headers": CORS_HEADERS,
                    "body": json.dumps({"error": "Project not found"})}

        dataset_path = project.get("datasetS3Path")
        if not dataset_path:
            return {"statusCode": 400, "headers": CORS_HEADERS,
                    "body": json.dumps({"error": "No dataset uploaded"})}

        target_col = body.get("targetColumn") or project.get("targetColumn")
        selected_features = body.get("selectedFeatures")
        full_profile = body.get("fullProfile", False)

        # Download CSV
        with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
            tmp_path = tmp.name
        s3.download_file(DATA_BUCKET, dataset_path, tmp_path)
        df = pd.read_csv(tmp_path)
        os.remove(tmp_path)

        result = {}

        # If fullProfile requested, build and save complete data profile
        if full_profile or not project.get("dataProfile"):
            data_profile = _build_full_profile(df)
            update_project(user_id, project_id, {
                "dataProfile": _sanitize(data_profile),
                "status": "PROFILED",
            })
            result["dataProfile"] = data_profile

        if not target_col or target_col not in df.columns:
            target_col = df.columns[-1]

        if selected_features:
            valid = [f for f in selected_features if f in df.columns and f != target_col]
            if valid:
                df = df[valid + [target_col]]

        # Correlation matrix
        try:
            numeric_cols = df.select_dtypes(include=["number"]).columns.tolist()
            if target_col in numeric_cols and len(numeric_cols) > 1:
                corr = df[numeric_cols].corr()
                result["correlation"] = {
                    col: {other: round(float(corr.loc[col, other]), 4)
                          for other in numeric_cols if other != col}
                    for col in numeric_cols[:10]
                }
        except Exception:
            pass

        # PCA
        try:
            from sklearn.decomposition import PCA
            from sklearn.preprocessing import StandardScaler

            numeric_df = df.select_dtypes(include=["number"]).dropna()
            if numeric_df.shape[1] >= 2 and numeric_df.shape[0] >= 10:
                n_components = min(numeric_df.shape[1], 10)
                scaled = StandardScaler().fit_transform(numeric_df)
                pca = PCA(n_components=n_components)
                pca.fit(scaled)
                result["pca"] = {
                    "varianceExplained": [round(float(v), 4) for v in pca.explained_variance_ratio_],
                    "cumulativeVariance": [round(float(v), 4) for v in np.cumsum(pca.explained_variance_ratio_)],
                    "components": n_components,
                    "featureNames": numeric_df.columns.tolist(),
                    "loadings": [
                        {
                            "pc": i + 1,
                            "topFeatures": [
                                {"feature": numeric_df.columns[j], "loading": round(float(pca.components_[i][j]), 4)}
                                for j in np.argsort(np.abs(pca.components_[i]))[::-1][:5]
                            ],
                        }
                        for i in range(min(2, n_components))
                    ],
                }
        except Exception:
            pass

        # Class balance / target distribution
        try:
            if pd.api.types.is_numeric_dtype(df[target_col]) and df[target_col].nunique() > 20:
                counts, edges = np.histogram(df[target_col].dropna(), bins=20)
                result["targetDistribution"] = {
                    "type": "numeric", "column": target_col,
                    "histogram": [
                        {"bin": f"{edges[i]:.1f}-{edges[i+1]:.1f}", "count": int(counts[i])}
                        for i in range(len(counts))
                    ],
                }
                result["classBalance"] = []
            elif df[target_col].nunique() <= 20:
                vc = df[target_col].value_counts()
                result["classBalance"] = [{"label": str(v), "count": int(c)} for v, c in vc.items()]
                result["targetDistribution"] = {}
        except Exception:
            pass

        return {"statusCode": 200, "headers": CORS_HEADERS, "body": json.dumps(result)}
    except Exception as e:
        logger.exception("recompute_profile failed")
        return {"statusCode": 500, "headers": CORS_HEADERS,
                "body": json.dumps({"error": str(e)})}
