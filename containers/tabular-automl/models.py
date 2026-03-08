"""Model registry — every model RetailMind can train.

Each entry defines the estimator constructor, default hyperparameters,
a search grid for auto-tuning, and which task types it supports.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from sklearn.ensemble import (
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.linear_model import (
    ElasticNet,
    Lasso,
    LinearRegression,
    LogisticRegression,
    Ridge,
)
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
from sklearn.svm import SVC, SVR
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor

import xgboost as xgb
import lightgbm as lgb


# ── Registry type ────────────────────────────────────────────────────────────

class ModelSpec:
    def __init__(
        self,
        name: str,
        task: str,                         # "classification" | "regression" | "both"
        constructor: Any,
        defaults: dict[str, Any],
        search_grid: dict[str, list[Any]],
    ) -> None:
        self.name = name
        self.task = task
        self.constructor = constructor
        self.defaults = defaults
        self.search_grid = search_grid

    def build(self, overrides: dict[str, Any] | None = None) -> Any:
        params = {**self.defaults}
        if overrides:
            for k, v in overrides.items():
                if k in params or k in self.search_grid:
                    params[k] = type(self.defaults.get(k, v))(v) if k in self.defaults else v
        return self.constructor(**params)

    def supports(self, task_type: str) -> bool:
        return self.task == "both" or self.task == task_type


# ── Classification models ────────────────────────────────────────────────────

MODELS: list[ModelSpec] = [
    # ── Linear ───────────────────────────────────────────────────
    ModelSpec(
        "logistic_regression", "classification",
        LogisticRegression,
        {"max_iter": 1000, "random_state": 42, "n_jobs": -1},
        {"C": [0.01, 0.1, 1.0, 10.0]},
    ),
    ModelSpec(
        "linear_regression", "regression",
        LinearRegression,
        {"n_jobs": -1},
        {},
    ),
    ModelSpec(
        "ridge", "regression",
        Ridge,
        {"alpha": 1.0, "random_state": 42},
        {"alpha": [0.01, 0.1, 1.0, 10.0, 100.0]},
    ),
    ModelSpec(
        "lasso", "regression",
        Lasso,
        {"alpha": 1.0, "max_iter": 5000, "random_state": 42},
        {"alpha": [0.001, 0.01, 0.1, 1.0, 10.0]},
    ),
    ModelSpec(
        "elasticnet", "regression",
        ElasticNet,
        {"alpha": 1.0, "l1_ratio": 0.5, "max_iter": 5000, "random_state": 42},
        {"alpha": [0.01, 0.1, 1.0], "l1_ratio": [0.2, 0.5, 0.8]},
    ),

    # ── Tree-based ───────────────────────────────────────────────
    ModelSpec(
        "decision_tree_clf", "classification",
        DecisionTreeClassifier,
        {"max_depth": 10, "random_state": 42},
        {"max_depth": [5, 10, 20, None], "min_samples_split": [2, 5, 10]},
    ),
    ModelSpec(
        "decision_tree_reg", "regression",
        DecisionTreeRegressor,
        {"max_depth": 10, "random_state": 42},
        {"max_depth": [5, 10, 20, None], "min_samples_split": [2, 5, 10]},
    ),
    ModelSpec(
        "random_forest_clf", "classification",
        RandomForestClassifier,
        {"n_estimators": 200, "max_depth": 10, "random_state": 42, "n_jobs": -1},
        {"n_estimators": [100, 200, 500], "max_depth": [5, 10, 20, None]},
    ),
    ModelSpec(
        "random_forest_reg", "regression",
        RandomForestRegressor,
        {"n_estimators": 200, "max_depth": 10, "random_state": 42, "n_jobs": -1},
        {"n_estimators": [100, 200, 500], "max_depth": [5, 10, 20, None]},
    ),
    ModelSpec(
        "gradient_boosting_clf", "classification",
        GradientBoostingClassifier,
        {"n_estimators": 200, "max_depth": 5, "learning_rate": 0.1, "random_state": 42},
        {"n_estimators": [100, 200], "max_depth": [3, 5, 7], "learning_rate": [0.05, 0.1, 0.2]},
    ),
    ModelSpec(
        "gradient_boosting_reg", "regression",
        GradientBoostingRegressor,
        {"n_estimators": 200, "max_depth": 5, "learning_rate": 0.1, "random_state": 42},
        {"n_estimators": [100, 200], "max_depth": [3, 5, 7], "learning_rate": [0.05, 0.1, 0.2]},
    ),

    # ── XGBoost ──────────────────────────────────────────────────
    ModelSpec(
        "xgboost_clf", "classification",
        xgb.XGBClassifier,
        {
            "n_estimators": 300, "max_depth": 6, "learning_rate": 0.1,
            "eval_metric": "logloss", "random_state": 42,
            "n_jobs": -1, "verbosity": 0,
        },
        {"n_estimators": [200, 300, 500], "max_depth": [4, 6, 8], "learning_rate": [0.05, 0.1, 0.2]},
    ),
    ModelSpec(
        "xgboost_reg", "regression",
        xgb.XGBRegressor,
        {
            "n_estimators": 300, "max_depth": 6, "learning_rate": 0.1,
            "eval_metric": "rmse", "random_state": 42,
            "n_jobs": -1, "verbosity": 0,
        },
        {"n_estimators": [200, 300, 500], "max_depth": [4, 6, 8], "learning_rate": [0.05, 0.1, 0.2]},
    ),

    # ── LightGBM ─────────────────────────────────────────────────
    ModelSpec(
        "lightgbm_clf", "classification",
        lgb.LGBMClassifier,
        {
            "n_estimators": 300, "max_depth": -1, "learning_rate": 0.1,
            "num_leaves": 31, "random_state": 42, "n_jobs": -1, "verbose": -1,
        },
        {"n_estimators": [200, 300, 500], "num_leaves": [15, 31, 63], "learning_rate": [0.05, 0.1, 0.2]},
    ),
    ModelSpec(
        "lightgbm_reg", "regression",
        lgb.LGBMRegressor,
        {
            "n_estimators": 300, "max_depth": -1, "learning_rate": 0.1,
            "num_leaves": 31, "random_state": 42, "n_jobs": -1, "verbose": -1,
        },
        {"n_estimators": [200, 300, 500], "num_leaves": [15, 31, 63], "learning_rate": [0.05, 0.1, 0.2]},
    ),

    # ── KNN ──────────────────────────────────────────────────────
    ModelSpec(
        "knn_clf", "classification",
        KNeighborsClassifier,
        {"n_neighbors": 5, "n_jobs": -1},
        {"n_neighbors": [3, 5, 7, 11, 15]},
    ),
    ModelSpec(
        "knn_reg", "regression",
        KNeighborsRegressor,
        {"n_neighbors": 5, "n_jobs": -1},
        {"n_neighbors": [3, 5, 7, 11, 15]},
    ),

    # ── SVM ──────────────────────────────────────────────────────
    ModelSpec(
        "svm_clf", "classification",
        SVC,
        {"kernel": "rbf", "probability": True, "random_state": 42},
        {"C": [0.1, 1.0, 10.0], "kernel": ["rbf", "linear"]},
    ),
    ModelSpec(
        "svm_reg", "regression",
        SVR,
        {"kernel": "rbf"},
        {"C": [0.1, 1.0, 10.0], "kernel": ["rbf", "linear"]},
    ),
]


def get_models_for_task(task_type: str) -> list[ModelSpec]:
    return [m for m in MODELS if m.supports(task_type)]


def get_model_by_name(name: str) -> ModelSpec | None:
    for m in MODELS:
        if m.name == name:
            return m
    # Allow short names without _clf/_reg suffix
    for m in MODELS:
        if m.name.startswith(name):
            return m
    return None


def select_auto_candidates(task_type: str, n_rows: int) -> list[ModelSpec]:
    """Pick a smart subset of models to try based on dataset size."""
    all_models = get_models_for_task(task_type)

    if n_rows > 50_000:
        # Large dataset: skip slow models (SVM, KNN)
        skip = {"svm_clf", "svm_reg", "knn_clf", "knn_reg"}
        return [m for m in all_models if m.name not in skip]

    if n_rows < 500:
        # Small dataset: skip complex ensembles, prefer simpler models
        prefer = {"logistic_regression", "linear_regression", "ridge", "lasso",
                  "decision_tree_clf", "decision_tree_reg",
                  "random_forest_clf", "random_forest_reg",
                  "knn_clf", "knn_reg"}
        return [m for m in all_models if m.name in prefer]

    # Medium dataset: try everything
    return all_models
