"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useProjectId } from "@/hooks/useProjectId";
import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  ChevronDown,
  Play,
  Zap,
  Database,
  Target,
  Columns,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getProject, triggerPipeline, getJobStatus } from "@/lib/api";
import type { Project, PipelineStep, StepStatus, JobStatus, CostEstimate } from "@/lib/types";

// ── AWS pricing (ap-southeast-1) ──────────────────────────────────────────
const FARGATE_VCPU_PER_HR = 0.04048;   // per vCPU-hour
const FARGATE_MEM_PER_GB_HR = 0.004445; // per GB-hour
const FARGATE_VCPU = 1;
const FARGATE_MEM_GB = 2;
const S3_PER_GB = 0.025;               // per GB-month
const BEDROCK_PER_1K_INPUT = 0.00025;   // Claude Haiku input
const BEDROCK_PER_1K_OUTPUT = 0.00125;  // Claude Haiku output

function estimateCost(
  rows: number,
  features: number,
  modelType: string,
): CostEstimate {
  // Estimate training duration (minutes) based on dataset size and model
  let baseMinutes: number;
  if (rows < 1000) baseMinutes = 1;
  else if (rows < 10000) baseMinutes = 3;
  else if (rows < 50000) baseMinutes = 10;
  else baseMinutes = 25;

  // Model complexity multiplier
  const complexModels = ["xgboost", "random_forest", "auto"];
  const multiplier = complexModels.includes(modelType) ? 1.5 : 1.0;
  // Auto mode tries multiple models
  const autoMultiplier = modelType === "auto" ? 3.0 : 1.0;
  // Feature count adjustment
  const featureMultiplier = Math.max(1, features / 10);

  const estimatedMinutes = Math.round(baseMinutes * multiplier * autoMultiplier * featureMultiplier * 10) / 10;
  const computeHours = estimatedMinutes / 60;

  // Fargate cost for the training job
  const fargateCost = computeHours * (FARGATE_VCPU * FARGATE_VCPU_PER_HR + FARGATE_MEM_GB * FARGATE_MEM_PER_GB_HR);

  // Storage: raw CSV (~80 bytes/row/col) + processed (2x for train/val) + model (~3MB)
  const rawDataMB = (rows * Math.max(features, 1) * 80) / (1024 * 1024);
  const processedMB = rawDataMB * 2;
  const modelMB = 3;
  const totalStorageGB = (rawDataMB + processedMB + modelMB) / 1024;
  const storageCost = totalStorageGB * S3_PER_GB;

  // Bedrock tokens: ~7 calls (3 chatbot + 2 interpretation + 2 results chat)
  // ~500 input tokens + ~300 output tokens per call average
  const bedrockCalls = 7;
  const inputTokens = bedrockCalls * 500;
  const outputTokens = bedrockCalls * 300;
  const tokenCost = (inputTokens / 1000) * BEDROCK_PER_1K_INPUT + (outputTokens / 1000) * BEDROCK_PER_1K_OUTPUT;
  const totalTokensK = Math.round((inputTokens + outputTokens) / 100) / 10;

  const totalCost = Math.round((fargateCost + storageCost + tokenCost) * 10000) / 10000;

  return {
    computeHours: Math.round(computeHours * 100) / 100,
    storageGB: Math.round(totalStorageGB * 100) / 100,
    tokens: totalTokensK,
    totalCost: Math.round(totalCost * 100) / 100,
  };
}

const POLL_INTERVAL_MS = 5000;

const CLF_MODELS = [
  { value: "auto", label: "Auto (Best Model)", desc: "Tries multiple approaches, picks the best one" },
  { value: "xgboost", label: "XGBoost", desc: "Fast and accurate - recommended for most tasks" },
  { value: "random_forest", label: "Random Forest", desc: "Reliable predictions using multiple decision paths" },
  { value: "logistic", label: "Logistic Regression", desc: "Simple and easy to understand" },
  { value: "decision_tree", label: "Decision Tree", desc: "Creates clear if-then rules you can follow" },
];

const REG_MODELS = [
  { value: "auto", label: "Auto (Best Model)", desc: "Tries multiple approaches, picks the best one" },
  { value: "xgboost", label: "XGBoost", desc: "Fast and accurate - recommended for most tasks" },
  { value: "random_forest", label: "Random Forest", desc: "Reliable predictions using multiple decision paths" },
  { value: "linear", label: "Linear Regression", desc: "Simple and easy to understand" },
  { value: "decision_tree", label: "Decision Tree", desc: "Creates clear if-then rules you can follow" },
];

const STEP_DESCRIPTIONS: Record<string, string> = {
  profiling: "Scanning your data for patterns, missing values, and column types...",
  preprocessing: "Cleaning data, handling missing values, preparing for training...",
  model_selection: "Choosing the best approach based on your data...",
  training: "Building and testing the prediction model...",
  evaluation: "Measuring how accurate the model is...",
  deployment: "Saving your model and preparing results...",
};

const INITIAL_STEPS: PipelineStep[] = [
  { name: "profiling", label: "Data Profiling", status: "pending" },
  { name: "preprocessing", label: "Preprocessing", status: "pending" },
  { name: "model_selection", label: "Model Selection", status: "pending" },
  { name: "training", label: "Training", status: "pending" },
  { name: "evaluation", label: "Testing", status: "pending" },
  { name: "deployment", label: "Finalizing", status: "pending" },
];

/**
 * Maps a job status from the API to the pipeline step statuses for the UI.
 * Returns a new array of PipelineStep with correct statuses.
 */
function mapJobStatusToSteps(
  jobStatus: JobStatus,
  failureReason?: string | null
): PipelineStep[] {
  const steps = INITIAL_STEPS.map((s) => ({ ...s }));

  // Define the mapping from job status to step index currently running
  // Steps: 0=profiling, 1=preprocessing, 2=model_selection, 3=training, 4=evaluation, 5=deployment
  const statusToRunningIndex: Record<string, number> = {
    STARTING: 0,
    PROFILING: 0,
    PREPROCESSING: 1,
    TRAINING: 3, // model_selection (2) is done by the time training starts
    EVALUATING: 4,
    COMPLETED: 6, // all done (past last index)
    FAILED: -1, // handled separately
  };

  if (jobStatus === "COMPLETED") {
    return steps.map((s) => ({ ...s, status: "completed" as StepStatus }));
  }

  if (jobStatus === "FAILED") {
    // Find which step was likely running based on generic logic;
    // mark everything before it as completed, the current step as failed
    // We can't know exactly which step failed without more info,
    // so mark all as completed except the last, which is failed
    // Actually, we'll mark based on a heuristic from failureReason or just mark
    // the first non-completed step as failed. Since we don't track which step
    // was last running when it failed, we'll mark the first pending step as failed.
    // Better approach: just mark all steps as completed up to the step, leave
    // the rest as "failed" for the first pending one.
    // Since we lose the "last running step" on failure, we'll show a generic failure.
    return steps.map((s, i) => {
      if (i === 0) return { ...s, status: "failed" as StepStatus, detail: failureReason || "Pipeline failed" };
      return { ...s, status: "pending" as StepStatus };
    });
  }

  const runningIndex = statusToRunningIndex[jobStatus] ?? 0;

  return steps.map((s, i) => {
    if (i < runningIndex) {
      return { ...s, status: "completed" as StepStatus };
    }
    if (i === runningIndex) {
      return { ...s, status: "running" as StepStatus };
    }
    return { ...s, status: "pending" as StepStatus };
  });
}

function StepStatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    case "running":
      return <Loader2 className="h-5 w-5 text-emerald-600 animate-spin" />;
    case "failed":
      return <XCircle className="h-5 w-5 text-red-500" />;
    default:
      return <Circle className="h-5 w-5 text-muted-foreground/50" />;
  }
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export default function TrainPage() {
  const id = useProjectId();
  const searchParams = useSearchParams();

  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    getProject(id).then(setProject).catch(() => {});
  }, [id]);

  const [selectedModel, setSelectedModel] = useState<string>(
    searchParams.get("modelType") || "auto"
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [trainSplit, setTrainSplit] = useState(80);
  const [cvFolds, setCvFolds] = useState(5);
  const [isTraining, setIsTraining] = useState(false);
  const [steps, setSteps] = useState<PipelineStep[]>(INITIAL_STEPS);
  const [allComplete, setAllComplete] = useState(false);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [completedModelType, setCompletedModelType] = useState<string | null>(null);
  const [completedDuration, setCompletedDuration] = useState<number | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isRegression = project?.taskType === "regression";
  const modelOptions = isRegression ? REG_MODELS : CLF_MODELS;
  const rowCount = project?.dataProfile
    ? (project.dataProfile as { rowCount?: number }).rowCount
    : null;
  const featureCount = (project?.selectedFeatures as string[] | undefined)?.length ?? null;

  // Elapsed timer - runs every second when training is active
  useEffect(() => {
    if (!isTraining || !startTime) return;
    setElapsedSec(Math.floor((Date.now() - startTime) / 1000));
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isTraining, startTime]);

  // Clean up poll interval on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollJobStatus = useCallback(
    async (projectId: string, activeJobId: string) => {
      try {
        const job = await getJobStatus(projectId, activeJobId);
        const newSteps = mapJobStatusToSteps(job.status, job.failureReason);
        setSteps(newSteps);

        if (job.status === "COMPLETED") {
          stopPolling();
          setAllComplete(true);
          setIsTraining(false);
          setCompletedModelType(job.modelType || null);
          setCompletedDuration(job.trainingDurationSec || null);
          // Clean up localStorage since training is done
          localStorage.removeItem(`trainJobId_${projectId}`);
          localStorage.removeItem(`trainStartTime_${projectId}`);
        } else if (job.status === "FAILED") {
          stopPolling();
          setTrainingError(job.failureReason || "Training pipeline failed");
          setIsTraining(false);
          localStorage.removeItem(`trainJobId_${projectId}`);
          localStorage.removeItem(`trainStartTime_${projectId}`);
        }
      } catch {
        // Network error during polling - don't stop, just skip this tick
      }
    },
    [stopPolling]
  );

  const startPolling = useCallback(
    (projectId: string, activeJobId: string) => {
      // Clear any existing intervals first
      stopPolling();

      // Poll immediately, then every POLL_INTERVAL_MS
      pollJobStatus(projectId, activeJobId);
      pollRef.current = setInterval(() => {
        pollJobStatus(projectId, activeJobId);
      }, POLL_INTERVAL_MS);
    },
    [stopPolling, pollJobStatus]
  );

  // startElapsedTimer is now handled by the useEffect above - just set startTime

  // On page load: check if there's an active job in localStorage and resume polling
  useEffect(() => {
    if (id === "unknown") return;

    const savedJobId = localStorage.getItem(`trainJobId_${id}`);
    const savedStartTime = localStorage.getItem(`trainStartTime_${id}`);

    if (savedJobId) {
      // Resume polling for an existing job
      setJobId(savedJobId);
      setIsTraining(true);
      setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: "pending" as StepStatus })));

      const resumedStart = savedStartTime ? parseInt(savedStartTime, 10) : Date.now();
      setStartTime(resumedStart);
      // Timer starts automatically via useEffect when startTime is set
      startPolling(id, savedJobId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function startTraining() {
    setIsTraining(true);
    setAllComplete(false);
    setTrainingError(null);
    setJobId(null);
    setCompletedModelType(null);
    setCompletedDuration(null);
    setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: "pending" as StepStatus })));

    try {
      const targetCol = project?.targetColumn || "";
      const features = (project?.selectedFeatures as string[] | undefined) ?? [];

      const data = await triggerPipeline(id, {
        targetColumn: targetCol,
        selectedFeatures: features.length > 0 ? features : undefined,
        modelType: selectedModel !== "auto" ? selectedModel : undefined,
        mode: selectedModel === "auto" ? "auto" : "single",
        trainSplit: trainSplit / 100,
      });

      const newJobId = data.jobId;
      setJobId(newJobId);

      // Persist to localStorage so we can resume on page reload
      const now = Date.now();
      localStorage.setItem(`trainJobId_${id}`, newJobId);
      localStorage.setItem(`trainStartTime_${id}`, now.toString());
      setStartTime(now);
      // Timer starts automatically via useEffect when startTime is set

      // Set initial state: profiling running
      setSteps(mapJobStatusToSteps("STARTING"));

      // Start polling
      startPolling(id, newJobId);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to start training";
      setTrainingError(errorMsg);
      setIsTraining(false);
      setSteps(INITIAL_STEPS.map((s, i) =>
        i === 0
          ? { ...s, status: "failed" as StepStatus, detail: errorMsg }
          : s
      ));
    }
  }

  const cost = estimateCost(
    rowCount ?? 1000,
    featureCount ?? 5,
    selectedModel,
  );

  return (
    <div className="mx-auto max-w-3xl px-6 space-y-8 pb-12 pt-10">
      {!isTraining && !allComplete && (
        <>
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-display tracking-tight">Train a Model</h1>
            <Link
              href={`/projects/${id}/profile`}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground/80 transition-colors"
            >
              &larr; Back to Profile
            </Link>
          </div>

          {/* Project config summary */}
          {project && (
            <div className="rounded-xl border border-border/60 bg-card p-6 space-y-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground">Training Configuration</p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-secondary flex items-center justify-center">
                    <Database className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Dataset</p>
                    <p className="text-sm font-medium truncate max-w-[120px]">
                      {project.preloadedDataset || project.dataSource || "uploaded"}
                    </p>
                  </div>
                </div>

                {rowCount && (
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-md bg-secondary flex items-center justify-center">
                      <Columns className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Rows</p>
                      <p className="text-sm font-medium">{rowCount.toLocaleString()}</p>
                    </div>
                  </div>
                )}

                {project.targetColumn && (
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-md bg-amber-50 flex items-center justify-center">
                      <Target className="h-4 w-4 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Target</p>
                      <p className="text-sm font-medium truncate max-w-[120px]">{project.targetColumn}</p>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-secondary flex items-center justify-center">
                    <Zap className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Task</p>
                    <p className="text-sm font-medium capitalize">{project.taskType || "auto"}</p>
                  </div>
                </div>
              </div>

              {project.selectedFeatures && (project.selectedFeatures as string[]).length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Features ({(project.selectedFeatures as string[]).length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(project.selectedFeatures as string[]).map((f) => (
                      <span key={f} className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs text-muted-foreground">
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Model Selection */}
          <div>
            <p className="text-sm font-medium mb-3">Select Model</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {modelOptions.map((opt) => {
                const isSelected = selectedModel === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setSelectedModel(opt.value)}
                    className={cn(
                      "relative rounded-xl p-4 text-left transition-all duration-300 border",
                      isSelected
                        ? "border-emerald-500 bg-emerald-50/50 shadow-sm"
                        : "border-border/60 bg-card shadow-sm hover:border-border hover:shadow-md"
                    )}
                  >
                    <div className={cn(
                      "absolute top-3 right-3 h-4 w-4 rounded-full border-2 flex items-center justify-center transition-colors",
                      isSelected
                        ? "border-emerald-600"
                        : "border-border"
                    )}>
                      {isSelected && <div className="h-2 w-2 rounded-full bg-emerald-600" />}
                    </div>
                    <p className="text-sm font-medium text-foreground pr-6">
                      {opt.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Advanced Parameters */}
          <div className="rounded-xl border border-border/60 bg-card shadow-sm">
            <button
              onClick={() => setShowAdvanced((prev) => !prev)}
              className="flex items-center justify-between w-full px-5 py-3 text-sm font-medium"
            >
              Advanced Parameters
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showAdvanced && "rotate-180")} />
            </button>

            {showAdvanced && (
              <div className="px-5 pb-4 space-y-4 border-t pt-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-foreground/70">Train / Test Split</span>
                    <span className="text-sm font-medium">{trainSplit}% / {100 - trainSplit}%</span>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={95}
                    step={5}
                    value={trainSplit}
                    onChange={(e) => setTrainSplit(Number(e.target.value))}
                    className="w-full accent-emerald-600"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                    <span>50%</span>
                    <span>95%</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">We use this % to train, the rest to verify accuracy</p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-foreground/70">Cross Validation Folds</span>
                    <span className="text-sm font-medium">{cvFolds}-fold</span>
                  </div>
                  <div className="flex gap-2">
                    {[3, 5, 7, 10].map((n) => (
                      <button
                        key={n}
                        onClick={() => setCvFolds(n)}
                        className={cn(
                          "rounded-xl px-3 py-1.5 text-sm font-medium border transition-all duration-300",
                          cvFolds === n
                            ? "border-emerald-600 bg-emerald-600 text-white"
                            : "border-border text-foreground/70 hover:border-border"
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">More folds = more reliable but slower. 5 is standard.</p>
                </div>

                <div className="grid grid-cols-3 gap-4 pt-3 border-t">
                  <div>
                    <p className="text-xs text-muted-foreground">Rows</p>
                    <p className="text-sm font-medium">{rowCount?.toLocaleString() ?? "\u2014"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Features</p>
                    <p className="text-sm font-medium">{featureCount ?? "\u2014"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Task Type</p>
                    <p className="text-sm font-medium capitalize">{project?.taskType || "auto"}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Cost Estimator */}
          <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
            <p className="text-sm font-medium mb-1">Cost Estimate</p>
            <p className="text-xs text-muted-foreground mb-4">Estimated AWS cost for this training job (ap-southeast-1)</p>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xs text-muted-foreground">Package:</span>
                  <span className="rounded-md border border-border bg-secondary/50 px-2 py-0.5 text-xs font-medium text-foreground/80">
                    FREE-TIER
                  </span>
                </div>
                <UsageRow label="Compute" pct={Math.min(Math.round((cost.computeHours / 5) * 100), 100)} total="5 hr/month" />
                <UsageRow label="Storage" pct={Math.min(Math.round((cost.storageGB / 2) * 100), 100)} total="2 GB" />
                <UsageRow label="Tokens" pct={Math.min(Math.round((cost.tokens / 20) * 100), 100)} total="20k/month" />
              </div>

              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Estimated cost breakdown:</p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-foreground/70">Fargate ({cost.computeHours} hr)</span>
                    <span className="text-foreground/80 font-medium">${(cost.computeHours * (FARGATE_VCPU * FARGATE_VCPU_PER_HR + FARGATE_MEM_GB * FARGATE_MEM_PER_GB_HR)).toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-foreground/70">S3 ({cost.storageGB} GB)</span>
                    <span className="text-foreground/80 font-medium">${(cost.storageGB * S3_PER_GB).toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-foreground/70">Bedrock ({cost.tokens}k tokens)</span>
                    <span className="text-foreground/80 font-medium">${((cost.tokens * 1000 * 0.6 / 1000) * BEDROCK_PER_1K_INPUT + (cost.tokens * 1000 * 0.4 / 1000) * BEDROCK_PER_1K_OUTPUT).toFixed(4)}</span>
                  </div>
                </div>
                <div className="border-t pt-3 mt-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Estimated total</span>
                  <span className={cn(
                    "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-base font-semibold",
                    cost.totalCost === 0
                      ? "border-green-200 bg-green-50 text-green-700"
                      : cost.totalCost < 0.05
                        ? "border-green-200 bg-green-50 text-green-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                  )}>
                    ${cost.totalCost.toFixed(2)}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">Based on {rowCount?.toLocaleString() ?? "?"} rows &times; {featureCount ?? "?"} features, {selectedModel === "auto" ? "auto mode (multi-model)" : selectedModel}</p>
              </div>
            </div>
          </div>

          {/* Train button */}
          <div className="flex justify-center pt-2">
            <button
              onClick={startTraining}
              disabled={!selectedModel}
              className="inline-flex items-center gap-2 rounded-lg bg-foreground px-8 h-12 text-base font-medium text-background transition-all duration-300 hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="h-4 w-4 fill-white" />
              Train Model
            </button>
          </div>
        </>
      )}

      {/* Pipeline Progress */}
      {(isTraining || allComplete) && (
        <div className="pt-4">
          <h2 className="text-lg font-semibold text-center mb-2">
            {allComplete
              ? "Training Complete"
              : trainingError
                ? "Training Failed"
                : "Training in Progress..."}
          </h2>

          {/* Elapsed time */}
          {isTraining && !trainingError && (
            <div className="flex items-center justify-center gap-1.5 mb-6 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Elapsed: {formatElapsed(elapsedSec)}</span>
            </div>
          )}

          {/* Completion summary */}
          {allComplete && (
            <div className="flex items-center justify-center gap-4 mb-6">
              {completedModelType && (
                <span className="rounded-full border border-green-200 bg-green-50 px-3 py-1 text-sm text-green-700">
                  Model: {completedModelType}
                </span>
              )}
              {completedDuration != null && (
                <span className="rounded-full border border-border bg-secondary/50 px-3 py-1 text-sm text-foreground/70">
                  Duration: {formatElapsed(completedDuration)}
                </span>
              )}
            </div>
          )}

          {/* Progress bar */}
          {isTraining && !trainingError && (
            <div className="max-w-lg mx-auto mb-6">
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-1000"
                  style={{
                    width: `${Math.round(
                      (steps.filter((s) => s.status === "completed").length / steps.length) * 100
                    )}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center mt-1">
                {steps.filter((s) => s.status === "completed").length} of {steps.length} steps complete
              </p>
            </div>
          )}

          <div className="max-w-md mx-auto space-y-1">
            {steps.map((step, index) => (
              <div key={step.name}>
                <div className="flex items-start gap-3 py-3 rounded-xl px-3">
                  <div className="mt-0.5">
                    <StepStatusIcon status={step.status} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      "text-sm font-medium",
                      step.status === "pending" && "text-muted-foreground",
                      step.status === "running" && "text-emerald-600",
                      step.status === "completed" && "text-green-600",
                      step.status === "failed" && "text-red-500"
                    )}>
                      {step.label}
                    </p>
                    {step.status === "running" && STEP_DESCRIPTIONS[step.name] && (
                      <p className="text-xs mt-0.5 text-muted-foreground animate-pulse">{STEP_DESCRIPTIONS[step.name]}</p>
                    )}
                    {step.detail && step.status === "failed" && (
                      <p className="text-xs mt-0.5 text-red-400">{step.detail}</p>
                    )}
                  </div>
                  {step.status === "completed" && (
                    <span className="text-xs text-green-500 font-medium">Done</span>
                  )}
                  {step.status === "running" && (
                    <span className="text-xs text-emerald-500 font-medium animate-pulse">Running...</span>
                  )}
                </div>
                {index < steps.length - 1 && (
                  <div className="ml-[9px] h-3 w-0.5 bg-zinc-200" />
                )}
              </div>
            ))}
          </div>

          {/* Live activity log */}
          {isTraining && !trainingError && !allComplete && (
            <div className="max-w-lg mx-auto mt-8">
              <div className="rounded-xl border border-border/60 shadow-sm bg-zinc-950 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-xs font-medium text-muted-foreground">Live Activity</span>
                </div>
                <div className="font-mono text-xs text-muted-foreground space-y-1 max-h-32 overflow-y-auto">
                  {steps.filter((s) => s.status !== "pending").map((step) => (
                    <div key={step.name} className="flex gap-2">
                      <span className="text-foreground/70 shrink-0">[{new Date().toLocaleTimeString()}]</span>
                      <span className={cn(
                        step.status === "completed" && "text-green-400",
                        step.status === "running" && "text-emerald-400",
                        step.status === "failed" && "text-red-400",
                      )}>
                        {step.status === "completed" && `✓ ${step.label} completed`}
                        {step.status === "running" && `▸ ${step.label} in progress...`}
                        {step.status === "failed" && `✗ ${step.label} failed`}
                      </span>
                    </div>
                  ))}
                  <div className="flex gap-2 animate-pulse">
                    <span className="text-foreground/70 shrink-0">[{new Date().toLocaleTimeString()}]</span>
                    <span className="text-muted-foreground">Waiting for next update...</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {trainingError && (
            <div className="mt-8 text-center">
              <p className="text-sm text-red-500 font-medium">{trainingError}</p>
              <button
                onClick={() => {
                  setIsTraining(false);
                  setTrainingError(null);
                  setAllComplete(false);
                  setSteps(INITIAL_STEPS.map((s) => ({ ...s })));
                }}
                className="mt-3 text-sm text-foreground/70 hover:text-foreground underline"
              >
                Back to Configuration
              </button>
            </div>
          )}

          {allComplete && (
            <div className="mt-8 flex flex-col items-center gap-3">
              <Link
                href={`/projects/${id}/results${jobId ? `?jobId=${jobId}` : ""}`}
                className="inline-flex items-center gap-2 rounded-lg bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-all duration-300 hover:bg-foreground/90"
              >
                <Play className="h-4 w-4 fill-white" />
                View Results
              </Link>
              <button
                onClick={() => {
                  setAllComplete(false);
                  setIsTraining(false);
                  setJobId(null);
                  setSteps(INITIAL_STEPS.map((s) => ({ ...s })));
                  setCompletedModelType(null);
                  setCompletedDuration(null);
                  setElapsedSec(0);
                  setStartTime(null);
                }}
                className="text-sm text-muted-foreground hover:text-foreground/80 underline"
              >
                Train Another Model
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UsageRow({ label, pct, total }: { label: string; pct: number; total: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-foreground/70">{label}</span>
        <span className="text-xs text-muted-foreground">{pct}% &middot; {total}</span>
      </div>
      <div className="h-1.5 w-full rounded bg-secondary">
        <div className="h-1.5 rounded bg-secondary/500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
