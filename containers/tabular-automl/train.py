"""RetailMind AutoML training container.

Modes:
  MODE=auto    — tries multiple models with CV, picks the best, saves leaderboard
  MODE=single  — trains one specific model (MODEL_TYPE env var)

Environment variables:
  DATA_S3_PATH    s3://bucket/users/{userId}/{projectId}/processed/
  OUTPUT_S3_PATH  s3://bucket/users/{userId}/{projectId}/models/{jobId}/
  TASK_TYPE       "classification" | "regression"
  MODE            "auto" | "single"  (default: auto)
  MODEL_TYPE      model name for single mode (e.g. "xgboost_clf")
  HYPERPARAMS     JSON string of hyperparameter overrides
  CV_FOLDS        number of CV folds (default: 5)
  MAX_CANDIDATES  max models to try in auto mode (default: 8)
"""

from __future__ import annotations

import json
import logging
import os
import pickle
import sys
import tempfile
import time

import boto3
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
)
from sklearn.model_selection import RandomizedSearchCV, cross_val_score

from models import get_model_by_name, select_auto_candidates

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("retailmind-automl")

s3 = boto3.client("s3")


# ── S3 helpers ───────────────────────────────────────────────────────────────

def parse_s3_path(s3_path: str) -> tuple[str, str]:
    path = s3_path.replace("s3://", "")
    bucket = path.split("/")[0]
    key = "/".join(path.split("/")[1:])
    return bucket, key


def download_csv(bucket: str, key: str) -> pd.DataFrame:
    tmp_path = tempfile.mktemp(suffix=".csv")
    s3.download_file(bucket, key, tmp_path)
    df = pd.read_csv(tmp_path)
    os.remove(tmp_path)
    return df


def upload_bytes(bucket: str, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    s3.put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)


def upload_json(bucket: str, key: str, obj: dict) -> None:
    upload_bytes(bucket, key, json.dumps(obj, indent=2).encode(), "application/json")


def upload_pickle(bucket: str, key: str, obj: object) -> None:
    tmp_path = tempfile.mktemp(suffix=".pkl")
    with open(tmp_path, "wb") as f:
        pickle.dump(obj, f)
    s3.upload_file(tmp_path, bucket, key)
    os.remove(tmp_path)


# ── Metrics ──────────────────────────────────────────────────────────────────

def compute_classification_metrics(y_true: pd.Series, y_pred: np.ndarray) -> dict:
    return {
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "precision": round(float(precision_score(y_true, y_pred, average="weighted", zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, y_pred, average="weighted", zero_division=0)), 4),
        "f1": round(float(f1_score(y_true, y_pred, average="weighted", zero_division=0)), 4),
        "confusionMatrix": confusion_matrix(y_true, y_pred).tolist(),
        "classLabels": [str(c) for c in sorted(y_true.unique())],
    }


def compute_regression_metrics(y_true: pd.Series, y_pred: np.ndarray) -> dict:
    return {
        "r2": round(float(r2_score(y_true, y_pred)), 4),
        "mae": round(float(mean_absolute_error(y_true, y_pred)), 4),
        "rmse": round(float(np.sqrt(mean_squared_error(y_true, y_pred))), 4),
        "mse": round(float(mean_squared_error(y_true, y_pred)), 4),
    }


def compute_metrics(task_type: str, y_true: pd.Series, y_pred: np.ndarray) -> dict:
    if task_type == "classification":
        return compute_classification_metrics(y_true, y_pred)
    return compute_regression_metrics(y_true, y_pred)


def primary_metric(task_type: str) -> str:
    return "f1" if task_type == "classification" else "r2"


def scoring_metric(task_type: str) -> str:
    return "f1_weighted" if task_type == "classification" else "r2"


# ── Feature importance ───────────────────────────────────────────────────────

def extract_feature_importance(model: object, columns: list[str]) -> list[dict]:
    importances = None

    if hasattr(model, "feature_importances_"):
        importances = model.feature_importances_
    elif hasattr(model, "coef_"):
        coef = np.array(model.coef_)
        if coef.ndim > 1:
            coef = np.mean(np.abs(coef), axis=0)
        else:
            coef = np.abs(coef)
        importances = coef

    if importances is None:
        return []

    fi = [
        {"feature": col, "importance": round(float(imp), 4)}
        for col, imp in zip(columns, importances)
    ]
    return sorted(fi, key=lambda x: -x["importance"])


# ── Auto mode: try multiple models ──────────────────────────────────────────

def run_auto(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_val: pd.DataFrame,
    y_val: pd.Series,
    task_type: str,
    cv_folds: int,
    max_candidates: int,
    candidate_model_names: list[str] | None = None,
) -> tuple[object, dict, list[dict]]:
    """Try multiple models, rank by CV score, return best model + leaderboard."""

    if candidate_model_names:
        # User specified exact models — use those
        candidates = []
        for name in candidate_model_names:
            spec = get_model_by_name(name)
            if spec:
                candidates.append(spec)
        if not candidates:
            logger.warning("No valid candidate models found from %s, falling back to auto", candidate_model_names)
            candidates = select_auto_candidates(task_type, len(X_train))
    else:
        candidates = select_auto_candidates(task_type, len(X_train))

    if len(candidates) > max_candidates:
        candidates = candidates[:max_candidates]

    logger.info(
        "AutoML: trying %d models for %s (%d rows, %d features)",
        len(candidates), task_type, len(X_train), X_train.shape[1],
    )

    scoring = scoring_metric(task_type)
    leaderboard: list[dict] = []
    best_score = -np.inf
    best_model = None
    best_name = ""

    for spec in candidates:
        t0 = time.time()
        try:
            model = spec.build()

            # Quick cross-validation score
            cv_scores = cross_val_score(
                model, X_train, y_train,
                cv=min(cv_folds, len(X_train)),
                scoring=scoring,
                n_jobs=-1,
            )
            mean_cv = float(np.mean(cv_scores))
            std_cv = float(np.std(cv_scores))

            # If model has a search grid and dataset isn't huge, do a quick random search
            if spec.search_grid and len(X_train) <= 50_000:
                search = RandomizedSearchCV(
                    spec.build(),
                    spec.search_grid,
                    n_iter=min(6, _grid_size(spec.search_grid)),
                    cv=min(3, len(X_train)),
                    scoring=scoring,
                    n_jobs=-1,
                    random_state=42,
                    refit=True,
                )
                search.fit(X_train, y_train)
                model = search.best_estimator_
                mean_cv = float(search.best_score_)
            else:
                model.fit(X_train, y_train)

            duration = round(time.time() - t0, 1)

            # Evaluate on validation set
            y_pred = model.predict(X_val)
            metrics = compute_metrics(task_type, y_val, y_pred)
            val_score = metrics[primary_metric(task_type)]

            entry = {
                "model": spec.name,
                "cv_score": round(mean_cv, 4),
                "cv_std": round(std_cv, 4),
                "val_score": val_score,
                "duration_sec": duration,
                "params": _get_params(model),
                **metrics,
            }
            leaderboard.append(entry)

            logger.info(
                "  %-25s  CV=%.4f  Val=%.4f  (%.1fs)",
                spec.name, mean_cv, val_score, duration,
            )

            if val_score > best_score:
                best_score = val_score
                best_model = model
                best_name = spec.name

        except Exception as e:
            logger.warning("  %-25s  FAILED: %s", spec.name, str(e))
            leaderboard.append({
                "model": spec.name,
                "error": str(e),
                "duration_sec": round(time.time() - t0, 1),
            })

    # Sort leaderboard by val_score descending
    leaderboard.sort(key=lambda x: x.get("val_score", -999), reverse=True)

    # Mark the best
    for entry in leaderboard:
        entry["is_best"] = entry.get("model") == best_name

    logger.info("Best model: %s (val %s=%.4f)", best_name, primary_metric(task_type), best_score)

    # Re-compute metrics for the best model
    y_pred = best_model.predict(X_val)  # type: ignore[union-attr]
    final_metrics = compute_metrics(task_type, y_val, y_pred)
    final_metrics["modelType"] = best_name
    final_metrics["featureImportance"] = extract_feature_importance(best_model, list(X_train.columns))

    return best_model, final_metrics, leaderboard  # type: ignore[return-value]


# ── Single mode: train one model ────────────────────────────────────────────

def run_single(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_val: pd.DataFrame,
    y_val: pd.Series,
    task_type: str,
    model_type: str,
    hyperparams: dict,
) -> tuple[object, dict]:
    """Train a single specified model."""

    spec = get_model_by_name(model_type)
    if spec is None:
        raise ValueError(f"Unknown model: {model_type}")
    if not spec.supports(task_type):
        raise ValueError(f"Model {model_type} does not support {task_type}")

    logger.info("Training %s (%d rows, %d features)", model_type, len(X_train), X_train.shape[1])

    model = spec.build(hyperparams)
    model.fit(X_train, y_train)

    y_pred = model.predict(X_val)
    metrics = compute_metrics(task_type, y_val, y_pred)
    metrics["modelType"] = spec.name
    metrics["featureImportance"] = extract_feature_importance(model, list(X_train.columns))

    logger.info("Metrics: %s", {k: v for k, v in metrics.items() if k != "featureImportance"})

    return model, metrics


# ── Helpers ──────────────────────────────────────────────────────────────────

def _grid_size(grid: dict) -> int:
    size = 1
    for v in grid.values():
        size *= len(v)
    return size


def _get_params(model: object) -> dict:
    if hasattr(model, "get_params"):
        params = model.get_params()
        # Only keep serializable scalar params
        return {
            k: v for k, v in params.items()
            if isinstance(v, (int, float, str, bool, type(None)))
        }
    return {}


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    data_s3_path = os.environ["DATA_S3_PATH"]
    output_s3_path = os.environ["OUTPUT_S3_PATH"]
    task_type = os.environ.get("TASK_TYPE", "classification")
    mode = os.environ.get("MODE", "auto")
    model_type = os.environ.get("MODEL_TYPE", "xgboost_clf")
    hyperparams = json.loads(os.environ.get("HYPERPARAMS", "{}"))
    cv_folds = int(os.environ.get("CV_FOLDS", "5"))
    max_candidates = int(os.environ.get("MAX_CANDIDATES", "8"))

    bucket, prefix = parse_s3_path(data_s3_path)

    logger.info("Loading data from %s", data_s3_path)
    X_train = download_csv(bucket, f"{prefix}X_train.csv")
    X_val = download_csv(bucket, f"{prefix}X_val.csv")
    y_train = download_csv(bucket, f"{prefix}y_train.csv").iloc[:, 0]
    y_val = download_csv(bucket, f"{prefix}y_val.csv").iloc[:, 0]

    logger.info("Data: %d train, %d val, %d features, task=%s, mode=%s",
                len(X_train), len(X_val), X_train.shape[1], task_type, mode)

    # Validate data before training
    if len(X_train) == 0:
        raise ValueError("Training set is empty — no rows to train on")
    if task_type == "classification":
        n_classes = y_train.nunique()
        if n_classes < 2:
            raise ValueError(
                f"Classification requires at least 2 classes in the target, "
                f"but found {n_classes}. Check your target column or task type."
            )

    t_start = time.time()

    # Support user-specified candidate models via env var
    candidate_models_str = os.environ.get("CANDIDATE_MODELS", "")
    candidate_model_names = [m.strip() for m in candidate_models_str.split(",") if m.strip()] if candidate_models_str else []

    if mode == "auto":
        model, metrics, leaderboard = run_auto(
            X_train, y_train, X_val, y_val,
            task_type, cv_folds, max_candidates,
            candidate_model_names=candidate_model_names or None,
        )
    elif mode == "single":
        model, metrics = run_single(
            X_train, y_train, X_val, y_val,
            task_type, model_type, hyperparams,
        )
        leaderboard = []
    else:
        raise ValueError(f"Unknown MODE: {mode}")

    total_duration = round(time.time() - t_start, 1)
    metrics["trainingDurationSec"] = total_duration

    # ── Upload artifacts ─────────────────────────────────────────
    out_bucket, out_prefix = parse_s3_path(output_s3_path)

    upload_pickle(out_bucket, f"{out_prefix}model.pkl", model)
    logger.info("Uploaded model.pkl")

    upload_json(out_bucket, f"{out_prefix}metrics.json", metrics)
    logger.info("Uploaded metrics.json")

    if leaderboard:
        upload_json(out_bucket, f"{out_prefix}leaderboard.json", {
            "task_type": task_type,
            "n_train": len(X_train),
            "n_val": len(X_val),
            "n_features": X_train.shape[1],
            "total_duration_sec": total_duration,
            "models": leaderboard,
        })
        logger.info("Uploaded leaderboard.json (%d models tried)", len(leaderboard))

    config = {
        "mode": mode,
        "task_type": task_type,
        "model_type": metrics.get("modelType", model_type),
        "hyperparams": _get_params(model),
        "data": {
            "n_train": len(X_train),
            "n_val": len(X_val),
            "n_features": X_train.shape[1],
            "features": list(X_train.columns),
        },
    }
    upload_json(out_bucket, f"{out_prefix}config.json", config)
    logger.info("Uploaded config.json")

    logger.info("Done in %.1fs. Best model: %s", total_duration, metrics.get("modelType"))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        logger.exception("Training failed")
        sys.exit(1)
