"use client";

import React, { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useProjectId } from "@/hooks/useProjectId";
import { cn } from "@/lib/utils";
import {
  Upload,
  Check,
  AlertTriangle,
  FileSpreadsheet,
  Play,
  X,
  Loader2,
  Info,
} from "lucide-react";
import { getProject, getUploadUrl, listPreloadedDatasets, selectPreloaded, recomputeProfile } from "@/lib/api";
import type { DataProfile, DataIssue, ColumnProfile, PreloadedDataset } from "@/lib/types";

const TYPE_BADGE: Record<string, { className: string; label: string }> = {
  numeric: { className: "bg-blue-50 text-blue-700 border-blue-200", label: "Number" },
  categorical: { className: "bg-purple-50 text-purple-700 border-purple-200", label: "Category" },
  text: { className: "border-border text-muted-foreground", label: "Text" },
  datetime: { className: "border-amber-200 text-amber-600 bg-amber-50", label: "Date" },
};

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-secondary", className)} />;
}

function mapDtype(dtype: string): ColumnProfile["dtype"] {
  if (dtype === "int64" || dtype === "float64") return "numeric";
  if (dtype === "object") return "categorical";
  if (dtype === "datetime64" || dtype === "datetime64[ns]") return "datetime";
  return "text";
}

function deriveDataIssues(profile: DataProfile): DataIssue[] {
  return profile.columns
    .filter((col) => col.nullCount > 0)
    .map((col) => ({
      column: col.name,
      issue: "missing_data" as const,
      description: `${col.nullCount} missing values (${col.nullPercent}%) found in ${col.name}.`,
      suggestedAction: `We'll fill missing values with the average. This is standard practice.`,
      strategy: "median" as const,
    }));
}

export default function UploadPage() {
  const id = useProjectId();

  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dataProfile, setDataProfile] = useState<DataProfile | null>(null);
  const [dataIssues, setDataIssues] = useState<DataIssue[]>([]);
  const [issueStrategies, setIssueStrategies] = useState<
    Record<string, string>
  >({});
  const [preloadedDatasets, setPreloadedDatasets] = useState<PreloadedDataset[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(true);

  const hasData = uploadedFile !== null || selectedDataset !== null;

  useEffect(() => {
    listPreloadedDatasets()
      .then(setPreloadedDatasets)
      .catch(() => {
        // Fallback: leave empty if API is unavailable
      })
      .finally(() => setDatasetsLoading(false));
  }, []);

  const fetchProfile = useCallback(async () => {
    try {
      const project = await getProject(id);
      if (project.dataProfile) {
        const raw = project.dataProfile as unknown as Record<string, unknown>;
        const rowCount = raw.rowCount as number;
        const columns = (raw.columns as Record<string, unknown>[]).map(
          (col) => ({
            name: col.name as string,
            dtype: mapDtype(col.dtype as string),
            nullCount: (col.nullCount as number) ?? 0,
            nullPercent: parseFloat(
              (((col.nullCount as number) / rowCount) * 100).toFixed(2)
            ),
            uniqueCount: (col.uniqueCount as number) ?? 0,
            ...(col.mean !== undefined ? { mean: col.mean as number } : {}),
            ...(col.std !== undefined ? { std: col.std as number } : {}),
            ...(col.min !== undefined ? { min: col.min as number } : {}),
            ...(col.max !== undefined ? { max: col.max as number } : {}),
          })
        );
        const profile: DataProfile = {
          rowCount,
          colCount: (raw.columnCount as number) ?? columns.length,
          columns,
          preview: (raw.preview as Record<string, string | number | null>[]) ?? [],
          nullSummary: columns
            .filter((c) => c.nullCount > 0)
            .map((c) => ({ column: c.name, nullPercent: c.nullPercent })),
        };
        setDataProfile(profile);
        const issues = deriveDataIssues(profile);
        setDataIssues(issues);
        setIssueStrategies(
          Object.fromEntries(issues.map((i) => [i.column, i.strategy]))
        );
      }
    } catch {
      // Profile not available yet
    }
  }, [id]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const uploadFile = useCallback(
    async (file: File) => {
      setIsUploading(true);
      setUploadError(null);
      try {
        // Step 1: Get presigned upload URL from backend
        const { uploadUrl } = await getUploadUrl(id, file.name);

        // Step 2: Upload directly to S3 via presigned URL
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "text/csv" },
          body: file,
        });
        if (!putRes.ok) {
          throw new Error(`Upload to S3 failed: ${putRes.status}`);
        }

        setUploadedFile(file.name);
        setSelectedDataset(null);

        // Step 3: Trigger data profiling
        try {
          await recomputeProfile(id, "", undefined, true);
        } catch {
          // Profiling may fail but upload succeeded
        }
        await fetchProfile();
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed");
        setUploadedFile(null);
      } finally {
        setIsUploading(false);
      }
    },
    [id, fetchProfile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) {
        uploadFile(file);
      }
    },
    [uploadFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        uploadFile(file);
      }
    },
    [uploadFile]
  );

  const handleSelectDataset = useCallback(async (datasetId: string) => {
    setSelectedDataset(datasetId);
    setUploadedFile(null);
    setIsUploading(true);
    setUploadError(null);
    try {
      await selectPreloaded(id, datasetId);
      // Trigger data profiling
      try {
        await recomputeProfile(id, "", undefined, true);
      } catch {
        // Profiling may fail but selection succeeded
      }
      await fetchProfile();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to load dataset");
      setSelectedDataset(null);
    } finally {
      setIsUploading(false);
    }
  }, [id, fetchProfile]);

  const handleIssueAction = (column: string, strategy: string) => {
    setIssueStrategies((prev) => ({
      ...prev,
      [column]: strategy,
    }));
  };

  const previewKeys =
    dataProfile && dataProfile.preview.length > 0
      ? Object.keys(dataProfile.preview[0])
      : [];

  return (
    <div className="mx-auto max-w-2xl space-y-10 px-6 pb-12 pt-10">
      <h1 className="text-2xl font-display tracking-tight text-center">Upload your data</h1>

      {/* Upload Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative flex flex-col items-center justify-center w-full rounded-xl px-12 py-20 transition-all duration-300 cursor-pointer border-2 border-dashed",
          isDragOver
            ? "bg-emerald-50/30 border-emerald-400"
            : "bg-card border-border",
          uploadedFile && "bg-emerald-50/30 border-emerald-300"
        )}
      >
        <input
          type="file"
          accept=".csv"
          onChange={handleFileInput}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
        {isUploading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
            <p className="font-medium text-muted-foreground text-sm">Uploading...</p>
          </div>
        ) : uploadedFile ? (
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
              <Check className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="text-center">
              <p className="font-medium text-emerald-800 text-sm">{uploadedFile}</p>
              <p className="text-xs text-emerald-600 mt-1">File ready for analysis</p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setUploadedFile(null);
                setDataProfile(null);
                setDataIssues([]);
              }}
              className="mt-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <>
            <Upload className="h-8 w-8 text-muted-foreground/40 mb-3" />
            <p className="font-medium text-muted-foreground text-sm">
              Drag & drop a CSV or click to browse
            </p>
            {uploadError && (
              <p className="text-xs text-red-500 mt-2">{uploadError}</p>
            )}
          </>
        )}
      </div>

      {/* Preloaded Datasets */}
      <div>
        <p className="text-xs text-muted-foreground mb-2">Or try a sample dataset</p>
        {datasetsLoading ? (
          <div className="flex flex-col gap-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        ) : preloadedDatasets.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No sample datasets available.</p>
        ) : (
        <div className="flex flex-col gap-1">
          {preloadedDatasets.map((ds) => (
            <button
              key={ds.id}
              onClick={() => handleSelectDataset(ds.id)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-300 text-sm",
                selectedDataset === ds.id
                  ? "bg-emerald-50 text-emerald-900 border border-emerald-200"
                  : "hover:bg-secondary text-muted-foreground hover:text-foreground border border-transparent"
              )}
            >
              <FileSpreadsheet className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">
                {ds.name}
                <span className="text-xs ml-2 opacity-60">
                  ({ds.rows.toLocaleString()} rows)
                </span>
              </span>
              {selectedDataset === ds.id && (
                isUploading ? (
                  <Loader2 className="h-4 w-4 text-muted-foreground shrink-0 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                )
              )}
            </button>
          ))}
        </div>
        )}
        {uploadError && !uploadedFile && (
          <p className="text-xs text-red-500 mt-2">{uploadError}</p>
        )}
      </div>

      {/* Data Preview and Issues */}
      {hasData && (
        <>
          {dataProfile && (
            <div>
              <p className="text-sm font-medium text-foreground mb-2">Data preview</p>

              {/* Null values warning banner */}
              {dataProfile.columns.some((c) => c.nullCount > 0) && (
                <div className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-2.5 mb-3 text-xs text-amber-800">
                  <Info className="h-4 w-4 shrink-0 text-amber-500" />
                  <span>
                    {dataProfile.columns.filter((c) => c.nullCount > 0).length} column(s) contain missing values.
                    These will be handled automatically during preprocessing.
                  </span>
                </div>
              )}

              <div className="overflow-x-auto border border-border/60 rounded-xl overflow-hidden">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-secondary">
                      {previewKeys.map((key) => {
                        const colProfile = dataProfile.columns.find((c) => c.name === key);
                        const badge = colProfile
                          ? TYPE_BADGE[colProfile.dtype] ?? TYPE_BADGE.text
                          : null;
                        return (
                          <th
                            key={key}
                            className="whitespace-nowrap border border-border/60 px-3 py-2 text-left font-medium text-foreground/80"
                          >
                            <span className="flex items-center gap-1.5">
                              {key}
                              {badge && (
                                <span className={cn("rounded-full border px-1.5 py-px text-[10px] font-normal", badge.className)}>
                                  {badge.label}
                                </span>
                              )}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {dataProfile.preview.map((row, i) => (
                      <tr key={i}>
                        {previewKeys.map((key) => (
                          <td
                            key={key}
                            className="whitespace-nowrap border border-border/60 px-3 py-2 text-muted-foreground"
                          >
                            {String(row[key] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Showing first {dataProfile.preview.length} of{" "}
                {dataProfile.rowCount.toLocaleString()} rows
              </p>
            </div>
          )}

          {/* Data Issues */}
          {dataIssues.length > 0 && (
            <div>
              <p className="text-sm font-medium text-foreground mb-2">Data issues</p>
              <div className="space-y-2">
                {dataIssues.map((issue) => (
                  <div
                    key={issue.column}
                    className="rounded-xl border border-border/60 bg-card p-4 shadow-sm"
                  >
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground">
                          <span className="font-medium">{issue.column}</span>
                          {" - "}Missing data
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {issue.description}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            onClick={() => handleIssueAction(issue.column, "mean")}
                            className={cn(
                              "rounded-lg px-3 py-1 text-xs font-medium transition-all duration-300 border",
                              issueStrategies[issue.column] === "mean"
                                ? "bg-secondary border-foreground/20 text-foreground"
                                : "bg-card border-border text-muted-foreground hover:bg-secondary"
                            )}
                          >
                            Fill with average value
                          </button>
                          <button
                            onClick={() => handleIssueAction(issue.column, "drop_rows")}
                            className={cn(
                              "rounded-lg px-3 py-1 text-xs font-medium transition-all duration-300 border",
                              issueStrategies[issue.column] === "drop_rows"
                                ? "bg-secondary border-foreground/20 text-foreground"
                                : "bg-card border-border text-muted-foreground hover:bg-secondary"
                            )}
                          >
                            Skip rows
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Analyse Button */}
          <div className="flex justify-end">
            <Link
              href={`/projects/${id}/chat`}
              className="inline-flex items-center gap-2 rounded-lg bg-foreground hover:bg-foreground/90 text-background font-medium px-6 py-2.5 transition-all duration-300 text-sm"
            >
              <Play className="h-4 w-4" />
              Continue &rarr;
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
