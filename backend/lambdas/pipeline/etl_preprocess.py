import json
import logging
import os
import pickle
import tempfile

import boto3
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler

from shared.config import DATA_BUCKET
from shared.db import update_job

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")


def handler(event, context):
    job_id = event.get("jobId")
    project_id = event.get("projectId")
    try:
        return _run(event)
    except Exception as e:
        logger.exception("etl_preprocess failed")
        if job_id and project_id:
            update_job(project_id, job_id, {"status": "FAILED", "failureReason": str(e)[:500]})
        raise


def _run(event):
    user_id = event["userId"]
    project_id = event["projectId"]
    job_id = event.get("jobId")

    if job_id:
        update_job(project_id, job_id, {"status": "PREPROCESSING", "currentStep": "preprocessing"})
    dataset_s3_path = event["datasetS3Path"]
    task_type = event.get("taskType", "classification")

    # Read target and features from event (set by chat/profile pages)
    target_col = event.get("targetColumn")
    selected_features = event.get("selectedFeatures")

    tmp_path = tempfile.mktemp(suffix=".csv")
    s3.download_file(DATA_BUCKET, dataset_s3_path, tmp_path)
    df = pd.read_csv(tmp_path)
    os.remove(tmp_path)

    # Default target = last column if not specified
    if not target_col or target_col not in df.columns:
        target_col = df.columns[-1]
        logger.info("Using default target column: %s", target_col)

    # Filter to selected features + target
    if selected_features:
        valid_features = [f for f in selected_features if f in df.columns and f != target_col]
        if valid_features:
            df = df[valid_features + [target_col]]
            logger.info("Using %d selected features", len(valid_features))

    # --- Drop columns that are all null or constant ---
    for col in list(df.columns):
        if col == target_col:
            continue
        if df[col].isnull().all() or df[col].nunique() <= 1:
            df = df.drop(columns=[col])
            logger.info("Dropped constant/empty column: %s", col)

    # --- Convert boolean columns to int ---
    for col in df.select_dtypes(include=["bool"]).columns:
        df[col] = df[col].astype(int)

    # --- Handle datetime columns: extract numeric features ---
    for col in df.select_dtypes(include=["datetime64", "datetime64[ns]"]).columns:
        if col == target_col:
            continue
        df[f"{col}_year"] = df[col].dt.year.fillna(-1).astype(int)
        df[f"{col}_month"] = df[col].dt.month.fillna(-1).astype(int)
        df[f"{col}_dayofweek"] = df[col].dt.dayofweek.fillna(-1).astype(int)
        df = df.drop(columns=[col])
        logger.info("Expanded datetime column: %s", col)

    # --- Try to convert string columns that look numeric ---
    for col in df.select_dtypes(include=["object", "string"]).columns:
        if col == target_col:
            continue
        converted = pd.to_numeric(df[col], errors="coerce")
        if converted.notna().sum() > 0.5 * len(df):
            df[col] = converted
            logger.info("Converted %s to numeric", col)

    # --- Imputation ---
    for col in df.select_dtypes(include=["number"]).columns:
        if col != target_col:
            df[col] = df[col].fillna(df[col].median())
    for col in df.select_dtypes(include=["object", "string"]).columns:
        if col != target_col:
            mode = df[col].mode()
            df[col] = df[col].fillna(mode.iloc[0] if len(mode) > 0 else "unknown")

    # Drop rows where target is null
    df = df.dropna(subset=[target_col])

    # --- Drop high-cardinality string columns (>50 unique = probably IDs) ---
    for col in df.select_dtypes(include=["object", "string"]).columns:
        if col == target_col:
            continue
        if df[col].nunique() > 50:
            df = df.drop(columns=[col])
            logger.info("Dropped high-cardinality column: %s (%d unique)", col, df[col].nunique() if col in df.columns else 0)
            continue

    # --- Encode categorical features ---
    # Note: Label encoders are fitted on full data before split so that all
    # category values are mapped. This is acceptable for label encoding (unlike
    # scaling) because it only creates a mapping — no statistics are leaked.
    label_encoders = {}
    for col in df.select_dtypes(include=["object", "string"]).columns:
        if col == target_col:
            continue
        le = LabelEncoder()
        df[col] = le.fit_transform(df[col].astype(str))
        label_encoders[col] = {cls: int(idx) for idx, cls in enumerate(le.classes_)}

    # --- Encode target ---
    is_regression = task_type in ("regression", "sales_forecasting", "demand_forecasting")

    class_labels = []
    if is_regression:
        # For regression, target should be numeric — convert if needed
        df[target_col] = pd.to_numeric(df[target_col], errors="coerce")
        df = df.dropna(subset=[target_col])
    else:
        # For classification, label-encode the target
        target_le = LabelEncoder()
        df[target_col] = target_le.fit_transform(df[target_col].astype(str))
        class_labels = list(target_le.classes_)

    # --- Train/val split BEFORE scaling (prevents data leakage) ---
    feature_cols = [c for c in df.columns if c != target_col]
    X = df[feature_cols]
    y = df[target_col]

    train_split = event.get("trainSplit", 0.8)
    test_size = round(1.0 - train_split, 2)
    split_kwargs = {"test_size": test_size, "random_state": 42}
    if not is_regression and len(y.unique()) > 1:
        split_kwargs["stratify"] = y

    X_train, X_val, y_train, y_val = train_test_split(X, y, **split_kwargs)

    # --- Scale features (fit on train only to prevent data leakage) ---
    scaler = StandardScaler()
    X_train = pd.DataFrame(scaler.fit_transform(X_train), columns=feature_cols, index=X_train.index)
    X_val = pd.DataFrame(scaler.transform(X_val), columns=feature_cols, index=X_val.index)

    # --- Upload to S3 ---
    output_prefix = f"{user_id}/{project_id}/processed"
    for name, data in [("X_train", X_train), ("X_val", X_val), ("y_train", y_train), ("y_val", y_val)]:
        tmp_path = tempfile.mktemp(suffix=".csv")
        data.to_csv(tmp_path, index=False)
        s3.upload_file(tmp_path, DATA_BUCKET, f"{output_prefix}/{name}.csv")
        os.remove(tmp_path)

    # --- Save preprocessing pipeline for inference replay ---
    pipeline_pkl_path = tempfile.mktemp(suffix=".pkl")
    with open(pipeline_pkl_path, "wb") as f:
        pickle.dump({
            "scaler": scaler,
            "label_encoders": label_encoders,
            "feature_columns": feature_cols,
            "target_column": target_col,
            "is_regression": is_regression,
            "class_labels": class_labels,
        }, f)
    s3.upload_file(pipeline_pkl_path, DATA_BUCKET, f"{output_prefix}/pipeline.pkl")
    os.remove(pipeline_pkl_path)
    logger.info("Saved preprocessing pipeline.pkl")

    # --- Compute correlation matrix for analysis ---
    corr_data = {}
    try:
        numeric_df = df[feature_cols + [target_col]].select_dtypes(include=["number"])
        if len(numeric_df.columns) > 1:
            corr = numeric_df.corr()
            # Get top correlations with target
            if target_col in corr.columns:
                target_corr = corr[target_col].drop(target_col).abs().sort_values(ascending=False)
                corr_data = {
                    "targetCorrelations": {col: round(float(val), 4) for col, val in target_corr.head(10).items()},
                }
    except Exception:
        pass

    metadata = {
        "featureColumns": feature_cols,
        "targetColumn": target_col,
        "classLabels": class_labels,
        "labelEncoders": label_encoders,
        "trainRows": len(X_train),
        "valRows": len(X_val),
        "isRegression": is_regression,
        **corr_data,
    }
    s3.put_object(
        Bucket=DATA_BUCKET,
        Key=f"{output_prefix}/metadata.json",
        Body=json.dumps(metadata),
        ContentType="application/json",
    )

    return {
        **event,
        "processedS3Path": f"{output_prefix}/",
        "classLabels": class_labels,
        "featureColumns": feature_cols,
        "targetColumn": target_col,
        "isRegression": is_regression,
    }
