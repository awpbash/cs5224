"use client";

import { useState } from "react";
import {
  Brain,
  TreePine,
  GitFork,
  Zap,
  Gauge,
  Target,
  TrendingUp,
  Layers,
  CircleDot,
  Sigma,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  DollarSign,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Model Data                                                         */
/* ------------------------------------------------------------------ */

// ── AWS pricing (ap-southeast-1) — must match train/page.tsx ──────────────
const FARGATE_VCPU_PER_HR = 0.04048;
const FARGATE_MEM_PER_GB_HR = 0.004445;
const FARGATE_VCPU = 1;
const FARGATE_MEM_GB = 2;

interface Model {
  id: string;
  name: string;
  icon: React.ElementType;
  category: "linear" | "tree" | "ensemble" | "instance" | "svm";
  complexity: "Low" | "Medium" | "High";
  speed: "Fast" | "Medium" | "Slow";
  interpretability: "High" | "Medium" | "Low";
  /** Multiplier relative to base training time (1.0 = baseline) */
  timeMultiplier: number;
  description: string;
  howItWorks: string;
  bestFor: string[];
  limitations: string[];
  hyperparameters: { name: string; description: string; values: string }[];
}

/** Estimate training time (minutes) and Fargate cost for a given model + dataset size.
 *  Uses the same formula as the train page cost estimator. */
function estimateForModel(
  rows: number,
  features: number,
  timeMultiplier: number,
): { minutes: number; cost: number } {
  let baseMinutes: number;
  if (rows < 1000) baseMinutes = 1;
  else if (rows < 10000) baseMinutes = 3;
  else if (rows < 50000) baseMinutes = 10;
  else baseMinutes = 25;

  const featureMultiplier = Math.max(1, features / 10);
  const minutes = Math.round(baseMinutes * timeMultiplier * featureMultiplier * 10) / 10;
  const hours = minutes / 60;
  const cost = hours * (FARGATE_VCPU * FARGATE_VCPU_PER_HR + FARGATE_MEM_GB * FARGATE_MEM_PER_GB_HR);
  return { minutes, cost: Math.round(cost * 10000) / 10000 };
}

const CLASSIFICATION_MODELS: Model[] = [
  {
    id: "logistic_regression",
    name: "Logistic Regression",
    icon: TrendingUp,
    category: "linear",
    complexity: "Low",
    speed: "Fast",
    interpretability: "High",
    timeMultiplier: 0.5,
    description:
      "Predicts the probability of an outcome by fitting a linear boundary between classes. The simplest and most interpretable classification model.",
    howItWorks:
      "Draws a straight line (or plane) to separate classes. For each data point, it calculates a probability score — above 50% is one class, below is the other. Think of it like a scoring system where each feature adds or subtracts points.",
    bestFor: [
      "Binary classification (yes/no, churn/stay)",
      "When you need to explain WHY a prediction was made",
      "Smaller datasets with clear linear patterns",
      "Regulatory environments requiring transparent models",
    ],
    limitations: [
      "Cannot capture complex non-linear relationships",
      "Struggles when features interact with each other",
      "Assumes features are roughly independent",
    ],
    hyperparameters: [
      {
        name: "C (Regularization)",
        description: "Controls how closely the model fits the training data. Lower = simpler model, less overfitting.",
        values: "0.01, 0.1, 1.0, 10.0",
      },
    ],
  },
  {
    id: "decision_tree_clf",
    name: "Decision Tree",
    icon: TreePine,
    category: "tree",
    complexity: "Low",
    speed: "Fast",
    interpretability: "High",
    timeMultiplier: 0.5,
    description:
      "Makes predictions by asking a series of yes/no questions about your data, creating a flowchart-like structure anyone can follow.",
    howItWorks:
      "Splits data by asking questions like \"Is monthly spend > $50?\" → \"Is tenure > 12 months?\" → prediction. Each split divides customers into increasingly pure groups. The result is a tree you can literally print and follow.",
    bestFor: [
      "When you need fully transparent, explainable rules",
      "Business rule extraction (\"customers who do X tend to churn\")",
      "Quick baseline model to understand data patterns",
      "Datasets with both numeric and categorical features",
    ],
    limitations: [
      "Prone to overfitting — can memorize training data",
      "Small data changes can produce very different trees",
      "Usually less accurate than ensemble methods",
    ],
    hyperparameters: [
      {
        name: "max_depth",
        description: "Maximum number of question levels. Deeper = more complex rules.",
        values: "5, 10, 20, None (unlimited)",
      },
      {
        name: "min_samples_split",
        description: "Minimum customers needed before asking another question.",
        values: "2, 5, 10",
      },
    ],
  },
  {
    id: "random_forest_clf",
    name: "Random Forest",
    icon: GitFork,
    category: "ensemble",
    complexity: "Medium",
    speed: "Medium",
    interpretability: "Medium",
    timeMultiplier: 1.5,
    description:
      "Builds hundreds of decision trees on random subsets of your data, then takes a majority vote. Like consulting a panel of experts instead of one.",
    howItWorks:
      "Creates many decision trees, each trained on a random sample of rows and columns. Each tree votes on the prediction, and the majority wins. This \"wisdom of crowds\" approach reduces individual tree errors and overfitting.",
    bestFor: [
      "General-purpose classification — works well on most datasets",
      "Medium-to-large datasets (1K–100K+ rows)",
      "When you want solid accuracy without heavy tuning",
      "Datasets with many features (auto-selects the useful ones)",
    ],
    limitations: [
      "Less interpretable than a single decision tree",
      "Slower to train than simple models",
      "Can struggle with very high-dimensional sparse data",
    ],
    hyperparameters: [
      {
        name: "n_estimators",
        description: "Number of trees in the forest. More = better accuracy but slower.",
        values: "100, 200, 500",
      },
      {
        name: "max_depth",
        description: "Maximum depth of each tree.",
        values: "5, 10, 20, None",
      },
    ],
  },
  {
    id: "gradient_boosting_clf",
    name: "Gradient Boosting",
    icon: Layers,
    category: "ensemble",
    complexity: "High",
    speed: "Medium",
    interpretability: "Low",
    timeMultiplier: 1.5,
    description:
      "Builds trees sequentially, where each new tree focuses on correcting the mistakes of previous ones. Like a student learning from their errors.",
    howItWorks:
      "Starts with a simple prediction, then adds trees one at a time. Each new tree specifically targets the data points the previous trees got wrong. Over many rounds, the combined model becomes highly accurate.",
    bestFor: [
      "Structured/tabular data with complex patterns",
      "When accuracy is the top priority",
      "Medium datasets (1K–50K rows)",
      "Competition-winning performance",
    ],
    limitations: [
      "Slower to train than Random Forest",
      "More sensitive to hyperparameter tuning",
      "Can overfit on small datasets",
    ],
    hyperparameters: [
      {
        name: "n_estimators",
        description: "Number of boosting rounds.",
        values: "100, 200",
      },
      {
        name: "max_depth",
        description: "Depth of each tree (keep shallow for boosting).",
        values: "3, 5, 7",
      },
      {
        name: "learning_rate",
        description: "How much each tree contributes. Lower = more trees needed but better generalization.",
        values: "0.05, 0.1, 0.2",
      },
    ],
  },
  {
    id: "xgboost_clf",
    name: "XGBoost",
    icon: Zap,
    category: "ensemble",
    complexity: "High",
    speed: "Fast",
    interpretability: "Low",
    timeMultiplier: 1.5,
    description:
      "An optimized version of gradient boosting that's faster and often more accurate. The go-to model for tabular data competitions and production systems.",
    howItWorks:
      "Like Gradient Boosting but with engineering optimizations: parallel tree construction, built-in regularization to prevent overfitting, efficient handling of missing values, and smart tree pruning. Often the best out-of-the-box performer.",
    bestFor: [
      "Best default choice for most tabular datasets",
      "Large datasets (handles 100K+ rows efficiently)",
      "When you want top accuracy with reasonable training time",
      "Datasets with missing values (handles them natively)",
    ],
    limitations: [
      "Not very interpretable (black-box predictions)",
      "Requires more memory than simpler models",
      "Many hyperparameters to tune (but defaults are good)",
    ],
    hyperparameters: [
      {
        name: "n_estimators",
        description: "Number of boosting rounds.",
        values: "200, 300, 500",
      },
      {
        name: "max_depth",
        description: "Maximum tree depth.",
        values: "4, 6, 8",
      },
      {
        name: "learning_rate",
        description: "Step size for each boosting round.",
        values: "0.05, 0.1, 0.2",
      },
    ],
  },
  {
    id: "lightgbm_clf",
    name: "LightGBM",
    icon: Gauge,
    category: "ensemble",
    complexity: "High",
    speed: "Fast",
    interpretability: "Low",
    timeMultiplier: 1.2,
    description:
      "Microsoft's gradient boosting framework, designed for speed and efficiency. Grows trees leaf-wise instead of level-wise for faster convergence.",
    howItWorks:
      "Similar to XGBoost but uses a different tree growth strategy (leaf-wise vs level-wise). This means it finds the best split globally, leading to faster training and often better accuracy — especially on larger datasets.",
    bestFor: [
      "Large datasets (fastest boosting algorithm)",
      "High-dimensional data with many features",
      "When training speed matters",
      "Categorical features (handles them natively)",
    ],
    limitations: [
      "Can overfit on small datasets (< 1K rows)",
      "Leaf-wise growth may produce deeper, less balanced trees",
      "Slightly harder to tune than XGBoost",
    ],
    hyperparameters: [
      {
        name: "n_estimators",
        description: "Number of boosting iterations.",
        values: "200, 300, 500",
      },
      {
        name: "num_leaves",
        description: "Maximum leaves per tree. Controls model complexity.",
        values: "15, 31, 63",
      },
      {
        name: "learning_rate",
        description: "Shrinkage factor per iteration.",
        values: "0.05, 0.1, 0.2",
      },
    ],
  },
  {
    id: "knn_clf",
    name: "K-Nearest Neighbors",
    icon: CircleDot,
    category: "instance",
    complexity: "Low",
    speed: "Slow",
    interpretability: "High",
    timeMultiplier: 2.0,
    description:
      "Classifies a new data point by looking at the K most similar existing data points and taking a majority vote. No training needed — it memorizes the data.",
    howItWorks:
      "When predicting for a new customer, it finds the K most similar customers in the training data (using distance metrics) and checks what happened to them. If 4 out of 5 nearest neighbors churned, the prediction is \"churn\".",
    bestFor: [
      "Small datasets where pattern is local",
      "When similar customers behave similarly",
      "Quick baseline with no training time",
      "Multi-class problems",
    ],
    limitations: [
      "Very slow on large datasets (compares against all training points)",
      "Sensitive to irrelevant features and different scales",
      "Doesn't work well in high dimensions (curse of dimensionality)",
    ],
    hyperparameters: [
      {
        name: "n_neighbors (K)",
        description: "How many neighbors to consult. Lower = more sensitive to noise, higher = smoother boundaries.",
        values: "3, 5, 7, 11, 15",
      },
    ],
  },
  {
    id: "svm_clf",
    name: "Support Vector Machine",
    icon: Target,
    category: "svm",
    complexity: "Medium",
    speed: "Slow",
    interpretability: "Low",
    timeMultiplier: 2.5,
    description:
      "Finds the optimal boundary between classes by maximizing the margin (gap) between them. Can handle non-linear patterns using kernel tricks.",
    howItWorks:
      "Imagine plotting customers on a chart. SVM draws the line that creates the widest possible gap between churners and non-churners. For complex patterns, it uses the \"kernel trick\" to project data into higher dimensions where a clean separation exists.",
    bestFor: [
      "Small-to-medium datasets with clear class separation",
      "Binary classification with complex boundaries",
      "Text classification and high-dimensional data",
      "When margin of separation matters",
    ],
    limitations: [
      "Very slow on large datasets (>10K rows)",
      "Doesn't output calibrated probabilities by default",
      "Sensitive to feature scaling",
    ],
    hyperparameters: [
      {
        name: "C",
        description: "Penalty for misclassification. Higher = stricter boundary, more overfitting risk.",
        values: "0.1, 1.0, 10.0",
      },
      {
        name: "kernel",
        description: "Shape of the decision boundary. RBF = curved, linear = straight.",
        values: "rbf, linear",
      },
    ],
  },
];

const REGRESSION_MODELS: Model[] = [
  {
    id: "linear_regression",
    name: "Linear Regression",
    icon: TrendingUp,
    category: "linear",
    complexity: "Low",
    speed: "Fast",
    interpretability: "High",
    timeMultiplier: 0.3,
    description:
      "Predicts a number by finding the best straight-line relationship between features and the target. The foundation of all regression models.",
    howItWorks:
      "Finds the equation: predicted_value = a\u00D7feature1 + b\u00D7feature2 + ... Each coefficient tells you exactly how much that feature affects the prediction. For example, \"each additional month of tenure adds $12 to lifetime value.\"",
    bestFor: [
      "Understanding feature contributions (each coefficient tells a story)",
      "When relationships are roughly linear",
      "Baseline model before trying complex approaches",
      "Regulatory or audit requirements",
    ],
    limitations: [
      "Cannot capture non-linear relationships",
      "Assumes features are independent",
      "Sensitive to outliers",
    ],
    hyperparameters: [],
  },
  {
    id: "ridge",
    name: "Ridge Regression",
    icon: Sigma,
    category: "linear",
    complexity: "Low",
    speed: "Fast",
    interpretability: "High",
    timeMultiplier: 0.5,
    description:
      "Linear regression with a penalty that shrinks coefficients toward zero, preventing overfitting when you have many features or correlated features.",
    howItWorks:
      "Same as linear regression but adds a penalty for large coefficients (L2 regularization). This keeps all features in the model but reduces their impact, which helps when features are correlated (e.g., monthly charges and total charges).",
    bestFor: [
      "Many features relative to rows (prevents overfitting)",
      "Correlated features (multicollinearity)",
      "When you want all features to contribute slightly",
      "Stable predictions across similar datasets",
    ],
    limitations: [
      "Doesn't perform feature selection (keeps all features)",
      "Still assumes linear relationships",
      "Requires feature scaling for best results",
    ],
    hyperparameters: [
      {
        name: "alpha",
        description: "Regularization strength. Higher = simpler model with smaller coefficients.",
        values: "0.01, 0.1, 1.0, 10.0, 100.0",
      },
    ],
  },
  {
    id: "lasso",
    name: "Lasso Regression",
    icon: Target,
    category: "linear",
    complexity: "Low",
    speed: "Fast",
    interpretability: "High",
    timeMultiplier: 0.5,
    description:
      "Linear regression with a penalty that can shrink some coefficients to exactly zero, effectively performing automatic feature selection.",
    howItWorks:
      "Like Ridge but uses L1 penalty, which can set irrelevant feature weights to exactly zero. This means Lasso automatically identifies which features matter and which don't — great for understanding what drives predictions.",
    bestFor: [
      "Automatic feature selection (drops irrelevant features)",
      "Sparse models with few important predictors",
      "When interpretability is critical",
      "High-dimensional datasets",
    ],
    limitations: [
      "Arbitrarily picks one among correlated features",
      "Can underperform when many features are important",
      "Still assumes linear relationships",
    ],
    hyperparameters: [
      {
        name: "alpha",
        description: "Regularization strength. Higher = more features set to zero.",
        values: "0.001, 0.01, 0.1, 1.0, 10.0",
      },
    ],
  },
  {
    id: "elasticnet",
    name: "ElasticNet",
    icon: ArrowUpDown,
    category: "linear",
    complexity: "Low",
    speed: "Fast",
    interpretability: "High",
    timeMultiplier: 0.5,
    description:
      "Combines Ridge and Lasso penalties — gets the best of both worlds: feature selection from Lasso and stability from Ridge.",
    howItWorks:
      "Uses both L1 (Lasso) and L2 (Ridge) penalties simultaneously. The l1_ratio parameter controls the mix: 1.0 = pure Lasso, 0.0 = pure Ridge. This handles correlated features better than Lasso alone while still performing feature selection.",
    bestFor: [
      "Correlated features where Lasso is unstable",
      "When you want both feature selection and coefficient shrinkage",
      "Large feature sets with groups of related features",
      "A balanced approach between Ridge and Lasso",
    ],
    limitations: [
      "Two hyperparameters to tune instead of one",
      "Still limited to linear relationships",
      "Can be slower than Ridge or Lasso alone",
    ],
    hyperparameters: [
      {
        name: "alpha",
        description: "Overall regularization strength.",
        values: "0.01, 0.1, 1.0",
      },
      {
        name: "l1_ratio",
        description: "Mix between Lasso (1.0) and Ridge (0.0).",
        values: "0.2, 0.5, 0.8",
      },
    ],
  },
  {
    id: "decision_tree_reg",
    name: "Decision Tree",
    icon: TreePine,
    category: "tree",
    complexity: "Low",
    speed: "Fast",
    interpretability: "High",
    timeMultiplier: 0.5,
    description:
      "Predicts a number by splitting data into groups with similar target values. Each leaf node contains the average value for that group.",
    howItWorks:
      "Asks questions like \"Is tenure > 24 months?\" to split data. Each final group (leaf) predicts the average target value of its members. For example: customers with high tenure AND high monthly charges have an average LTV of $2,400.",
    bestFor: [
      "Extracting business rules for numeric targets",
      "Non-linear relationships with clear breakpoints",
      "Quick prototyping and data exploration",
    ],
    limitations: [
      "Prone to overfitting",
      "Predictions are step-wise (not smooth)",
      "Unstable — small changes in data can change the tree",
    ],
    hyperparameters: [
      {
        name: "max_depth",
        description: "Maximum depth of the tree.",
        values: "5, 10, 20, None",
      },
      {
        name: "min_samples_split",
        description: "Minimum samples required to split a node.",
        values: "2, 5, 10",
      },
    ],
  },
  {
    id: "random_forest_reg",
    name: "Random Forest",
    icon: GitFork,
    category: "ensemble",
    complexity: "Medium",
    speed: "Medium",
    interpretability: "Medium",
    timeMultiplier: 1.5,
    description:
      "Averages predictions from hundreds of decision trees for more stable and accurate numeric predictions.",
    howItWorks:
      "Each tree makes its own numeric prediction based on a random subset of data. The final prediction is the average of all trees. This smooths out individual tree errors and produces reliable estimates.",
    bestFor: [
      "General-purpose regression on tabular data",
      "Datasets with non-linear patterns",
      "When you want solid accuracy without extensive tuning",
    ],
    limitations: [
      "Cannot extrapolate beyond training data range",
      "Less interpretable than single tree or linear models",
      "Higher memory usage",
    ],
    hyperparameters: [
      { name: "n_estimators", description: "Number of trees.", values: "100, 200, 500" },
      { name: "max_depth", description: "Maximum tree depth.", values: "5, 10, 20, None" },
    ],
  },
  {
    id: "gradient_boosting_reg",
    name: "Gradient Boosting",
    icon: Layers,
    category: "ensemble",
    complexity: "High",
    speed: "Medium",
    interpretability: "Low",
    timeMultiplier: 1.5,
    description:
      "Sequentially builds trees that correct previous errors, producing highly accurate numeric predictions.",
    howItWorks:
      "Starts with a simple prediction (the average), then adds trees to reduce the remaining error. Each tree targets the residual (gap between prediction and actual). After many rounds, residuals shrink toward zero.",
    bestFor: [
      "High-accuracy regression tasks",
      "Complex non-linear patterns",
      "Medium-sized datasets",
    ],
    limitations: [
      "Slower to train than Random Forest",
      "Can overfit without proper regularization",
      "Sequential training (can't parallelize)",
    ],
    hyperparameters: [
      { name: "n_estimators", description: "Number of boosting rounds.", values: "100, 200" },
      { name: "max_depth", description: "Tree depth per round.", values: "3, 5, 7" },
      { name: "learning_rate", description: "Step size for corrections.", values: "0.05, 0.1, 0.2" },
    ],
  },
  {
    id: "xgboost_reg",
    name: "XGBoost",
    icon: Zap,
    category: "ensemble",
    complexity: "High",
    speed: "Fast",
    interpretability: "Low",
    timeMultiplier: 1.5,
    description:
      "Optimized gradient boosting for regression — fast, accurate, and handles missing values natively.",
    howItWorks:
      "Same boosting strategy as Gradient Boosting but with engineering optimizations for speed and accuracy. Built-in regularization prevents overfitting, and it handles missing values automatically.",
    bestFor: [
      "Best default for numeric prediction tasks",
      "Large datasets with missing values",
      "When accuracy is the priority",
    ],
    limitations: [
      "Black-box predictions",
      "Many hyperparameters",
      "Higher memory usage",
    ],
    hyperparameters: [
      { name: "n_estimators", description: "Boosting rounds.", values: "200, 300, 500" },
      { name: "max_depth", description: "Tree depth.", values: "4, 6, 8" },
      { name: "learning_rate", description: "Step size.", values: "0.05, 0.1, 0.2" },
    ],
  },
  {
    id: "lightgbm_reg",
    name: "LightGBM",
    icon: Gauge,
    category: "ensemble",
    complexity: "High",
    speed: "Fast",
    interpretability: "Low",
    timeMultiplier: 1.2,
    description:
      "Microsoft's fast gradient boosting for regression. Leaf-wise tree growth for efficient training on large datasets.",
    howItWorks:
      "Grows trees by finding the leaf with the highest gain globally (rather than level-by-level). This produces accurate models faster, especially on large datasets with many features.",
    bestFor: [
      "Large datasets (fastest gradient boosting)",
      "High-dimensional feature spaces",
      "Categorical features",
    ],
    limitations: [
      "Can overfit on small datasets",
      "Slightly harder to tune",
      "Less stable on tiny datasets",
    ],
    hyperparameters: [
      { name: "n_estimators", description: "Boosting iterations.", values: "200, 300, 500" },
      { name: "num_leaves", description: "Max leaves per tree.", values: "15, 31, 63" },
      { name: "learning_rate", description: "Shrinkage factor.", values: "0.05, 0.1, 0.2" },
    ],
  },
  {
    id: "knn_reg",
    name: "K-Nearest Neighbors",
    icon: CircleDot,
    category: "instance",
    complexity: "Low",
    speed: "Slow",
    interpretability: "High",
    timeMultiplier: 2.0,
    description:
      "Predicts a number by averaging the target values of the K most similar data points.",
    howItWorks:
      "For a new data point, finds the K closest training examples and averages their target values. If the 5 nearest customers have LTVs of $100, $120, $90, $110, $130, the prediction is $110.",
    bestFor: [
      "Small datasets with local patterns",
      "Non-parametric baseline",
      "When similar items have similar values",
    ],
    limitations: [
      "Very slow at prediction time on large datasets",
      "Sensitive to feature scaling",
      "Poor in high dimensions",
    ],
    hyperparameters: [
      { name: "n_neighbors", description: "Number of neighbors to average.", values: "3, 5, 7, 11, 15" },
    ],
  },
  {
    id: "svm_reg",
    name: "Support Vector Machine",
    icon: Target,
    category: "svm",
    complexity: "Medium",
    speed: "Slow",
    interpretability: "Low",
    timeMultiplier: 2.5,
    description:
      "Fits a regression line within a margin of tolerance, ignoring small errors while penalizing large deviations.",
    howItWorks:
      "Instead of minimizing all errors, SVR defines a tube (epsilon) around the prediction line and only penalizes points outside this tube. This makes it robust to small noise while focusing on large deviations.",
    bestFor: [
      "Small-to-medium datasets",
      "When robustness to outliers matters",
      "Non-linear regression with kernel trick",
    ],
    limitations: [
      "Very slow on large datasets",
      "Requires careful feature scaling",
      "Hard to interpret",
    ],
    hyperparameters: [
      { name: "C", description: "Penalty for predictions outside the margin.", values: "0.1, 1.0, 10.0" },
      { name: "kernel", description: "Function shape.", values: "rbf, linear" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Helper Components                                                  */
/* ------------------------------------------------------------------ */

function Badge({ label, variant }: { label: string; variant: "green" | "yellow" | "red" }) {
  const colors = {
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    yellow: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[variant]}`}>
      {label}
    </span>
  );
}

function complexityColor(c: string): "green" | "yellow" | "red" {
  return c === "Low" ? "green" : c === "Medium" ? "yellow" : "red";
}
function speedColor(s: string): "green" | "yellow" | "red" {
  return s === "Fast" ? "green" : s === "Medium" ? "yellow" : "red";
}
function interpretColor(i: string): "green" | "yellow" | "red" {
  return i === "High" ? "green" : i === "Medium" ? "yellow" : "red";
}

function ModelCard({ model, rows, features }: { model: Model; rows: number; features: number }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = model.icon;
  const est = estimateForModel(rows, features, model.timeMultiplier);

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm hover:shadow-md transition-all duration-300">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-5 py-4 flex items-start gap-4"
      >
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950">
          <Icon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-foreground">{model.name}</h3>
            <span className="text-xs text-muted-foreground capitalize rounded-full bg-secondary px-2 py-0.5">
              {model.category}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{model.description}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Badge label={`Complexity: ${model.complexity}`} variant={complexityColor(model.complexity)} />
            <Badge label={`Speed: ${model.speed}`} variant={speedColor(model.speed)} />
            <Badge label={`Interpretability: ${model.interpretability}`} variant={interpretColor(model.interpretability)} />
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 px-2.5 py-0.5 text-xs font-medium">
              <Clock className="h-3 w-3" /> ~{est.minutes < 1 ? "<1" : est.minutes} min
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400 px-2.5 py-0.5 text-xs font-medium">
              <DollarSign className="h-3 w-3" /> ${est.cost < 0.01 ? "<0.01" : est.cost.toFixed(2)}
            </span>
          </div>
        </div>
        <div className="mt-1 shrink-0 text-muted-foreground">
          {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border/40 px-5 py-4 space-y-4">
          {/* How it works */}
          <div>
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-1.5">
              <Brain className="h-4 w-4 text-emerald-600" /> How It Works
            </h4>
            <p className="text-sm text-muted-foreground leading-relaxed">{model.howItWorks}</p>
          </div>

          {/* Best for */}
          <div>
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Best For
            </h4>
            <ul className="space-y-1">
              {model.bestFor.map((item, i) => (
                <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Limitations */}
          <div>
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-1.5">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Limitations
            </h4>
            <ul className="space-y-1">
              {model.limitations.map((item, i) => (
                <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Hyperparameters */}
          {model.hyperparameters.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-1.5">
                <BarChart3 className="h-4 w-4 text-emerald-600" /> Tunable Hyperparameters
              </h4>
              <div className="rounded-lg border border-border/40 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-secondary/50">
                      <th className="text-left px-3 py-2 font-medium text-foreground">Parameter</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground">What It Does</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground">Search Values</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.hyperparameters.map((hp, i) => (
                      <tr key={i} className="border-t border-border/30">
                        <td className="px-3 py-2 font-mono text-xs text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                          {hp.name}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{hp.description}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">
                          {hp.values}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Quick Reference Table                                              */
/* ------------------------------------------------------------------ */

function ComparisonTable({ models, rows, features }: { models: Model[]; rows: number; features: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/60 bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-secondary/50 border-b border-border/40">
            <th className="text-left px-4 py-3 font-semibold text-foreground">Model</th>
            <th className="text-center px-4 py-3 font-semibold text-foreground">
              <span className="flex items-center justify-center gap-1"><Database className="h-3.5 w-3.5" /> Complexity</span>
            </th>
            <th className="text-center px-4 py-3 font-semibold text-foreground">
              <span className="flex items-center justify-center gap-1"><Clock className="h-3.5 w-3.5" /> Speed</span>
            </th>
            <th className="text-center px-4 py-3 font-semibold text-foreground">
              <span className="flex items-center justify-center gap-1"><Brain className="h-3.5 w-3.5" /> Interpretability</span>
            </th>
            <th className="text-center px-4 py-3 font-semibold text-foreground">
              <span className="flex items-center justify-center gap-1"><Clock className="h-3.5 w-3.5" /> Est. Time</span>
            </th>
            <th className="text-center px-4 py-3 font-semibold text-foreground">
              <span className="flex items-center justify-center gap-1"><DollarSign className="h-3.5 w-3.5" /> Est. Cost</span>
            </th>
            <th className="text-left px-4 py-3 font-semibold text-foreground">Best Use Case</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m, i) => {
            const est = estimateForModel(rows, features, m.timeMultiplier);
            return (
              <tr key={m.id} className={`border-b border-border/20 ${i % 2 === 0 ? "" : "bg-secondary/20"}`}>
                <td className="px-4 py-2.5 font-medium text-foreground whitespace-nowrap">{m.name}</td>
                <td className="px-4 py-2.5 text-center"><Badge label={m.complexity} variant={complexityColor(m.complexity)} /></td>
                <td className="px-4 py-2.5 text-center"><Badge label={m.speed} variant={speedColor(m.speed)} /></td>
                <td className="px-4 py-2.5 text-center"><Badge label={m.interpretability} variant={interpretColor(m.interpretability)} /></td>
                <td className="px-4 py-2.5 text-center text-muted-foreground font-mono text-xs">
                  ~{est.minutes < 1 ? "<1" : est.minutes} min
                </td>
                <td className="px-4 py-2.5 text-center text-muted-foreground font-mono text-xs">
                  ${est.cost < 0.01 ? "<0.01" : est.cost.toFixed(2)}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{m.bestFor[0]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

const DATASET_PRESETS = [
  { label: "Small (200 rows, 5 cols)", rows: 200, features: 5 },
  { label: "Medium (1K rows, 15 cols)", rows: 1000, features: 15 },
  { label: "Large (10K rows, 20 cols)", rows: 10000, features: 20 },
  { label: "XL (50K+ rows, 30 cols)", rows: 50000, features: 30 },
];

export default function ModelsPage() {
  const [tab, setTab] = useState<"classification" | "regression">("classification");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [datasetPreset, setDatasetPreset] = useState(1); // default: Medium
  const [customRows, setCustomRows] = useState<number | null>(null);
  const [customFeatures, setCustomFeatures] = useState<number | null>(null);

  const models = tab === "classification" ? CLASSIFICATION_MODELS : REGRESSION_MODELS;
  const rows = customRows ?? DATASET_PRESETS[datasetPreset].rows;
  const features = customFeatures ?? DATASET_PRESETS[datasetPreset].features;

  // Auto mode estimate (3x multiplier, same as train page)
  const autoEst = estimateForModel(rows, features, 3.0 * 1.5);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-6 py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Model Library</h1>
          <p className="mt-2 text-muted-foreground max-w-2xl">
            RetailMind offers <strong>19 machine learning models</strong> — 8 for classification (predicting categories)
            and 11 for regression (predicting numbers). In <strong>Auto mode</strong>, we test multiple models and pick the
            best one for your data automatically.
          </p>
        </div>

        {/* Auto Mode Banner */}
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30 px-5 py-4">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-semibold text-emerald-800 dark:text-emerald-300">Auto Mode (Recommended)</h3>
              <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
                Don&apos;t know which model to pick? Select <strong>Auto</strong> on the training page and RetailMind
                will evaluate up to 8 candidate models using cross-validation, then deploy the best performer.
                It automatically skips slow models (SVM, KNN) for large datasets and complex ensembles for small ones.
              </p>
              <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-500">
                Estimated for your dataset: <strong>~{autoEst.minutes < 1 ? "<1" : autoEst.minutes} min</strong>,{" "}
                <strong>${autoEst.cost < 0.01 ? "<0.01" : autoEst.cost.toFixed(2)}</strong> (Fargate compute)
              </p>
            </div>
          </div>
        </div>

        {/* Dataset Size Picker — controls cost estimates */}
        <div className="mb-6 rounded-xl border border-border/60 bg-card px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Database className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Estimate costs for your dataset size</h3>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {DATASET_PRESETS.map((preset, i) => (
              <button
                key={i}
                onClick={() => { setDatasetPreset(i); setCustomRows(null); setCustomFeatures(null); }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all border ${
                  customRows === null && datasetPreset === i
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                    : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2 text-muted-foreground">
              Rows:
              <input
                type="number"
                min={10}
                max={1000000}
                value={rows}
                onChange={(e) => setCustomRows(Math.max(10, parseInt(e.target.value) || 10))}
                className="w-24 rounded-md border border-border/60 bg-background px-2 py-1 text-xs font-mono text-foreground"
              />
            </label>
            <label className="flex items-center gap-2 text-muted-foreground">
              Features:
              <input
                type="number"
                min={1}
                max={500}
                value={features}
                onChange={(e) => setCustomFeatures(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20 rounded-md border border-border/60 bg-background px-2 py-1 text-xs font-mono text-foreground"
              />
            </label>
            <span className="text-xs text-muted-foreground ml-auto">
              Costs = Fargate compute only (ap-southeast-1 pricing)
            </span>
          </div>
        </div>

        {/* Tabs + View Toggle */}
        <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex rounded-lg border border-border/60 bg-secondary/30 p-1">
            <button
              onClick={() => setTab("classification")}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-all ${
                tab === "classification"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Classification ({CLASSIFICATION_MODELS.length})
            </button>
            <button
              onClick={() => setTab("regression")}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-all ${
                tab === "regression"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Regression ({REGRESSION_MODELS.length})
            </button>
          </div>

          <div className="flex rounded-lg border border-border/60 bg-secondary/30 p-1">
            <button
              onClick={() => setView("cards")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                view === "cards"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Detailed Cards
            </button>
            <button
              onClick={() => setView("table")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                view === "table"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Quick Compare
            </button>
          </div>
        </div>

        {/* Content */}
        {view === "cards" ? (
          <div className="space-y-3">
            {models.map((m) => (
              <ModelCard key={m.id} model={m} rows={rows} features={features} />
            ))}
          </div>
        ) : (
          <ComparisonTable models={models} rows={rows} features={features} />
        )}

        {/* Footer note */}
        <div className="mt-10 rounded-xl border border-border/40 bg-secondary/20 px-5 py-4">
          <p className="text-sm text-muted-foreground">
            <strong>How Auto mode selects models:</strong> For datasets under 500 rows, simpler models (Linear, Decision Tree, Ridge, Lasso)
            are preferred to avoid overfitting. For datasets over 50K rows, slow models (SVM, KNN) are skipped.
            For everything in between, all {CLASSIFICATION_MODELS.length + REGRESSION_MODELS.length} models are evaluated.
            Each model is tuned via randomized hyperparameter search with 5-fold cross-validation.
            Cost estimates use the same formula as the training page (Fargate vCPU: ${FARGATE_VCPU_PER_HR}/hr, Memory: ${FARGATE_MEM_PER_GB_HR}/GB-hr).
          </p>
        </div>
      </div>
    </div>
  );
}
