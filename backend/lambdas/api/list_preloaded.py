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
        "description": "Customer churn prediction dataset with contract, charges and payment data",
        "rows": 39, "columns": 6,
        "suggestedUseCase": "churn_prediction",
        "suggestedTaskType": "classification",
        "suggestedTarget": "churn",
        "sampleColumns": ["tenure", "monthly_charges", "total_charges", "contract_type", "payment_method", "churn"],
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
        "description": "Store-item sales data for demand forecasting",
        "rows": 5000, "columns": 4,
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
