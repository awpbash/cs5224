import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Maps frontend model names to train.py model registry names
MODEL_NAME_MAP = {
    "xgboost": {"clf": "xgboost_clf", "reg": "xgboost_reg"},
    "random_forest": {"clf": "random_forest_clf", "reg": "random_forest_reg"},
    "logistic": {"clf": "logistic_regression", "reg": "linear_regression"},
    "linear": {"clf": "logistic_regression", "reg": "linear_regression"},
    "decision_tree": {"clf": "decision_tree_clf", "reg": "decision_tree_reg"},
}


def handler(event, context):
    task_type = event.get("taskType", "classification")
    data_profile = event.get("dataProfile", {})
    is_regression = event.get("isRegression", False)

    if is_regression or task_type in ("regression", "sales_forecasting", "demand_forecasting"):
        is_regression = True

    suffix = "reg" if is_regression else "clf"
    row_count = data_profile.get("rowCount", 0)
    n_features = len(event.get("featureColumns", []))
    column_count = n_features if n_features > 0 else data_profile.get("columnCount", 0)

    # Check if user selected specific models from frontend
    selected_models = event.get("selectedModels")
    user_model_type = event.get("modelType")

    if selected_models and len(selected_models) > 0:
        # User picked specific models — map to train.py names
        candidate_models = []
        for m in selected_models:
            mapped = MODEL_NAME_MAP.get(m)
            if mapped:
                candidate_models.append(mapped[suffix])
            else:
                candidate_models.append(m)

        model_type = candidate_models[0]  # Primary model for single mode
        logger.info("User selected models: %s -> %s", selected_models, candidate_models)

        return {
            **event,
            "modelType": model_type,
            "candidateModels": candidate_models,
            "containerName": "tabular-automl",
            "hyperparameters": event.get("hyperparameters") or {},
            "isRegression": is_regression,
        }

    if user_model_type:
        # Single model specified
        mapped = MODEL_NAME_MAP.get(user_model_type)
        model_type = mapped[suffix] if mapped else user_model_type
        logger.info("User specified single model: %s -> %s", user_model_type, model_type)

        return {
            **event,
            "modelType": model_type,
            "containerName": "tabular-automl",
            "hyperparameters": event.get("hyperparameters") or {},
            "isRegression": is_regression,
        }

    # Auto mode — pick based on data characteristics
    if is_regression:
        if row_count > 5000 or column_count > 15:
            model_type = "xgboost_reg"
            hyperparameters = {"n_estimators": "200", "max_depth": "6", "learning_rate": "0.1"}
        else:
            model_type = "random_forest_reg"
            hyperparameters = {"n_estimators": "100", "max_depth": "10"}
    else:
        if row_count > 5000 or column_count > 15:
            model_type = "xgboost_clf"
            hyperparameters = {"n_estimators": "200", "max_depth": "6", "learning_rate": "0.1"}
        else:
            model_type = "random_forest_clf"
            hyperparameters = {"n_estimators": "100", "max_depth": "10"}

    logger.info("Auto-selected %s model: %s (rows=%d, features=%d)",
                "regression" if is_regression else "classification",
                model_type, row_count, column_count)

    hyperparameters.update(event.get("hyperparameters") or {})

    return {
        **event,
        "modelType": model_type,
        "containerName": "tabular-automl",
        "hyperparameters": hyperparameters,
        "isRegression": is_regression,
    }
