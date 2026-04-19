import type {
  Project,
  Job,
  DataProfile,
  PreloadedDataset,
  ChatSession,
  SuggestedConfig,
  TrainingResult,
  PipelineStep,
  DataIssue,
  CostEstimate,
} from "./types";

// ─── Preloaded Datasets ─────────────────────────────────────────────────────

export const PRELOADED_DATASETS: PreloadedDataset[] = [
  {
    id: "retail-churn",
    name: "Telco Customer Churn",
    description: "Predict which customers will cancel their subscription.",
    rows: 7043,
    columns: 21,
    suggestedUseCase: "churn_prediction",
    suggestedTaskType: "classification",
    suggestedTarget: "Churn",
    sampleColumns: ["gender", "tenure", "MonthlyCharges", "Churn"],
  },
  {
    id: "supermarket-sales",
    name: "Supermarket Sales",
    description: "Analyse supermarket branch sales performance and customer ratings.",
    rows: 1000,
    columns: 17,
    suggestedUseCase: "sales_forecasting",
    suggestedTaskType: "regression",
    suggestedTarget: "gross income",
    sampleColumns: ["Branch", "City", "Customer type", "gross income"],
  },
  {
    id: "customer-segmentation",
    name: "Mall Customers",
    description: "Segment customers based on spending habits and demographics.",
    rows: 200,
    columns: 5,
    suggestedUseCase: "customer_segmentation",
    suggestedTaskType: "clustering",
    suggestedTarget: "",
    sampleColumns: ["Gender", "Age", "Annual Income", "Spending Score"],
  },
  {
    id: "store-demand",
    name: "Store Item Demand",
    description: "Forecast daily sales demand across multiple stores and items.",
    rows: 5000,
    columns: 4,
    suggestedUseCase: "demand_forecasting",
    suggestedTaskType: "regression",
    suggestedTarget: "sales",
    sampleColumns: ["date", "store", "item", "sales"],
  },
];

// ─── Sample Data Profile ────────────────────────────────────────────────────

export const MOCK_DATA_PROFILE: DataProfile = {
  rowCount: 7043,
  colCount: 21,
  columns: [
    { name: "customerID", dtype: "text", nullCount: 0, nullPercent: 0, uniqueCount: 7043 },
    { name: "gender", dtype: "categorical", nullCount: 0, nullPercent: 0, uniqueCount: 2, topValues: [{ value: "Male", count: 3555 }, { value: "Female", count: 3488 }] },
    { name: "SeniorCitizen", dtype: "numeric", nullCount: 0, nullPercent: 0, uniqueCount: 2, mean: 0.16, std: 0.37, min: 0, max: 1 },
    { name: "Partner", dtype: "categorical", nullCount: 0, nullPercent: 0, uniqueCount: 2, topValues: [{ value: "Yes", count: 3402 }, { value: "No", count: 3641 }] },
    { name: "Dependents", dtype: "categorical", nullCount: 0, nullPercent: 0, uniqueCount: 2, topValues: [{ value: "No", count: 4933 }, { value: "Yes", count: 2110 }] },
    { name: "tenure", dtype: "numeric", nullCount: 0, nullPercent: 0, uniqueCount: 73, mean: 32.37, std: 24.56, min: 0, max: 72, distribution: [{ bin: "0-12", count: 2175 }, { bin: "13-24", count: 1023 }, { bin: "25-36", count: 832 }, { bin: "37-48", count: 726 }, { bin: "49-60", count: 834 }, { bin: "61-72", count: 1453 }] },
    { name: "PhoneService", dtype: "categorical", nullCount: 0, nullPercent: 0, uniqueCount: 2, topValues: [{ value: "Yes", count: 6361 }, { value: "No", count: 682 }] },
    { name: "InternetService", dtype: "categorical", nullCount: 0, nullPercent: 0, uniqueCount: 3, topValues: [{ value: "Fiber optic", count: 3096 }, { value: "DSL", count: 2421 }, { value: "No", count: 1526 }] },
    { name: "Contract", dtype: "categorical", nullCount: 0, nullPercent: 0, uniqueCount: 3, topValues: [{ value: "Month-to-month", count: 3875 }, { value: "Two year", count: 1695 }, { value: "One year", count: 1473 }] },
    { name: "MonthlyCharges", dtype: "numeric", nullCount: 0, nullPercent: 0, uniqueCount: 1585, mean: 64.76, std: 30.09, min: 18.25, max: 118.75, distribution: [{ bin: "18-38", count: 1734 }, { bin: "38-58", count: 1108 }, { bin: "58-78", count: 1379 }, { bin: "78-98", count: 1530 }, { bin: "98-119", count: 1292 }] },
    { name: "TotalCharges", dtype: "numeric", nullCount: 11, nullPercent: 0.16, uniqueCount: 6531, mean: 2283.30, std: 2266.77, min: 18.80, max: 8684.80 },
    { name: "Churn", dtype: "categorical", nullCount: 0, nullPercent: 0, uniqueCount: 2, topValues: [{ value: "No", count: 5174 }, { value: "Yes", count: 1869 }] },
  ],
  preview: [
    { customerID: "7590-VHVEG", gender: "Female", tenure: 1, MonthlyCharges: 29.85, TotalCharges: 29.85, Churn: "No" },
    { customerID: "5575-GNVDE", gender: "Male", tenure: 34, MonthlyCharges: 56.95, TotalCharges: 1889.50, Churn: "No" },
    { customerID: "3668-QPYBK", gender: "Male", tenure: 2, MonthlyCharges: 53.85, TotalCharges: 108.15, Churn: "Yes" },
    { customerID: "7795-CFOCW", gender: "Male", tenure: 45, MonthlyCharges: 42.30, TotalCharges: 1840.75, Churn: "No" },
    { customerID: "9237-HQITU", gender: "Female", tenure: 2, MonthlyCharges: 70.70, TotalCharges: 151.65, Churn: "Yes" },
  ],
  classBalance: [
    { label: "No", count: 5174 },
    { label: "Yes", count: 1869 },
  ],
  nullSummary: [{ column: "TotalCharges", nullPercent: 0.16 }],
};

export const MOCK_DATA_ISSUES: DataIssue[] = [
  {
    column: "TotalCharges",
    issue: "missing_data",
    description: "11 missing values (0.16%) found in TotalCharges.",
    suggestedAction: "Fill with median value (1397.47)",
    strategy: "median",
  },
];

// ─── Sample Projects ────────────────────────────────────────────────────────

export const MOCK_PROJECTS: Project[] = [
  {
    projectId: "proj_001",
    userId: "user_001",
    projectName: "Customer Churn Analysis",
    useCase: "churn_prediction",
    taskType: "classification",
    dataSource: "preloaded",
    preloadedDataset: "retail-churn",
    targetColumn: "Churn",
    selectedFeatures: ["tenure", "MonthlyCharges", "Contract", "InternetService", "TotalCharges"],
    status: "COMPLETED",
    dataProfile: MOCK_DATA_PROFILE,
    latestJobId: "job_001",
    createdAt: "2026-03-01T10:00:00Z",
    updatedAt: "2026-03-01T10:25:00Z",
  },
  {
    projectId: "proj_002",
    userId: "user_001",
    projectName: "Sales Forecasting",
    useCase: "sales_forecasting",
    taskType: "regression",
    dataSource: "uploaded",
    preloadedDataset: null,
    targetColumn: "gross income",
    selectedFeatures: [],
    status: "TRAINING",
    dataProfile: null,
    latestJobId: "job_002",
    createdAt: "2026-03-05T14:00:00Z",
    updatedAt: "2026-03-05T14:10:00Z",
  },
  {
    projectId: "proj_003",
    userId: "user_001",
    projectName: "Customer Segmentation",
    useCase: "customer_segmentation",
    taskType: "clustering",
    dataSource: "preloaded",
    preloadedDataset: "customer-segmentation",
    targetColumn: "",
    selectedFeatures: [],
    status: "CREATED",
    dataProfile: null,
    latestJobId: null,
    createdAt: "2026-03-06T09:00:00Z",
    updatedAt: "2026-03-06T09:00:00Z",
  },
];

// ─── Sample Job / Training Result ───────────────────────────────────────────

export const MOCK_JOB: Job = {
  jobId: "job_001",
  projectId: "proj_001",
  userId: "user_001",
  modelType: "xgboost",
  hyperparameters: { max_depth: 6, n_estimators: 200, learning_rate: 0.1 },
  status: "COMPLETED",
  currentStep: "Completed",
  failureReason: null,
  metrics: { accuracy: 0.89, f1: 0.87, precision: 0.91, recall: 0.83 },
  featureImportance: [
    { feature: "Contract", importance: 0.32 },
    { feature: "tenure", importance: 0.28 },
    { feature: "MonthlyCharges", importance: 0.18 },
    { feature: "InternetService", importance: 0.12 },
    { feature: "TotalCharges", importance: 0.10 },
  ],
  confusionMatrix: [[742, 68], [89, 601]],
  classLabels: ["No Churn", "Churn"],
  modelS3Key: "users/user_001/proj_001/models/job_001/model.pkl",
  trainingDurationSec: 245,
  createdAt: "2026-03-01T10:05:00Z",
  completedAt: "2026-03-01T10:09:05Z",
};

export const MOCK_TRAINING_RESULT: TrainingResult = {
  job: MOCK_JOB,
  businessSummary: "Which customers are likely to churn in the next 30 days?",
  kpis: [
    { label: "Customers at risk", value: "1,234", detail: "Out of 7,043 total customers" },
    { label: "Revenue at risk", value: "$135k", detail: "Monthly recurring revenue that may be lost" },
    { label: "Model accuracy", value: "8 in 10", detail: "Flagged customers are actual churners" },
  ],
  topFeatures: [
    { name: "Contract Type", importance: 0.32, explanation: "Month-to-month customers are 3x more likely to churn. Consider incentives for annual plans." },
    { name: "Tenure", importance: 0.28, explanation: "Customers with less than 6 months tenure have 45% churn rate. Focus onboarding efforts here." },
    { name: "Monthly Charges", importance: 0.18, explanation: "Customers paying over $70/month churn at higher rates. Review pricing tiers." },
  ],
  recommendations: [
    { title: "Incentivise annual contracts", description: "Month-to-month customers are 3x more likely to churn. Offer 10-15% discount for annual commitment.", impact: "high" },
    { title: "Improve onboarding", description: "New customers (tenure < 6 months) have 45% churn rate. Focus on first 90-day experience.", impact: "high" },
    { title: "Review high-tier pricing", description: "Customers paying >$70/month churn more. Consider loyalty rewards or bundle discounts.", impact: "medium" },
    { title: "Proactive support outreach", description: "Customers with 3+ support tickets in the last quarter have double churn probability.", impact: "medium" },
  ],
  predictions: [
    { customerID: "7590-VHVEG", tenure: 1, MonthlyCharges: 29.85, Contract: "Month-to-month", churn_probability: 0.82, risk_level: "High" },
    { customerID: "5575-GNVDE", tenure: 34, MonthlyCharges: 56.95, Contract: "One year", churn_probability: 0.15, risk_level: "Low" },
    { customerID: "3668-QPYBK", tenure: 2, MonthlyCharges: 53.85, Contract: "Month-to-month", churn_probability: 0.78, risk_level: "High" },
    { customerID: "7795-CFOCW", tenure: 45, MonthlyCharges: 42.30, Contract: "Two year", churn_probability: 0.08, risk_level: "Low" },
    { customerID: "9237-HQITU", tenure: 2, MonthlyCharges: 70.70, Contract: "Month-to-month", churn_probability: 0.91, risk_level: "High" },
  ],
};

// ─── Pipeline Steps ─────────────────────────────────────────────────────────

export const MOCK_PIPELINE_STEPS: PipelineStep[] = [
  { name: "profiling", label: "Data Profiling", status: "completed", detail: "Analyzed 7,043 rows, 21 columns" },
  { name: "preprocessing", label: "Preprocessing", status: "completed", detail: "Imputed 11 nulls, encoded 8 categoricals" },
  { name: "model_selection", label: "Model Selection", status: "completed", detail: "Selected XGBoost (7K rows, classification)" },
  { name: "training", label: "Training", status: "running", detail: "XGBoost training in progress..." },
  { name: "evaluation", label: "Evaluation", status: "pending" },
  { name: "deployment", label: "Deployment", status: "pending" },
];

// ─── Chat Session ───────────────────────────────────────────────────────────

export const MOCK_CHAT_SESSION: ChatSession = {
  sessionId: "chat_001",
  projectId: "proj_001",
  messages: [
    { role: "user", content: "I want to know which customers might stop buying from us", timestamp: "2026-03-01T10:00:00Z" },
    { role: "assistant", content: "That sounds like a customer churn prediction problem! Based on your description, I'd suggest building a classification model that predicts whether each customer will churn (leave) or stay.\n\nIf you have customer data with fields like tenure, payment history, and service usage, we can identify the key factors driving churn and flag at-risk customers.", timestamp: "2026-03-01T10:00:02Z" },
  ],
  suggestedConfig: {
    useCase: "churn_prediction",
    taskType: "classification",
    suggestedTarget: "Churn",
    suggestedFeatures: ["tenure", "MonthlyCharges", "Contract", "InternetService", "TotalCharges"],
    businessContext: "Identify customers likely to cancel their subscription",
    timeFrame: "30 days",
  },
};

export const MOCK_SUGGESTED_CONFIG: SuggestedConfig = MOCK_CHAT_SESSION.suggestedConfig!;

// ─── Cost Estimate (placeholder) ────────────────────────────────────────────

export const MOCK_COST_ESTIMATE: CostEstimate = {
  computeHours: 0.9,
  storageGB: 5,
  tokens: 100,
  totalCost: 0,
};
