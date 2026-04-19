"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useProjectId } from "@/hooks/useProjectId";
import Link from "next/link";
import {
  Play,
  ArrowLeft,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Upload,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { cn } from "@/lib/utils";
import { getProject, runInference } from "@/lib/api";
import type { Project, PredictionResult, ColumnProfile } from "@/lib/types";

function mapDtype(dtype: string): ColumnProfile["dtype"] {
  if (dtype === "int64" || dtype === "float64" || dtype === "numeric") return "numeric";
  if (dtype === "object" || dtype === "str" || dtype === "string" || dtype === "category" || dtype === "bool" || dtype === "categorical" || dtype === "string[python]" || dtype === "String") return "categorical";
  if (dtype.startsWith("datetime")) return "datetime";
  return "text";
}

type InferenceTab = "single" | "batch";

interface BatchRow {
  input: Record<string, string | number>;
  prediction?: string;
  confidence?: number;
  error?: string;
  status: "pending" | "running" | "done" | "error";
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    if (vals.length !== headers.length) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, j) => { row[h] = vals[j]; });
    rows.push(row);
  }
  return rows;
}

function downloadCSV(headers: string[], rows: string[][]): void {
  const csvContent = [
    headers.join(","),
    ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "predictions.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function InferencePage() {
  const id = useProjectId();

  const [project, setProject] = useState<Project | null>(null);
  const [projectLoading, setProjectLoading] = useState(true);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<InferenceTab>("single");

  // Single prediction state
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Batch prediction state
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  // Load project to get feature columns
  useEffect(() => {
    setProjectLoading(true);
    getProject(id)
      .then((p) => {
        // Map raw pandas dtypes to frontend types
        if (p.dataProfile?.columns) {
          p.dataProfile.columns = p.dataProfile.columns.map((c) => ({
            ...c,
            dtype: mapDtype(c.dtype),
          }));
        }
        setProject(p);
        // Initialize form values with empty strings for each feature column
        if (p.dataProfile?.columns) {
          const featureCols = p.selectedFeatures?.length
            ? p.dataProfile.columns.filter((c) =>
                (p.selectedFeatures as string[]).includes(c.name) &&
                c.name !== p.targetColumn
              )
            : p.dataProfile.columns.filter((c) => c.name !== p.targetColumn);

          const initialValues: Record<string, string> = {};
          featureCols.forEach((col) => {
            initialValues[col.name] = "";
          });
          setFormValues(initialValues);
        }
      })
      .catch((err) => {
        setProjectError(err instanceof Error ? err.message : "Failed to load project");
      })
      .finally(() => setProjectLoading(false));
  }, [id]);

  const featureColumns = project?.dataProfile?.columns
    ? (project.selectedFeatures?.length
        ? project.dataProfile.columns.filter(
            (c) =>
              (project.selectedFeatures as string[]).includes(c.name) &&
              c.name !== project.targetColumn
          )
        : project.dataProfile.columns.filter(
            (c) => c.name !== project.targetColumn
          ))
    : [];

  const featureNames = featureColumns.map((c) => c.name);

  const getJobId = useCallback(() => {
    return (
      project?.latestJobId ||
      (typeof window !== "undefined"
        ? localStorage.getItem(`trainJobId_${id}`)
        : null)
    );
  }, [project, id]);

  // ─── Single prediction ──────────────────────────────────────────────────────
  const handlePredict = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    const jobId = getJobId();
    if (!jobId) {
      setError("No trained model found. Please train a model first.");
      setLoading(false);
      return;
    }

    const record: Record<string, string | number> = {};
    for (const [key, val] of Object.entries(formValues)) {
      const num = Number(val);
      record[key] = val !== "" && !isNaN(num) ? num : val;
    }

    try {
      const response = await runInference(id, jobId, record);
      if (response.prediction !== undefined) {
        setResult(response);
      } else {
        setError("No prediction returned from the model.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prediction failed");
    } finally {
      setLoading(false);
    }
  };

  // ─── Batch prediction ──────────────────────────────────────────────────────
  const handleFileSelect = (file: File) => {
    setBatchFile(file);
    setBatchError(null);
    setBatchRows([]);
    setBatchProgress(0);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      if (parsed.length === 0) {
        setBatchError("Could not parse CSV. Ensure it has a header row and at least one data row.");
        return;
      }

      const rows: BatchRow[] = parsed.map((row) => {
        const input: Record<string, string | number> = {};
        featureNames.forEach((name) => {
          const val = row[name] ?? "";
          const num = Number(val);
          input[name] = val !== "" && !isNaN(num) ? num : val;
        });
        return { input, status: "pending" };
      });
      setBatchRows(rows);
    };
    reader.readAsText(file);
  };

  const handleBatchPredict = async () => {
    const jobId = getJobId();
    if (!jobId) {
      setBatchError("No trained model found. Please train a model first.");
      return;
    }
    if (batchRows.length === 0) {
      setBatchError("No rows to predict. Upload a CSV file first.");
      return;
    }

    setBatchRunning(true);
    setBatchError(null);
    setBatchProgress(0);
    abortRef.current = false;

    // Reset all rows to pending
    setBatchRows((prev) => prev.map((r) => ({ ...r, status: "pending", prediction: undefined, confidence: undefined, error: undefined })));

    const BATCH_SIZE = 5;
    const total = batchRows.length;

    for (let i = 0; i < total; i += BATCH_SIZE) {
      if (abortRef.current) break;

      const batchEnd = Math.min(i + BATCH_SIZE, total);
      const promises = [];

      for (let j = i; j < batchEnd; j++) {
        const rowIndex = j;
        // Mark as running
        setBatchRows((prev) => {
          const next = [...prev];
          next[rowIndex] = { ...next[rowIndex], status: "running" };
          return next;
        });

        promises.push(
          runInference(id, jobId, batchRows[rowIndex].input)
            .then((res) => {
              setBatchRows((prev) => {
                const next = [...prev];
                next[rowIndex] = {
                  ...next[rowIndex],
                  status: "done",
                  prediction: String(res.prediction),
                  confidence: res.confidence ?? undefined,
                };
                return next;
              });
            })
            .catch((err) => {
              setBatchRows((prev) => {
                const next = [...prev];
                next[rowIndex] = {
                  ...next[rowIndex],
                  status: "error",
                  error: err instanceof Error ? err.message : "Failed",
                };
                return next;
              });
            })
        );
      }

      await Promise.all(promises);
      setBatchProgress(Math.min(batchEnd, total));
    }

    setBatchRunning(false);
  };

  const handleDownloadResults = () => {
    const headers = [...featureNames, "Prediction", "Confidence"];
    const rows = batchRows.map((r) => [
      ...featureNames.map((n) => String(r.input[n] ?? "")),
      r.prediction ?? "",
      r.confidence != null ? (r.confidence * 100).toFixed(1) + "%" : "",
    ]);
    downloadCSV(headers, rows);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith(".csv")) {
      handleFileSelect(file);
    } else {
      setBatchError("Please upload a CSV file.");
    }
  };

  // ─── Render helpers ──────────────────────────────────────────────────────────
  if (projectLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (projectError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <AlertTriangle className="h-6 w-6 text-red-400" />
        <p className="text-red-500 text-sm">{projectError}</p>
        <Link href={`/projects/${id}/results`} className="text-sm text-muted-foreground hover:text-foreground underline">
          Back to Results
        </Link>
      </div>
    );
  }

  const probabilities = result?.probabilities ?? [];
  const confidence = result?.confidence ?? null;
  const hasConfidence = confidence !== null && confidence !== undefined;
  const isHighConfidence = hasConfidence && confidence >= 0.7;
  const barColors = ["#ef4444", "#22c55e", "#3b82f6", "#f59e0b", "#8b5cf6", "#06b6d4"];
  const completedBatch = batchRows.filter((r) => r.status === "done" || r.status === "error").length;

  return (
    <div className="mx-auto max-w-5xl px-6 space-y-8 pb-12 pt-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-display tracking-tight">Make a Prediction</h1>
        <Link
          href={`/projects/${id}/results`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Results
        </Link>
      </div>

      {/* Tab selector */}
      <div className="flex gap-1 bg-secondary rounded-xl p-1">
        {([
          { id: "single" as InferenceTab, label: "Single Prediction", icon: <Play className="h-4 w-4" /> },
          { id: "batch" as InferenceTab, label: "Batch Prediction", icon: <FileSpreadsheet className="h-4 w-4" /> },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-300",
              activeTab === tab.id
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── SINGLE PREDICTION TAB ──────────────────────────────────────────── */}
      {activeTab === "single" && (
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Input Form */}
          <div className="space-y-4">
            <p className="text-sm font-medium">Enter Details</p>
            <p className="text-xs text-muted-foreground mt-1">Fill in the details below and click Predict to see what the model thinks.</p>

            {featureColumns.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No feature columns found. Please ensure the project has data uploaded and profiled.
              </p>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                {featureColumns.map((col) => (
                  <div key={col.name}>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      {col.name}
                    </label>
                    {col.dtype === "categorical" && col.topValues && col.topValues.length > 0 ? (
                      <select
                        value={formValues[col.name] ?? ""}
                        onChange={(e) =>
                          setFormValues((prev) => ({
                            ...prev,
                            [col.name]: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-border px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-ring transition-all duration-300"
                      >
                        <option value="">Select...</option>
                        {col.topValues.map((tv) => (
                          <option key={tv.value} value={tv.value}>
                            {tv.value}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={col.dtype === "numeric" ? "number" : "text"}
                        step={col.dtype === "numeric" ? "any" : undefined}
                        value={formValues[col.name] ?? ""}
                        onChange={(e) =>
                          setFormValues((prev) => ({
                            ...prev,
                            [col.name]: e.target.value,
                          }))
                        }
                        placeholder={
                          col.dtype === "numeric" && col.mean !== undefined
                            ? `e.g. ${col.mean.toFixed(2)}`
                            : ""
                        }
                        className="w-full rounded-lg border border-border px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-ring transition-all duration-300"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-xs text-red-600">{error}</p>
              </div>
            )}

            <button
              onClick={handlePredict}
              disabled={loading || featureColumns.length === 0}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-foreground h-12 text-sm font-medium text-background transition-all duration-300 hover:bg-foreground/90 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-sm border-2 border-muted-foreground border-t-transparent" />
                  Predicting...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Predict
                </>
              )}
            </button>
          </div>

          {/* Result */}
          {result ? (
            <div className="space-y-4">
              <div className={cn(
                "rounded-xl border border-border/60 shadow-sm p-6 text-center",
                hasConfidence
                  ? isHighConfidence ? "border-green-200 bg-green-50/50" : "border-amber-200 bg-amber-50/50"
                  : "border-blue-200 bg-blue-50/50"
              )}>
                {hasConfidence ? (
                  isHighConfidence ? (
                    <CheckCircle2 className="mx-auto h-7 w-7 text-green-500 mb-3" />
                  ) : (
                    <AlertTriangle className="mx-auto h-7 w-7 text-amber-400 mb-3" />
                  )
                ) : (
                  <TrendingUp className="mx-auto h-7 w-7 text-blue-500 mb-3" />
                )}
                <p className="text-xs text-muted-foreground">Prediction</p>
                <p className="text-xl font-semibold text-foreground">
                  {result.prediction}
                </p>
                {hasConfidence && (
                  <span className={cn(
                    "mt-2 inline-block rounded-full border px-3 py-0.5 text-xs font-medium",
                    isHighConfidence ? "border-green-200 text-green-600" : "border-amber-200 text-amber-600"
                  )}>
                    {(confidence * 100).toFixed(0)}% Confidence
                  </span>
                )}
              </div>

              {probabilities.length > 0 && (
                <div className="rounded-xl border border-border/60 shadow-sm p-4">
                  <p className="text-sm font-medium mb-3">Class Probabilities</p>
                  <div className="h-36">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={probabilities}
                        margin={{ top: 5, right: 20, bottom: 5, left: 20 }}
                      >
                        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                        <YAxis
                          domain={[0, 1]}
                          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                          tick={{ fontSize: 11 }}
                        />
                        <Tooltip
                          formatter={(value) => `${(Number(value) * 100).toFixed(1)}%`}
                        />
                        <Bar dataKey="probability" radius={[3, 3, 0, 0]} barSize={50}>
                          {probabilities.map((_, idx) => (
                            <Cell key={idx} fill={barColors[idx % barColors.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-border/60 shadow-sm p-4">
                <div className="flex items-start gap-3">
                  <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    <span className="font-medium text-foreground">Interpretation:</span>{" "}
                    The model predicts{" "}
                    <span className="font-medium">{result.prediction}</span>
                    {hasConfidence ? (
                      <>
                        {" "}with{" "}
                        <span className={cn("font-medium", isHighConfidence ? "text-green-600" : "text-amber-600")}>
                          {(confidence * 100).toFixed(0)}%
                        </span>{" "}
                        confidence.
                      </>
                    ) : (
                      <>.</>
                    )}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center rounded-2xl border-2 border-dashed border-border p-12">
              <div className="text-center">
                <Play className="mx-auto h-8 w-8 text-muted-foreground/40" />
                <p className="mt-3 text-sm text-muted-foreground">
                  Fill in the details and click <span className="font-medium text-foreground">Predict</span>
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── BATCH PREDICTION TAB ───────────────────────────────────────────── */}
      {activeTab === "batch" && (
        <div className="space-y-6">
          {/* Upload zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 cursor-pointer transition-all duration-300",
              batchFile
                ? "border-emerald-300 bg-emerald-50/50"
                : "border-border hover:border-foreground/30 hover:bg-secondary/50"
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
            />
            {batchFile ? (
              <>
                <FileSpreadsheet className="h-8 w-8 text-emerald-500 mb-2" />
                <p className="text-sm font-medium text-foreground">{batchFile.name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {batchRows.length} row{batchRows.length !== 1 ? "s" : ""} parsed
                </p>
                <p className="text-xs text-muted-foreground/70 mt-2">Click or drag to replace</p>
              </>
            ) : (
              <>
                <Upload className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">
                  Drag and drop a CSV file, or <span className="font-medium text-foreground underline">browse</span>
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  CSV should include columns: {featureNames.slice(0, 3).join(", ")}
                  {featureNames.length > 3 ? `, ... (+${featureNames.length - 3} more)` : ""}
                </p>
              </>
            )}
          </div>

          {batchError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs text-red-600">{batchError}</p>
            </div>
          )}

          {/* Controls */}
          {batchRows.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                onClick={handleBatchPredict}
                disabled={batchRunning}
                className="inline-flex items-center gap-2 rounded-lg bg-foreground px-5 h-10 text-sm font-medium text-background transition-all duration-300 hover:bg-foreground/90 disabled:opacity-50"
              >
                {batchRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Predicting... ({batchProgress}/{batchRows.length})
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Predict All ({batchRows.length} rows)
                  </>
                )}
              </button>

              {batchRunning && (
                <button
                  onClick={() => { abortRef.current = true; }}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 h-10 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                >
                  Stop
                </button>
              )}

              {completedBatch > 0 && !batchRunning && (
                <button
                  onClick={handleDownloadResults}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-4 h-10 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                >
                  <Download className="h-4 w-4" />
                  Download Results
                </button>
              )}

              {batchRunning && (
                <div className="flex-1">
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                      style={{ width: `${(batchProgress / batchRows.length) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Results table */}
          {batchRows.length > 0 && (
            <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-secondary/50">
                    <th className="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground w-10">#</th>
                    {featureNames.slice(0, 5).map((name) => (
                      <th key={name} className="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground">
                        {name}
                      </th>
                    ))}
                    {featureNames.length > 5 && (
                      <th className="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground/70">
                        +{featureNames.length - 5} more
                      </th>
                    )}
                    <th className="border-b border-border px-3 py-2 text-left font-medium text-primary bg-primary/5">
                      Prediction
                    </th>
                    <th className="border-b border-border px-3 py-2 text-left font-medium text-primary bg-primary/5">
                      Confidence
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {batchRows.slice(0, 200).map((row, i) => (
                    <tr key={i} className={cn(row.status === "running" && "bg-blue-50/50")}>
                      <td className="border-b border-border/50 px-3 py-2 text-muted-foreground">{i + 1}</td>
                      {featureNames.slice(0, 5).map((name) => (
                        <td key={name} className="border-b border-border/50 px-3 py-2 max-w-[120px] truncate">
                          {String(row.input[name] ?? "")}
                        </td>
                      ))}
                      {featureNames.length > 5 && (
                        <td className="border-b border-border/50 px-3 py-2 text-muted-foreground/50">...</td>
                      )}
                      <td className="border-b border-border/50 px-3 py-2 bg-primary/5 font-medium">
                        {row.status === "running" ? (
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        ) : row.status === "error" ? (
                          <span className="text-red-500" title={row.error}>Error</span>
                        ) : row.prediction !== undefined ? (
                          row.prediction
                        ) : (
                          <span className="text-muted-foreground/40">--</span>
                        )}
                      </td>
                      <td className="border-b border-border/50 px-3 py-2 bg-primary/5">
                        {row.confidence != null ? (
                          <span className={cn(
                            "font-medium",
                            row.confidence >= 0.7 ? "text-green-600" : "text-amber-500"
                          )}>
                            {(row.confidence * 100).toFixed(0)}%
                          </span>
                        ) : row.status === "done" ? (
                          <span className="text-muted-foreground/40">--</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {batchRows.length > 200 && (
                <div className="px-3 py-2 text-xs text-muted-foreground text-center border-t border-border/50">
                  Showing first 200 of {batchRows.length} rows. Download the full results as CSV.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
