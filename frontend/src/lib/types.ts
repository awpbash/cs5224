// ─── Core domain types (aligned with ARCHITECTURE.md) ───────────────────────

export type UseCase =
  | "churn_prediction"
  | "sales_forecasting"
  | "customer_segmentation"
  | "demand_forecasting"
  | "custom";

export type TaskType = "classification" | "regression" | "clustering";

export type ProjectStatus =
  | "CREATED"
  | "DATA_UPLOADED"
  | "PROFILED"
  | "TRAINING"
  | "COMPLETED"
  | "FAILED";

export type JobStatus =
  | "STARTING"
  | "PROFILING"
  | "PREPROCESSING"
  | "TRAINING"
  | "EVALUATING"
  | "COMPLETED"
  | "FAILED";

export type ModelType =
  | "xgboost"
  | "xgboost_clf"
  | "xgboost_reg"
  | "random_forest"
  | "random_forest_clf"
  | "random_forest_reg"
  | "logistic"
  | "logistic_regression"
  | "linear"
  | "linear_regression"
  | "decision_tree"
  | "decision_tree_clf"
  | "decision_tree_reg"
  | string;

export type DataSource = "uploaded" | "preloaded";

// ─── Project ────────────────────────────────────────────────────────────────

export interface Project {
  projectId: string;
  userId: string;
  projectName: string;
  useCase: UseCase;
  taskType: TaskType;
  dataSource: DataSource;
  preloadedDataset: string | null;
  targetColumn: string;
  selectedFeatures: string[];
  status: ProjectStatus;
  dataProfile: DataProfile | null;
  latestJobId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Data Profile ───────────────────────────────────────────────────────────

export interface ColumnProfile {
  name: string;
  dtype: "numeric" | "categorical" | "datetime" | "text";
  nullCount: number;
  nullPercent: number;
  uniqueCount: number;
  mean?: number;
  std?: number;
  min?: number;
  max?: number;
  topValues?: { value: string; count: number }[];
  distribution?: { bin: string; count: number }[];
}

export interface DataProfile {
  rowCount: number;
  colCount: number;
  columns: ColumnProfile[];
  preview: Record<string, string | number | null>[];
  classBalance?: { label: string; count: number }[];
  nullSummary: { column: string; nullPercent: number }[];
}

// ─── Data Issues ────────────────────────────────────────────────────────────

export type ImputationStrategy = "median" | "mode" | "mean" | "drop_rows";

export interface DataIssue {
  column: string;
  issue: "missing_data" | "high_cardinality" | "constant_column";
  description: string;
  suggestedAction: string;
  strategy: ImputationStrategy;
}

// ─── Job ────────────────────────────────────────────────────────────────────

export interface Job {
  jobId: string;
  projectId: string;
  userId: string;
  modelType: ModelType;
  hyperparameters: Record<string, number | string>;
  status: JobStatus;
  currentStep: string;
  failureReason: string | null;
  metrics: ModelMetrics | null;
  featureImportance: { feature: string; importance: number }[] | null;
  confusionMatrix: number[][] | null;
  classLabels: string[] | null;
  modelS3Key: string | null;
  trainingDurationSec: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ModelMetrics {
  // Classification
  accuracy?: number;
  f1?: number;
  precision?: number;
  recall?: number;
  // Regression
  r2?: number;
  mae?: number;
  rmse?: number;
  mse?: number;
  // Common
  [key: string]: unknown;
}

// ─── Pipeline Steps ─────────────────────────────────────────────────────────

export type PipelineStepName =
  | "profiling"
  | "preprocessing"
  | "model_selection"
  | "training"
  | "evaluation"
  | "deployment";

export type StepStatus = "pending" | "running" | "completed" | "failed";

export interface PipelineStep {
  name: PipelineStepName;
  label: string;
  status: StepStatus;
  detail?: string;
}

// ─── Chatbot ────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface SuggestedConfig {
  useCase: UseCase;
  taskType: TaskType;
  suggestedTarget: string;
  suggestedFeatures: string[];
  businessContext: string;
  timeFrame?: string;
}

export interface ChatSession {
  sessionId: string;
  projectId: string | null;
  messages: ChatMessage[];
  suggestedConfig: SuggestedConfig | null;
}

// ─── Preloaded Dataset ──────────────────────────────────────────────────────

export interface PreloadedDataset {
  id: string;
  name: string;
  description: string;
  rows: number;
  columns: number;
  suggestedUseCase: UseCase;
  suggestedTaskType: TaskType;
  suggestedTarget: string;
  sampleColumns: string[];
}

// ─── Business Insights (Bedrock output) ─────────────────────────────────────

export interface BusinessInsight {
  title: string;
  description: string;
  impact: "high" | "medium" | "low";
}

export interface TrainingResult {
  job: Job;
  businessSummary: string;
  kpis: { label: string; value: string; detail: string }[];
  topFeatures: { name: string; importance: number; explanation: string }[];
  recommendations: BusinessInsight[];
  predictions: Record<string, string | number>[];
}

// ─── Inference ──────────────────────────────────────────────────────────────

export interface InferenceRequest {
  data: Record<string, string | number>[];
}

export interface PredictionResult {
  prediction: string;
  confidence: number;
  probabilities: { label: string; probability: number }[];
}

// Lambda returns prediction directly, not wrapped in array
export type InferenceResponse = PredictionResult;

// ─── Cost Estimator (static/placeholder) ────────────────────────────────────

export interface CostEstimate {
  computeHours: number;
  storageGB: number;
  tokens: number;
  totalCost: number;
}
