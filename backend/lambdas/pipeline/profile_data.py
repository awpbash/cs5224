import json
import logging
import os
import tempfile

import boto3
import numpy as np
import pandas as pd

from shared.config import DATA_BUCKET
from shared.db import update_project, update_job

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")


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


def handler(event, context):
    job_id = event.get("jobId")
    project_id = event.get("projectId")
    try:
        return _run(event)
    except Exception as e:
        logger.exception("profile_data failed")
        if job_id and project_id:
            update_job(project_id, job_id, {"status": "FAILED", "failureReason": str(e)[:500]})
        raise


def _run(event):
    user_id = event["userId"]
    project_id = event["projectId"]
    job_id = event.get("jobId")
    dataset_s3_path = event["datasetS3Path"]

    if job_id:
        update_job(project_id, job_id, {"status": "PROFILING", "currentStep": "profiling"})

    tmp_path = tempfile.mktemp(suffix=".csv")
    s3.download_file(DATA_BUCKET, dataset_s3_path, tmp_path)
    df = pd.read_csv(tmp_path)
    os.remove(tmp_path)

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

            # Distribution histogram (5 bins)
            try:
                counts, edges = np.histogram(df[col].dropna(), bins=5)
                profile["distribution"] = [
                    {"bin": f"{edges[i]:.1f}-{edges[i+1]:.1f}", "count": int(counts[i])}
                    for i in range(len(counts))
                ]
            except Exception:
                pass
        else:
            # Top values for categorical columns
            try:
                top = df[col].value_counts().head(5)
                profile["topValues"] = [
                    {"value": str(v), "count": int(c)} for v, c in top.items()
                ]
            except Exception:
                pass

        columns.append(profile)

    preview = df.head(5).fillna("").astype(str).to_dict(orient="records")

    # Correlation matrix for numeric columns
    correlation = {}
    try:
        numeric_cols = df.select_dtypes(include=["number"]).columns.tolist()
        if len(numeric_cols) > 1:
            corr = df[numeric_cols].corr()
            # Store as nested dict (top correlations)
            correlation = {
                col: {
                    other: round(float(corr.loc[col, other]), 4)
                    for other in numeric_cols if other != col
                }
                for col in numeric_cols[:10]  # limit to first 10 for size
            }
    except Exception:
        pass

    # Class balance for the last column (likely target)
    class_balance = []
    try:
        last_col = df.columns[-1]
        if df[last_col].dtype == "object" or df[last_col].nunique() <= 20:
            vc = df[last_col].value_counts()
            class_balance = [
                {"label": str(v), "count": int(c)} for v, c in vc.items()
            ]
    except Exception:
        pass

    # PCA analysis on numeric columns
    pca_result = {}
    try:
        from sklearn.decomposition import PCA
        from sklearn.preprocessing import StandardScaler

        numeric_df = df.select_dtypes(include=["number"]).dropna()
        if numeric_df.shape[1] >= 2 and numeric_df.shape[0] >= 10:
            n_components = min(numeric_df.shape[1], 10)
            scaler = StandardScaler()
            scaled = scaler.fit_transform(numeric_df)
            pca = PCA(n_components=n_components)
            pca.fit(scaled)
            pca_result = {
                "varianceExplained": [round(float(v), 4) for v in pca.explained_variance_ratio_],
                "cumulativeVariance": [round(float(v), 4) for v in np.cumsum(pca.explained_variance_ratio_)],
                "components": n_components,
                "featureNames": numeric_df.columns.tolist(),
                # Top loadings for first 2 PCs
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

    # Target distribution (for numeric targets — histogram; for categorical — value counts)
    target_distribution = {}
    try:
        last_col = df.columns[-1]
        if pd.api.types.is_numeric_dtype(df[last_col]) and df[last_col].nunique() > 20:
            counts, edges = np.histogram(df[last_col].dropna(), bins=20)
            target_distribution = {
                "type": "numeric",
                "column": last_col,
                "histogram": [
                    {"bin": f"{edges[i]:.1f}-{edges[i+1]:.1f}", "count": int(counts[i])}
                    for i in range(len(counts))
                ],
            }
    except Exception:
        pass

    data_profile = {
        "rowCount": len(df),
        "columnCount": len(df.columns),
        "columns": columns,
        "preview": preview,
        "correlation": correlation,
        "classBalance": class_balance,
        "pca": pca_result,
        "targetDistribution": target_distribution,
    }

    update_project(user_id, project_id, {"dataProfile": _sanitize(data_profile)})

    profile_key = f"{user_id}/{project_id}/profile.json"
    s3.put_object(
        Bucket=DATA_BUCKET,
        Key=profile_key,
        Body=json.dumps(data_profile),
        ContentType="application/json",
    )

    return {**event, "dataProfile": data_profile, "profileS3Path": profile_key}
