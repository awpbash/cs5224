import json
import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
}

PRELOADED = [
    {
        "id": "retail-churn",
        "name": "Retail Customer Churn",
        "description": "Telco customer churn prediction dataset with demographics and service usage",
        "rows": 7043, "columns": 21,
        "suggestedUseCase": "churn_prediction",
        "suggestedTaskType": "classification",
        "suggestedTarget": "Churn",
        "sampleColumns": ["gender", "SeniorCitizen", "tenure", "MonthlyCharges", "TotalCharges", "Churn"],
    },
    {
        "id": "supermarket-sales",
        "name": "Supermarket Sales",
        "description": "Supermarket transaction data with product lines and customer ratings",
        "rows": 1000, "columns": 17,
        "suggestedUseCase": "sales_forecasting",
        "suggestedTaskType": "regression",
        "suggestedTarget": "gross income",
        "sampleColumns": ["Branch", "City", "Product line", "Unit price", "Quantity", "gross income"],
    },
    {
        "id": "customer-segmentation",
        "name": "Mall Customer Segmentation",
        "description": "Mall customer spending patterns for segmentation analysis",
        "rows": 200, "columns": 5,
        "suggestedUseCase": "customer_segmentation",
        "suggestedTaskType": "classification",
        "suggestedTarget": "Spending Score (1-100)",
        "sampleColumns": ["Gender", "Age", "Annual Income (k$)", "Spending Score (1-100)"],
    },
    {
        "id": "store-demand",
        "name": "Store Item Demand Forecasting",
        "description": "5 years of store-item sales data for demand forecasting",
        "rows": 913000, "columns": 4,
        "suggestedUseCase": "demand_forecasting",
        "suggestedTaskType": "regression",
        "suggestedTarget": "sales",
        "sampleColumns": ["date", "store", "item", "sales"],
    },
]


def handler(event, context):
    return {
        "statusCode": 200,
        "headers": CORS_HEADERS,
        "body": json.dumps(PRELOADED),
    }
