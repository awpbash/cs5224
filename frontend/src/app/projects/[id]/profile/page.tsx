"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProjectId } from "@/hooks/useProjectId";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Check, ChevronDown, Play, BarChart3, GitBranch, PieChart as PieIcon, Columns, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getProject, recomputeProfile, updateProject } from "@/lib/api";
import type { ColumnProfile, DataProfile } from "@/lib/types";

const TYPE_BADGE: Record<string, { className: string; label: string }> = {
  numeric: { className: "bg-blue-50 text-blue-700 border-blue-200", label: "Number" },
  categorical: { className: "bg-purple-50 text-purple-700 border-purple-200", label: "Category" },
  text: { className: "border-border text-muted-foreground", label: "Text" },
  datetime: { className: "border-amber-200 text-amber-600 bg-amber-50", label: "Date" },
};

function mapDtype(dtype: string): ColumnProfile["dtype"] {
  if (dtype === "int64" || dtype === "float64" || dtype === "numeric") return "numeric";
  if (dtype === "object" || dtype === "str" || dtype === "string" || dtype === "category" || dtype === "bool" || dtype === "categorical" || dtype === "string[python]" || dtype === "String") return "categorical";
  if (dtype.startsWith("datetime")) return "datetime";
  return "text";
}

interface RawProfile extends Record<string, unknown> {
  rowCount: number;
  columnCount?: number;
  columns: Record<string, unknown>[];
  preview?: Record<string, string | number | null>[];
  correlation?: Record<string, Record<string, number>>;
  classBalance?: { label: string; count: number }[];
  pca?: {
    varianceExplained: number[];
    cumulativeVariance: number[];
    components: number;
    featureNames: string[];
    loadings?: { pc: number; topFeatures: { feature: string; loading: number }[] }[];
  };
  targetDistribution?: {
    type: string;
    column: string;
    histogram: { bin: string; count: number }[];
  };
}

function toFrontendProfile(raw: RawProfile): DataProfile {
  const rowCount = raw.rowCount;
  const columns = raw.columns.map((c) => {
    const dtype = mapDtype(c.dtype as string);
    const nullCount = (c.nullCount as number) ?? 0;
    const nullPercent = rowCount > 0 ? Math.round((nullCount / rowCount) * 10000) / 100 : 0;
    const col: ColumnProfile = {
      name: c.name as string,
      dtype,
      nullCount,
      nullPercent,
      uniqueCount: (c.uniqueCount as number) ?? 0,
      ...(c.mean !== undefined ? { mean: c.mean as number } : {}),
      ...(c.std !== undefined ? { std: c.std as number } : {}),
      ...(c.min !== undefined ? { min: c.min as number } : {}),
      ...(c.max !== undefined ? { max: c.max as number } : {}),
      ...(c.topValues ? { topValues: c.topValues as { value: string; count: number }[] } : {}),
      ...(c.distribution ? { distribution: c.distribution as { bin: string; count: number }[] } : {}),
    };
    return col;
  });

  return {
    rowCount,
    colCount: raw.columnCount ?? columns.length,
    columns,
    preview: raw.preview ?? [],
    nullSummary: columns
      .filter((c) => c.nullPercent > 0)
      .map((c) => ({ column: c.name, nullPercent: c.nullPercent })),
  };
}

const PIE_COLORS = ["#3f3f46", "#71717a", "#a1a1aa", "#d4d4d8", "#52525b", "#27272a", "#94a3b8", "#64748b"];
const CHART_FILL = "#52525b";

type TabId = "overview" | "features" | "correlation" | "pca";

export default function ProfilePage() {
  const id = useProjectId();
  const router = useRouter();

  const [profile, setProfile] = useState<DataProfile | null>(null);
  const [rawProfile, setRawProfile] = useState<RawProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const [targetColumn, setTargetColumn] = useState<string>("");
  const [selectedFeatures, setSelectedFeatures] = useState<Record<string, boolean>>({});
  const [autoFeature, setAutoFeature] = useState(false);
  const [recomputing, setRecomputing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getProject(id)
      .then((project) => {
        if (cancelled) return;
        if (!project.dataProfile) {
          setProfile(null);
          setLoading(false);
          return;
        }
        const raw = project.dataProfile as unknown as RawProfile;
        setRawProfile(raw);
        const fp = toFrontendProfile(raw);
        setProfile(fp);

        const savedTarget = project.targetColumn;
        if (savedTarget && fp.columns.some((c) => c.name === savedTarget)) {
          setTargetColumn(savedTarget);
        } else if (fp.columns.length > 0) {
          setTargetColumn(fp.columns[fp.columns.length - 1].name);
        }

        const savedFeatures = project.selectedFeatures as string[] | undefined;
        const map: Record<string, boolean> = {};
        if (savedFeatures && savedFeatures.length > 0) {
          fp.columns.forEach((col) => {
            map[col.name] = savedFeatures.includes(col.name);
          });
        } else {
          fp.columns.forEach((col) => {
            map[col.name] = true;
          });
        }
        setSelectedFeatures(map);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load project");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!targetColumn || !profile) return;
    const features = Object.entries(selectedFeatures)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (features.length === 0) return;

    const timer = setTimeout(() => {
      setRecomputing(true);
      recomputeProfile(id, targetColumn, features)
        .then((result) => {
          setRawProfile((prev) => prev ? {
            ...prev,
            correlation: result.correlation ?? prev.correlation,
            pca: result.pca ?? prev.pca,
            classBalance: result.classBalance ?? prev.classBalance,
            targetDistribution: result.targetDistribution ?? prev.targetDistribution,
          } : prev);
        })
        .catch(() => {})
        .finally(() => setRecomputing(false));
    }, 600);

    return () => clearTimeout(timer);
  }, [targetColumn, selectedFeatures, id, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  const [savedSuggestedFeatures, setSavedSuggestedFeatures] = useState<string[]>([]);

  // Load chatbot-suggested features on mount
  useEffect(() => {
    getProject(id).then((proj) => {
      const sf = proj?.selectedFeatures as string[] | undefined;
      if (sf && sf.length > 0) {
        setSavedSuggestedFeatures(sf);
      }
    }).catch(() => {});
  }, [id]);

  const handleAutoFeatureToggle = () => {
    if (!profile) return;
    const next = !autoFeature;
    setAutoFeature(next);
    if (next) {
      // Auto-select: use chatbot-suggested features if available, else only numeric
      const map: Record<string, boolean> = {};
      if (savedSuggestedFeatures.length > 0) {
        profile.columns.forEach((col) => {
          map[col.name] = savedSuggestedFeatures.includes(col.name);
        });
      } else {
        profile.columns.forEach((col) => {
          map[col.name] = col.dtype === "numeric";
        });
      }
      setSelectedFeatures(map);
    } else {
      // Toggle off: select ALL columns
      const map: Record<string, boolean> = {};
      profile.columns.forEach((col) => {
        map[col.name] = true;
      });
      setSelectedFeatures(map);
    }
  };

  const toggleFeature = (name: string) => {
    setSelectedFeatures((prev) => ({ ...prev, [name]: !prev[name] }));
    setAutoFeature(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-red-500 text-sm">{error}</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="text-muted-foreground text-sm">No data profile available. Please upload data first.</p>
        <Link href={`/projects/${id}/upload`} className="text-sm text-foreground/70 hover:text-foreground underline">
          Go to Upload
        </Link>
      </div>
    );
  }

  const totalMissing = profile.columns.reduce((acc, c) => acc + c.nullCount, 0);
  const selectedCount = Object.values(selectedFeatures).filter(Boolean).length;
  const numericCount = profile.columns.filter((c) => c.dtype === "numeric").length;
  const categoricalCount = profile.columns.filter((c) => c.dtype === "categorical").length;

  // ─── Data Readiness Score ──────────────────────────────────────────────────
  const readinessScore = (() => {
    let score = 100;

    // Null rate penalty: -2 per 1% average null rate
    const avgNullRate =
      profile.columns.length > 0
        ? profile.columns.reduce((sum, c) => sum + c.nullPercent, 0) / profile.columns.length
        : 0;
    score -= avgNullRate * 2;

    // Class imbalance penalty (if classification and classBalance available)
    if (rawProfile?.classBalance && rawProfile.classBalance.length >= 2) {
      const total = rawProfile.classBalance.reduce((s, b) => s + b.count, 0);
      const minClass = Math.min(...rawProfile.classBalance.map((b) => b.count));
      if (total > 0 && (minClass / total) < 0.2) {
        score -= 10;
      }
    }

    // Low row count penalty
    if (profile.rowCount < 100) {
      score -= 20;
    } else if (profile.rowCount < 500) {
      score -= 10;
    }

    // High cardinality bonus: +5 if most categorical cols have < 20 unique values
    const catCols = profile.columns.filter((c) => c.dtype === "categorical");
    if (catCols.length > 0) {
      const lowCardinality = catCols.filter((c) => c.uniqueCount < 20).length;
      if (lowCardinality / catCols.length > 0.5) {
        score += 5;
      }
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  })();

  const readinessColor =
    readinessScore >= 80 ? "text-green-600" : readinessScore >= 60 ? "text-amber-500" : "text-red-500";
  const readinessBg =
    readinessScore >= 80 ? "border-green-200 bg-green-50" : readinessScore >= 60 ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50";
  const readinessLabel =
    readinessScore >= 80 ? "Good" : readinessScore >= 60 ? "Fair" : "Poor";

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <BarChart3 className="h-4 w-4" /> },
    { id: "features", label: "Select Columns", icon: <Columns className="h-4 w-4" /> },
    { id: "correlation", label: "Relationships", icon: <GitBranch className="h-4 w-4" /> },
    { id: "pca", label: "Advanced", icon: <PieIcon className="h-4 w-4" /> },
  ];

  return (
    <div className="mx-auto max-w-5xl px-6 space-y-8 pb-12 pt-10">
      <h1 className="text-3xl font-display tracking-tight">Data Profile</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-4">
        <div className={cn("rounded-xl border p-4 text-center shadow-sm", readinessBg)}>
          <p className={cn("text-xl font-semibold", readinessColor)}>{readinessScore}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Readiness</p>
          <span className={cn("inline-block mt-1 rounded-full px-2 py-0.5 text-[10px] font-medium border", readinessBg, readinessColor)}>
            {readinessLabel}
          </span>
        </div>
        {[
          { label: "Rows", value: profile.rowCount.toLocaleString() },
          { label: "Columns", value: profile.colCount },
          { label: "Number Columns", value: numericCount },
          { label: "Category Columns", value: categoricalCount },
          { label: "Missing", value: totalMissing.toLocaleString() },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border/60 bg-card p-4 text-center shadow-sm">
            <p className="text-xl font-semibold text-foreground">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 bg-secondary rounded-xl p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-300",
              activeTab === tab.id
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground/80"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm font-medium">What do you want to predict?</span>
              <Select value={targetColumn} onValueChange={setTargetColumn}>
                <SelectTrigger className="h-8 w-48 text-sm border-emerald-300 bg-emerald-50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {profile.columns.map((col) => (
                    <SelectItem key={col.name} value={col.name}>{col.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {rawProfile?.targetDistribution?.histogram && rawProfile.targetDistribution.column === targetColumn && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Target Distribution</p>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rawProfile.targetDistribution.histogram}>
                      <XAxis dataKey="bin" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={50} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ fontSize: "11px", borderRadius: "6px" }} />
                      <Bar dataKey="count" fill={CHART_FILL} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {rawProfile?.classBalance && rawProfile.classBalance.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Class Balance</p>
                <div className="h-72 flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={rawProfile.classBalance}
                        dataKey="count"
                        nameKey="label"
                        cx="50%"
                        cy="45%"
                        outerRadius={80}
                        innerRadius={0}
                        label={false}
                      >
                        {rawProfile.classBalance.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => Number(value).toLocaleString()} />
                      <Legend
                        verticalAlign="bottom"
                        formatter={(value: string) => {
                          const item = rawProfile.classBalance?.find((b) => b.label === value);
                          const total = rawProfile.classBalance?.reduce((s, b) => s + b.count, 0) ?? 1;
                          const pct = item ? ((item.count / total) * 100).toFixed(0) : "?";
                          return `${value} (${pct}%)`;
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

          {/* Column types */}
          <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
            <p className="text-sm font-medium mb-3">Column Types</p>
            <div className="flex gap-2">
              {[
                { label: "Number Columns", count: numericCount },
                { label: "Category Columns", count: categoricalCount },
                { label: "Text", count: profile.columns.filter((c) => c.dtype === "text").length },
                { label: "Datetime", count: profile.columns.filter((c) => c.dtype === "datetime").length },
              ]
                .filter((t) => t.count > 0)
                .map((t) => (
                  <span key={t.label} className="rounded-full border border-border px-3 py-1.5 text-sm text-foreground/70">
                    {t.count} {t.label}
                  </span>
                ))}
            </div>
          </div>

          {/* Missing values */}
          {profile.nullSummary.length > 0 && (
            <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
              <p className="text-sm font-medium mb-3">Missing Values</p>
              <div className="space-y-2">
                {profile.nullSummary
                  .sort((a, b) => b.nullPercent - a.nullPercent)
                  .map((ns) => (
                    <div key={ns.column} className="flex items-center gap-3">
                      <span className="text-sm w-32 truncate">{ns.column}</span>
                      <div className="flex-1 h-1.5 bg-secondary rounded">
                        <div
                          className={cn(
                            "h-1.5 rounded",
                            ns.nullPercent > 30 ? "bg-red-400" : ns.nullPercent > 10 ? "bg-amber-400" : "bg-green-400"
                          )}
                          style={{ width: `${Math.min(ns.nullPercent, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-12 text-right">{ns.nullPercent}%</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Preview table */}
          {profile.preview.length > 0 && (
            <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm overflow-x-auto">
              <p className="text-sm font-medium mb-3">Data Preview</p>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-secondary/50">
                    <th className="border border-border px-3 py-2 text-left font-medium">#</th>
                    {(profile.preview.length > 0 ? Object.keys(profile.preview[0]) : []).map((col) => (
                      <th key={col} className={cn(
                        "border border-border px-3 py-2 text-left font-medium",
                        col === targetColumn && "bg-emerald-50 text-emerald-800"
                      )}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {profile.preview.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      <td className="border border-border px-3 py-2 text-center text-muted-foreground">{i + 1}</td>
                      {Object.entries(row).map(([col, val]) => (
                        <td key={col} className={cn(
                          "border border-border px-3 py-2",
                          col === targetColumn && "bg-emerald-50/50"
                        )}>
                          {val != null ? String(val) : <span className="text-muted-foreground/50">null</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* FEATURES TAB */}
      {activeTab === "features" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Choose which columns to use for predictions. More columns = more accurate, but slower.</p>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              Features
              <span className="font-normal text-muted-foreground ml-2">
                ({selectedCount} of {profile.columns.length} selected)
              </span>
            </p>
            <button
              onClick={handleAutoFeatureToggle}
              className={cn("flex items-center gap-2 text-sm", autoFeature ? "text-foreground font-medium" : "text-muted-foreground")}
            >
              Auto Feature Selection
              <div className={cn("h-5 w-9 rounded-full relative transition-all duration-300", autoFeature ? "bg-emerald-600" : "bg-zinc-300")}>
                <div className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all duration-300 shadow-sm", autoFeature ? "right-0.5" : "left-0.5")} />
              </div>
            </button>
          </div>

          <div className="space-y-2">
            {profile.columns.map((col) => (
              <ColumnRow
                key={col.name}
                col={col}
                isTarget={col.name === targetColumn}
                selected={!!selectedFeatures[col.name]}
                onToggle={() => toggleFeature(col.name)}
              />
            ))}
          </div>
        </div>
      )}

      {/* CORRELATION TAB */}
      {activeTab === "correlation" && (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">Shows how strongly each column relates to what you are predicting. Longer bars = stronger relationship.</p>
          {recomputing && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Recomputing for target: {targetColumn}...
            </div>
          )}
          {rawProfile?.correlation && Object.keys(rawProfile.correlation).length > 1 ? (
            <CorrelationHeatmap correlation={rawProfile.correlation} targetColumn={targetColumn} />
          ) : (
            <div className="rounded-xl border border-border/60 shadow-sm bg-card p-8 text-center">
              <p className="text-muted-foreground text-sm">Not enough numeric columns for correlation analysis.</p>
            </div>
          )}
        </div>
      )}

      {/* PCA TAB */}
      {activeTab === "pca" && (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">Advanced dimensionality analysis. This shows how your data can be simplified into fewer key factors.</p>
          {recomputing && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Recomputing PCA...
            </div>
          )}
          {rawProfile?.pca?.varianceExplained ? (
            <PCAAnalysis pca={rawProfile.pca} />
          ) : (
            <div className="rounded-xl border border-border/60 shadow-sm bg-card p-8 text-center">
              <p className="text-muted-foreground text-sm">Not enough numeric columns or rows for PCA analysis.</p>
            </div>
          )}
        </div>
      )}

      {/* Proceed button */}
      <div className="flex justify-center pt-2">
        <button
          onClick={async () => {
            try {
              const proj = await getProject(id);
              const features = Object.entries(selectedFeatures)
                .filter(([, v]) => v)
                .map(([k]) => k);
              // Use chatbot-suggested taskType if available, otherwise infer from data
              let taskType = proj?.taskType;
              if (!taskType) {
                const targetCol = profile?.columns.find((c) => c.name === targetColumn);
                taskType = targetCol?.dtype === "numeric" && (targetCol?.uniqueCount ?? 0) > 20
                  ? "regression"
                  : "classification";
              }
              await updateProject(id, { targetColumn, selectedFeatures: features, taskType });
            } catch {
              // Continue even if save fails
            }
            router.push(`/projects/${id}/train`);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-all duration-300 hover:bg-foreground/90"
        >
          <Play className="h-4 w-4" />
          Train Model &rarr;
        </button>
      </div>
    </div>
  );
}

/* Correlation Heatmap */

function CorrelationHeatmap({
  correlation,
  targetColumn,
}: {
  correlation: Record<string, Record<string, number>>;
  targetColumn: string;
}) {
  const cols = Object.keys(correlation);

  function getColor(value: number): string {
    const abs = Math.abs(value);
    if (value > 0) {
      if (abs > 0.7) return "bg-zinc-700 text-white";
      if (abs > 0.4) return "bg-secondary/500 text-white";
      if (abs > 0.2) return "bg-zinc-300 text-foreground";
      return "bg-secondary text-foreground/70";
    } else {
      if (abs > 0.7) return "bg-red-500 text-white";
      if (abs > 0.4) return "bg-red-300 text-white";
      if (abs > 0.2) return "bg-red-100 text-red-900";
      return "bg-red-50 text-red-600";
    }
  }

  const targetCorrs = correlation[targetColumn]
    ? Object.entries(correlation[targetColumn])
        .map(([col, val]) => ({ col, val }))
        .sort((a, b) => Math.abs(b.val) - Math.abs(a.val))
    : [];

  return (
    <div className="space-y-6">
      {targetCorrs.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
          <p className="text-sm font-medium mb-4">
            Correlation with Target: <span className="text-amber-700">{targetColumn}</span>
          </p>
          <div className="space-y-2">
            {targetCorrs.map(({ col, val }) => (
              <div key={col} className="flex items-center gap-3">
                <span className="text-sm w-36 truncate font-medium">{col}</span>
                <div className="flex-1 h-3 bg-secondary rounded relative overflow-hidden">
                  <div
                    className={cn(
                      "absolute top-0 h-full rounded transition-all",
                      val >= 0 ? "bg-secondary/500 left-1/2" : "bg-red-400 right-1/2"
                    )}
                    style={{
                      width: `${Math.abs(val) * 50}%`,
                      ...(val < 0 ? { right: "50%", left: "auto" } : {}),
                    }}
                  />
                  <div className="absolute top-0 left-1/2 h-full w-px bg-zinc-300" />
                </div>
                <span className={cn("text-xs font-mono w-14 text-right", val >= 0 ? "text-foreground/80" : "text-red-600")}>
                  {val.toFixed(3)}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-400 inline-block" /> Negative</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-secondary/500 inline-block" /> Positive</span>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm overflow-x-auto">
        <p className="text-sm font-medium mb-4">Correlation Matrix</p>
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="p-1" />
              {cols.map((c) => (
                <th key={c} className="p-1 font-medium text-muted-foreground max-w-[60px] truncate" style={{ writingMode: "vertical-rl" }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cols.map((row) => (
              <tr key={row}>
                <td className="p-1 font-medium text-muted-foreground text-right pr-2 whitespace-nowrap">{row}</td>
                {cols.map((col) => {
                  if (row === col) {
                    return (
                      <td key={col} className="p-0.5">
                        <div className="w-10 h-8 flex items-center justify-center bg-zinc-800 text-white text-[10px] rounded-sm">
                          1.00
                        </div>
                      </td>
                    );
                  }
                  const val = correlation[row]?.[col] ?? 0;
                  return (
                    <td key={col} className="p-0.5">
                      <div className={cn("w-10 h-8 flex items-center justify-center text-[10px] rounded-sm", getColor(val))}>
                        {val.toFixed(2)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* PCA Analysis */

function PCAAnalysis({ pca }: {
  pca: {
    varianceExplained: number[];
    cumulativeVariance: number[];
    components: number;
    featureNames: string[];
    loadings?: { pc: number; topFeatures: { feature: string; loading: number }[] }[];
  };
}) {
  const chartData = pca.varianceExplained.map((v, i) => ({
    pc: `PC${i + 1}`,
    variance: Math.round(v * 10000) / 100,
    cumulative: Math.round(pca.cumulativeVariance[i] * 10000) / 100,
  }));

  const pcs90 = pca.cumulativeVariance.findIndex((v) => v >= 0.9) + 1;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
        <p className="text-sm font-medium mb-3">PCA Summary</p>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-xl font-semibold text-foreground">{pca.components}</p>
            <p className="text-xs text-muted-foreground">Components</p>
          </div>
          <div>
            <p className="text-xl font-semibold text-foreground">{pca.featureNames.length}</p>
            <p className="text-xs text-muted-foreground">Features</p>
          </div>
          <div>
            <p className="text-xl font-semibold text-foreground">{pcs90 || "N/A"}</p>
            <p className="text-xs text-muted-foreground">PCs for 90%</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
        <p className="text-sm font-medium mb-4">Scree Plot</p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="pc" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
              <Tooltip contentStyle={{ fontSize: "12px", borderRadius: "6px" }} />
              <Line type="monotone" dataKey="variance" stroke="#3f3f46" strokeWidth={2} dot={{ r: 3 }} name="Individual %" />
              <Line type="monotone" dataKey="cumulative" stroke="#a1a1aa" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} name="Cumulative %" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-center gap-6 mt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-zinc-700 inline-block" /> Individual</span>
          <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-zinc-400 inline-block" /> Cumulative</span>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
        <p className="text-sm font-medium mb-4">Variance per Component</p>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <XAxis dataKey="pc" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="%" />
              <Tooltip contentStyle={{ fontSize: "12px", borderRadius: "6px" }} />
              <Bar dataKey="variance" fill={CHART_FILL} radius={[2, 2, 0, 0]} name="Variance %" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {pca.loadings && pca.loadings.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
          <p className="text-sm font-medium mb-4">Top Feature Loadings</p>
          <div className="grid md:grid-cols-2 gap-6">
            {pca.loadings.map((pc) => (
              <div key={pc.pc}>
                <p className="text-xs text-muted-foreground mb-2">
                  PC{pc.pc} ({(pca.varianceExplained[pc.pc - 1] * 100).toFixed(1)}% variance)
                </p>
                <div className="space-y-1.5">
                  {pc.topFeatures.map((f) => (
                    <div key={f.feature} className="flex items-center gap-2">
                      <span className="text-xs w-28 truncate">{f.feature}</span>
                      <div className="flex-1 h-2.5 bg-secondary rounded relative overflow-hidden">
                        <div
                          className={cn("absolute top-0 h-full rounded", f.loading >= 0 ? "bg-secondary/500" : "bg-red-400")}
                          style={{
                            width: `${Math.abs(f.loading) * 100}%`,
                            ...(f.loading < 0 ? { right: 0 } : { left: 0 }),
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-mono w-12 text-right text-muted-foreground">{f.loading.toFixed(3)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* Column Row */

function rebinDistribution(
  distribution: { bin: string; count: number }[],
  targetBins: number
): { bin: string; count: number }[] {
  if (!distribution || distribution.length <= targetBins) return distribution;
  const groupSize = Math.ceil(distribution.length / targetBins);
  const result: { bin: string; count: number }[] = [];
  for (let i = 0; i < distribution.length; i += groupSize) {
    const group = distribution.slice(i, i + groupSize);
    const firstBin = group[0].bin.split("-")[0] ?? group[0].bin;
    const lastBin = group[group.length - 1].bin.split("-").pop() ?? group[group.length - 1].bin;
    result.push({
      bin: `${firstBin}-${lastBin}`,
      count: group.reduce((sum, g) => sum + g.count, 0),
    });
  }
  return result;
}

function ColumnRow({
  col,
  isTarget,
  selected,
  onToggle,
}: {
  col: ColumnProfile;
  isTarget: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [binCount, setBinCount] = useState(5);
  const badge = TYPE_BADGE[col.dtype] ?? TYPE_BADGE.text;

  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 shadow-sm p-4 transition-all duration-300",
        isTarget && "border-emerald-300 bg-emerald-50/50",
        !selected && !isTarget && "opacity-50"
      )}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={onToggle}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border transition-colors",
            selected ? "border-emerald-600 bg-emerald-600 text-white" : "border-border"
          )}
        >
          {selected && <Check className="h-3.5 w-3.5" />}
        </button>

        <span className="text-sm font-medium min-w-[140px]">{col.name}</span>

        <span className={cn("rounded-full border px-2.5 py-0.5 text-xs", badge.className)}>
          {badge.label}
        </span>

        {isTarget && (
          <span className="rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
            Target
          </span>
        )}

        <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            Nulls:{" "}
            <span className={col.nullCount > 0 ? "text-amber-500 font-medium" : ""}>
              {col.nullCount} ({col.nullPercent}%)
            </span>
          </span>
          <span>Unique: {col.uniqueCount.toLocaleString()}</span>
          <button onClick={() => setExpanded((prev) => !prev)} className="text-muted-foreground hover:text-foreground/80 transition-colors">
            <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 ml-8 space-y-3">
          {col.dtype === "numeric" && col.mean !== undefined && (
            <div className="flex gap-6 text-sm">
              {[
                { label: "Mean", value: col.mean.toFixed(2) },
                { label: "Std", value: col.std?.toFixed(2) },
                { label: "Min", value: col.min },
                { label: "Max", value: col.max },
              ].map((s) => (
                <div key={s.label}>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="font-medium">{s.value}</p>
                </div>
              ))}
            </div>
          )}

          {col.dtype === "categorical" && col.topValues && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Top Values</p>
              <div className="flex flex-wrap gap-2">
                {col.topValues.map((tv) => (
                  <span key={tv.value} className="rounded-md border px-2 py-1 text-xs">
                    {tv.value} <span className="text-muted-foreground">({tv.count.toLocaleString()})</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {col.distribution && col.distribution.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground">Distribution</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">Bins:</span>
                  {[3, 5, 10, 20].map((n) => (
                    <button
                      key={n}
                      onClick={() => setBinCount(n)}
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                        binCount === n
                          ? "bg-zinc-700 text-white"
                          : "text-muted-foreground hover:text-foreground/70"
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-28 w-full max-w-sm">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rebinDistribution(col.distribution, binCount)}>
                    <XAxis dataKey="bin" tick={{ fontSize: 9 }} angle={-20} textAnchor="end" height={35} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ border: "1px solid #e4e4e7", borderRadius: "6px", fontSize: "11px" }} />
                    <Bar dataKey="count" fill={CHART_FILL} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
