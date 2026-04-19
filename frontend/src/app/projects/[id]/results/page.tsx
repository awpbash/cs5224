"use client";

import { useProjectId } from "@/hooks/useProjectId";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Play,
  AlertTriangle,
  DollarSign,
  Target,
  Smile,
  Clock,
  TrendingDown,
  Loader2,
  MessageCircle,
  Send,
  X,
  Lightbulb,
  TrendingUp,
  BarChart3,
  BrainCircuit,
  Download,
  Trophy,
  Zap,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getProject, getJobStatus, getModelDownloadUrl, interpretResults, resultsChatMessage } from "@/lib/api";
import type { Job, Project } from "@/lib/types";

interface KpiItem {
  label: string;
  value: string;
  detail: string;
}

interface FeatureItem {
  name: string;
  importance: number;
  explanation: string;
}

interface Recommendation {
  title: string;
  description: string;
  impact: string;
}

interface Insight {
  feature: string;
  explanation: string;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export default function ResultsPage() {
  const id = useProjectId();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [businessSummary, setBusinessSummary] = useState("");
  const [kpis, setKpis] = useState<KpiItem[]>([]);
  const [topFeatures, setTopFeatures] = useState<FeatureItem[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsFailed, setInsightsFailed] = useState(false);

  const [downloadLoading, setDownloadLoading] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);

  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchResults() {
      setLoading(true);
      setError(null);

      try {
        let jobId = localStorage.getItem(`trainJobId_${id}`);

        if (!jobId) {
          const proj = await getProject(id);
          setProject(proj);
          jobId = proj.latestJobId ?? null;
        }

        if (!jobId) {
          setError("NO_JOB");
          setLoading(false);
          return;
        }

        const [jobData, proj] = await Promise.all([
          getJobStatus(id, jobId),
          project ? Promise.resolve(project) : getProject(id),
        ]);
        setJob(jobData);
        setProject(proj);

        if (jobData.metrics) {
          const m = jobData.metrics;
          const cards: KpiItem[] = [];

          if (m.accuracy != null) {
            cards.push({
              label: "Accuracy",
              value: `${((m.accuracy as number) * 100).toFixed(1)}%`,
              detail: "How often the model predicts correctly",
            });
            if (m.f1 != null) cards.push({
              label: "Balanced Score",
              value: `${((m.f1 as number) * 100).toFixed(1)}%`,
              detail: "Balances catching all cases vs avoiding false alarms",
            });
            if (m.precision != null) cards.push({
              label: "Precision",
              value: `${((m.precision as number) * 100).toFixed(1)}%`,
              detail: "When we predict yes, how often are we right?",
            });
            if (m.recall != null) cards.push({
              label: "Detection Rate",
              value: `${((m.recall as number) * 100).toFixed(1)}%`,
              detail: "Of all actual cases, how many did we catch?",
            });
          } else if (m.r2 != null) {
            cards.push({
              label: "Model Fit",
              value: `${((m.r2 as number) * 100).toFixed(1)}%`,
              detail: "How well the model explains your data (higher = better)",
            });
            if (m.mae != null) cards.push({
              label: "Avg Error",
              value: `${(m.mae as number).toFixed(2)}`,
              detail: "On average, predictions are off by this much",
            });
            if (m.rmse != null) cards.push({
              label: "Typical Error",
              value: `${(m.rmse as number).toFixed(2)}`,
              detail: "Typical prediction error (penalizes big mistakes)",
            });
          }

          setKpis(cards);
        }

        if (jobData.featureImportance && jobData.featureImportance.length > 0) {
          const sorted = jobData.featureImportance
            .slice()
            .sort((a, b) => b.importance - a.importance);
          setTopFeatures(
            sorted.map((f) => ({
              name: f.feature,
              importance: f.importance,
              explanation: `Importance score: ${(f.importance * 100).toFixed(1)}%`,
            }))
          );
        }

        setInsightsLoading(true);
        try {
          const interpretation = await interpretResults(id, jobId);
          setBusinessSummary(interpretation.businessSummary || "");
          setRecommendations(interpretation.recommendations || []);
          setInsights(interpretation.insights || []);
          setInsightsFailed(false);
        } catch {
          setBusinessSummary("");
          setRecommendations([]);
          setInsightsFailed(true);
        } finally {
          setInsightsLoading(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load results");
      } finally {
        setLoading(false);
      }
    }

    fetchResults();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  async function sendQuickQuestion(question: string) {
    if (chatLoading) return;
    setChatMessages((prev) => [...prev, { role: "user", content: question }]);
    setChatLoading(true);
    try {
      const history = chatMessages.map((m) => ({ role: m.role, content: m.content }));
      const res = await resultsChatMessage(id, question, history);
      setChatMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
    } catch {
      setChatMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I couldn't process that. Please try again." }]);
    } finally {
      setChatLoading(false);
    }
  }

  async function handleChatSend() {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: msg }]);
    setChatLoading(true);
    try {
      const history = chatMessages.map((m) => ({ role: m.role, content: m.content }));
      const res = await resultsChatMessage(id, msg, history);
      setChatMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
    } catch {
      setChatMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I couldn't process that. Please try again." }]);
    } finally {
      setChatLoading(false);
    }
  }

  async function handleDownloadModel() {
    if (!job || downloadLoading) return;
    setDownloadLoading(true);
    try {
      const { downloadUrl } = await getModelDownloadUrl(id, job.jobId);
      window.open(downloadUrl, "_blank");
    } catch {
      // silently fail - user can retry
    } finally {
      setDownloadLoading(false);
    }
  }

  const isClassification = job?.metrics?.accuracy != null;
  const leaderboard = (job?.metrics?.leaderboard ?? null) as
    | { model: string; accuracy?: number; r2?: number; f1?: number; mae?: number; duration?: number }[]
    | null;

  // Build retrain query params
  const retrainParams = new URLSearchParams();
  if (job?.modelType) retrainParams.set("modelType", job.modelType);
  if (project?.targetColumn) retrainParams.set("targetColumn", project.targetColumn);
  const retrainHref = `/projects/${id}/train${retrainParams.toString() ? `?${retrainParams.toString()}` : ""}`;

  const kpiIcons = [Target, TrendingUp, AlertTriangle, DollarSign];
  const featureIcons = [Smile, Clock, TrendingDown, BarChart3, Lightbulb];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
        <p className="text-sm text-muted-foreground">Loading training results...</p>
      </div>
    );
  }

  if (error === "NO_JOB") {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6">
        <p className="text-base font-medium text-foreground/80">No training results yet</p>
        <p className="text-sm text-muted-foreground">Train a model first to see results here.</p>
        <Link
          href={`/projects/${id}/train`}
          className="inline-flex items-center gap-2 rounded-lg bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-all duration-300 hover:bg-foreground/90"
        >
          <Play className="h-4 w-4" />
          Go to Training
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="text-sm text-red-500 font-medium">{error}</p>
        <Link href={`/projects/${id}/train`} className="text-sm text-foreground/70 hover:text-foreground underline">
          Back to Training
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 space-y-8 pb-12 pt-10">
      <h1 className="text-3xl font-display tracking-tight">Training Results</h1>

      {/* Achievement Badges */}
      {job && (
        <div className="flex flex-wrap items-center gap-3">
          {job.modelType && (
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-4 py-2 shadow-sm">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-100">
                <Trophy className="h-3.5 w-3.5 text-violet-600" />
              </div>
              <span className="text-sm font-semibold text-foreground">{job.modelType}</span>
            </div>
          )}
          {job.trainingDurationSec != null && (
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-4 py-2 shadow-sm">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100">
                <Zap className="h-3.5 w-3.5 text-amber-600" />
              </div>
              <span className="text-sm font-semibold text-foreground">Trained in {job.trainingDurationSec.toFixed(1)}s</span>
            </div>
          )}
          {isClassification && (
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-4 py-2 shadow-sm">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100">
                <Target className="h-3.5 w-3.5 text-blue-600" />
              </div>
              <span className="text-sm font-semibold text-foreground">Classification</span>
            </div>
          )}
          {!isClassification && job.metrics?.r2 != null && (
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-4 py-2 shadow-sm">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100">
                <TrendingUp className="h-3.5 w-3.5 text-blue-600" />
              </div>
              <span className="text-sm font-semibold text-foreground">Regression</span>
            </div>
          )}
        </div>
      )}

      {/* Business Summary */}
      <div className="rounded-xl border border-border/60 border-l-4 border-l-emerald-500 bg-card px-6 py-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
            <BrainCircuit className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="flex-1">
            {insightsLoading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                <p className="text-sm text-muted-foreground">Generating AI business insights...</p>
              </div>
            ) : businessSummary ? (
              <p className="text-base font-medium leading-relaxed text-foreground">
                {businessSummary}
              </p>
            ) : insightsFailed ? (
              <div>
                <p className="text-sm text-foreground/70">Your model trained successfully. AI insights are unavailable right now.</p>
                <button
                  onClick={async () => {
                    if (!job) return;
                    const jobId = job.jobId;
                    setInsightsLoading(true);
                    try {
                      const interpretation = await interpretResults(id, jobId);
                      setBusinessSummary(interpretation.businessSummary || "");
                      setRecommendations(interpretation.recommendations || []);
                      setInsights(interpretation.insights || []);
                      setInsightsFailed(false);
                    } catch {
                      setInsightsFailed(true);
                    } finally {
                      setInsightsLoading(false);
                    }
                  }}
                  className="mt-2 text-sm text-emerald-600 hover:text-emerald-800 underline"
                >
                  Retry generating insights
                </button>
              </div>
            ) : (
              <p className="text-base font-medium leading-relaxed text-foreground">
                Training completed successfully.
              </p>
            )}
            {job && (
              <p className="mt-2 text-sm text-muted-foreground">
                Model: <span className="font-medium text-foreground/80">{job.modelType}</span>
                {job.trainingDurationSec != null && (
                  <> &middot; Duration: <span className="font-medium text-foreground/80">{job.trainingDurationSec}s</span></>
                )}
                {job.completedAt && (
                  <> &middot; Completed: {new Date(job.completedAt).toLocaleDateString()}</>
                )}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* What Drives Your Results - always shown from model data, no AI needed */}
      {topFeatures.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-emerald-50/30 p-6 shadow-sm">
          <p className="text-sm font-medium mb-1">Key Drivers</p>
          <p className="text-xs text-muted-foreground mb-4">The top factors that influence your predictions, ranked by importance</p>
          <div className="space-y-3">
            {topFeatures.slice(0, 5).map((feat, i) => {
              const pct = Math.round(feat.importance * 100);
              return (
                <div key={feat.name} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-foreground">{feat.name}</span>
                      <span className="text-xs font-medium text-emerald-700">{pct}%</span>
                    </div>
                    <div className="h-2 bg-emerald-100 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(pct * 2, 100)}%` }} />
                    </div>
                    {insights.find((ins) => ins.feature === feat.name) && (
                      <p className="text-xs text-muted-foreground mt-1">{insights.find((ins) => ins.feature === feat.name)?.explanation}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* KPI Cards */}
      {kpis.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-3">Model Performance</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {kpis.map((kpi, i) => {
              const Icon = kpiIcons[i % kpiIcons.length];
              const kpiColors = (() => {
                const label = kpi.label.toLowerCase();
                if (label.includes("accuracy") || label.includes("f1")) return { bg: "bg-green-100", text: "text-green-600", gradient: "from-green-50/50" };
                if (label.includes("precision")) return { bg: "bg-blue-100", text: "text-blue-600", gradient: "from-blue-50/50" };
                if (label.includes("recall")) return { bg: "bg-amber-100", text: "text-amber-600", gradient: "from-amber-50/50" };
                if (label.includes("r\u00B2") || label.includes("r2")) return { bg: "bg-emerald-100", text: "text-emerald-600", gradient: "from-emerald-50/30" };
                return { bg: "bg-secondary", text: "text-foreground/70", gradient: "from-secondary/30" };
              })();
              return (
                <div
                  key={i}
                  className={cn("rounded-xl border border-border/60 bg-gradient-to-br to-card p-5 shadow-sm", kpiColors.gradient)}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", kpiColors.bg)}>
                      <Icon className={cn("h-4 w-4", kpiColors.text)} />
                    </div>
                    <p className="text-xs font-medium text-muted-foreground">{kpi.label}</p>
                  </div>
                  <p className="text-3xl font-bold text-foreground">{kpi.value}</p>
                  <p className="text-xs text-muted-foreground mt-1.5">{kpi.detail}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Confusion Matrix */}
      {isClassification && job?.confusionMatrix && job.confusionMatrix.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-3">Confusion Matrix</p>
          <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm overflow-x-auto">
            <p className="text-xs text-muted-foreground mb-4">Rows = Actual, Columns = Predicted. Darker cells indicate higher counts.</p>
            {(() => {
              const matrix = job.confusionMatrix!;
              const labels = job.classLabels ?? matrix.map((_, i) => `Class ${i}`);
              const maxVal = Math.max(...matrix.flat(), 1);
              return (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="p-2 text-xs text-muted-foreground font-medium"></th>
                      {labels.map((label) => (
                        <th key={label} className="p-2 text-xs text-muted-foreground font-medium text-center">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.map((row, ri) => (
                      <tr key={ri}>
                        <td className="p-2 text-xs text-muted-foreground font-medium whitespace-nowrap">
                          {labels[ri]}
                        </td>
                        {row.map((count, ci) => {
                          const intensity = count / maxVal;
                          const isDiagonal = ri === ci;
                          const bgColor = isDiagonal
                            ? `rgba(5, 150, 105, ${0.1 + intensity * 0.6})`
                            : `rgba(239, 68, 68, ${intensity * 0.4})`;
                          const textColor = intensity > 0.5 ? "text-white" : "text-foreground";
                          return (
                            <td
                              key={ci}
                              className={cn("p-2 text-center font-semibold rounded-md", textColor)}
                              style={{ backgroundColor: bgColor }}
                            >
                              {count}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </div>
        </div>
      )}

      {/* Leaderboard / Model Comparison */}
      {leaderboard && leaderboard.length > 1 && (
        <div>
          <button
            onClick={() => setLeaderboardOpen(!leaderboardOpen)}
            className="flex items-center gap-2 text-sm font-medium mb-3 hover:text-foreground/80 transition-colors"
          >
            <Trophy className="h-4 w-4 text-amber-500" />
            Model Leaderboard ({leaderboard.length} models)
            {leaderboardOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {leaderboardOpen && (
            <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-secondary/30">
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">#</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Model</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                      {isClassification ? "Accuracy" : "R\u00B2"}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                      {isClassification ? "F1" : "MAE"}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry, i) => (
                    <tr
                      key={i}
                      className={cn(
                        "border-b border-border/30 transition-colors",
                        i === 0 ? "bg-emerald-50/40" : "hover:bg-secondary/30"
                      )}
                    >
                      <td className="px-4 py-3 text-xs font-bold text-muted-foreground">
                        {i === 0 ? (
                          <span className="text-amber-500">1st</span>
                        ) : (
                          `${i + 1}`
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">{entry.model}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {isClassification
                          ? entry.accuracy != null ? `${(entry.accuracy * 100).toFixed(1)}%` : "-"
                          : entry.r2 != null ? `${(entry.r2 * 100).toFixed(1)}%` : "-"
                        }
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {isClassification
                          ? entry.f1 != null ? `${(entry.f1 * 100).toFixed(1)}%` : "-"
                          : entry.mae != null ? `${entry.mae.toFixed(3)}` : "-"
                        }
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                        {entry.duration != null ? `${entry.duration.toFixed(1)}s` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Feature Importance */}
      {topFeatures.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-3">Feature Importance</p>
          <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
            <div style={{ height: Math.max(200, topFeatures.length * 36) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topFeatures.map((f) => ({
                    name: f.name,
                    importance: Math.round(f.importance * 10000) / 100,
                  }))}
                  layout="vertical"
                  margin={{ left: 100 }}
                >
                  <XAxis type="number" tick={{ fontSize: 11 }} unit="%" domain={[0, "auto"]} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                  <Tooltip contentStyle={{ fontSize: "12px", borderRadius: "6px" }} />
                  <Bar dataKey="importance" fill="#059669" radius={[0, 4, 4, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 mt-5">
              {topFeatures.slice(0, 3).map((feat, i) => {
                const Icon = featureIcons[i % featureIcons.length];
                return (
                  <div
                    key={feat.name}
                    className="rounded-xl border border-border/60 bg-card p-4 shadow-sm"
                  >
                    <div className="flex items-center gap-2.5 mb-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-100">
                        <Icon className="h-3.5 w-3.5 text-emerald-600" />
                      </div>
                      <p className="text-sm font-semibold text-foreground">{feat.name}</p>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {insights.find((ins) => ins.feature === feat.name)?.explanation || feat.explanation}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* AI Insights */}
      {insights.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-3">Business Insights</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {insights
              .filter((ins) => !topFeatures.some((f) => f.name === ins.feature))
              .map((ins, i) => (
                <div key={i} className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
                  <p className="text-sm font-medium text-foreground mb-1">{ins.feature}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{ins.explanation}</p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div>
          <p className="text-sm text-muted-foreground mb-2">Based on your model&apos;s findings, here&apos;s what you can do:</p>
          <p className="text-sm font-medium mb-3">Recommendations</p>
          <div className="space-y-3">
            {recommendations.map((rec, i) => (
              <div key={i} className="rounded-xl border border-border/60 bg-card p-5 shadow-sm flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-bold text-background">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground">{rec.title}</p>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{rec.description}</p>
                  {rec.impact && (
                    <span className={cn(
                      "inline-block mt-2 rounded-full px-2.5 py-0.5 text-xs font-medium",
                      rec.impact === "high" ? "bg-red-50 text-red-600 border border-red-200" :
                      rec.impact === "medium" ? "bg-amber-50 text-amber-600 border border-amber-200" :
                      "bg-green-50 text-green-600 border border-green-200"
                    )}>
                      {rec.impact} impact
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data Preview removed per PM feedback */}

      {/* Next Steps */}
      <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
        <p className="text-sm font-medium mb-3">Next Steps</p>
        <div className="flex items-center gap-4 flex-wrap">
          <Link href={`/projects/${id}/infer`} className="text-sm font-medium text-emerald-700 hover:text-emerald-900 transition-colors">
            Run Predictions &rarr;
          </Link>
          <Link href={retrainHref} className="text-sm font-medium text-foreground/70 hover:text-foreground transition-colors">
            Train Another Model
          </Link>
          <button
            onClick={handleDownloadModel}
            disabled={downloadLoading}
            className="text-sm font-medium text-foreground/70 hover:text-foreground transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {downloadLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Download Model
          </button>
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="flex items-center justify-center gap-4 pt-2 flex-wrap">
        <Link href={`/projects/${id}/infer`}>
          <button className="inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:bg-foreground/90 transition-all duration-300">
            <Play className="h-4 w-4" />
            Run Predictions
          </button>
        </Link>
        <Link href={retrainHref}>
          <button className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-foreground/80 hover:bg-secondary transition-all duration-300">
            <Play className="h-4 w-4" />
            Retrain
          </button>
        </Link>
        <button
          onClick={handleDownloadModel}
          disabled={downloadLoading}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-foreground/80 hover:bg-secondary transition-all duration-300 disabled:opacity-50"
        >
          {downloadLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download Model
        </button>
        <button
          onClick={() => setChatOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 transition-all duration-300"
        >
          <MessageCircle className="h-4 w-4" />
          Ask Questions About Results
        </button>
      </div>

      {/* Floating Chat FAB */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-6 right-6 h-12 w-12 rounded-full bg-foreground text-background shadow-lg flex items-center justify-center hover:bg-foreground/90 transition-all duration-300 z-50"
        >
          <MessageCircle className="h-5 w-5" />
        </button>
      )}

      {/* Chat Side Panel */}
      {chatOpen && (
        <>
          <div className="fixed inset-0 bg-black/10 z-40" onClick={() => setChatOpen(false)} />
          <div className="fixed top-0 right-0 w-full sm:w-[420px] h-full bg-card shadow-2xl border-l border-border/60 flex flex-col z-50 rounded-l-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/60 bg-card">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100">
                  <MessageCircle className="h-4 w-4 text-emerald-600" />
                </div>
                <span className="text-sm font-semibold">Business Analyst</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-muted-foreground hover:text-foreground/80 transition-colors p-1 rounded-md hover:bg-secondary">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {chatMessages.length === 0 && (
                <div className="text-center py-8">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 mx-auto mb-4">
                    <MessageCircle className="h-6 w-6 text-emerald-500" />
                  </div>
                  <p className="text-sm font-medium text-foreground/80 mb-1">Ask about your results</p>
                  <p className="text-xs text-muted-foreground mb-4">Get AI-powered insights about your model</p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {[
                      "What do these metrics mean?",
                      "How can I improve the model?",
                      "Key business takeaways?",
                      "Which features matter most?",
                    ].map((q) => (
                      <button
                        key={q}
                        onClick={() => sendQuickQuestion(q)}
                        className="text-xs rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300 transition-all duration-200"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chatMessages.map((msg, i) => (
                <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
                    msg.role === "user"
                      ? "bg-foreground/5 border border-border/60 text-foreground"
                      : "bg-secondary text-foreground/90"
                  )}>
                    <FormattedMessage text={msg.content} />
                  </div>
                </div>
              ))}

              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-secondary rounded-2xl px-4 py-2.5">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-pulse" />
                      <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
                      <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-pulse" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            <div className="border-t p-4">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleChatSend()}
                  placeholder="Ask about your results..."
                  className="flex-1 rounded-lg border border-border px-3.5 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-200 transition-all duration-300"
                />
                <button
                  onClick={handleChatSend}
                  disabled={chatLoading || !chatInput.trim()}
                  className="h-9 w-9 rounded-full bg-foreground text-background flex items-center justify-center hover:bg-foreground/90 disabled:opacity-50 transition-all duration-300"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FormattedMessage({ text }: { text: string }) {
  let cleaned = text.replace(/```\s*json?\s*[\s\S]*?```/gi, "").trim();
  cleaned = cleaned.replace(/\{[^{}]*"(useCase|suggestedTarget|taskType|businessSummary)"[^{}]*\}/g, "").trim();
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  const lines = cleaned.split("\n");
  const elements: React.ReactNode[] = [];
  let idx = 0;

  while (idx < lines.length) {
    const trimmed = lines[idx].trim();

    if (!trimmed) {
      if (elements.length > 0) elements.push(<div key={`sp-${idx}`} className="h-1" />);
      idx++;
      continue;
    }

    // Numbered list
    if (/^\d+[\.\)]\s/.test(trimmed)) {
      const items: string[] = [];
      while (idx < lines.length && /^\d+[\.\)]\s/.test(lines[idx].trim())) {
        items.push(lines[idx].trim().replace(/^\d+[\.\)]\s*/, ""));
        idx++;
      }
      elements.push(
        <ol key={`ol-${idx}`} className="list-decimal list-inside space-y-0.5 pl-1">
          {items.map((item, j) => (
            <li key={j} className="text-sm"><InlineFormat text={item} /></li>
          ))}
        </ol>
      );
      continue;
    }

    // Bullet list
    if (/^[-•*]\s/.test(trimmed)) {
      const items: string[] = [];
      while (idx < lines.length && /^[-•*]\s/.test(lines[idx].trim())) {
        items.push(lines[idx].trim().replace(/^[-•*]\s*/, ""));
        idx++;
      }
      elements.push(
        <ul key={`ul-${idx}`} className="space-y-0.5 pl-1">
          {items.map((item, j) => (
            <li key={j} className="flex items-start gap-2 text-sm">
              <span className="text-muted-foreground mt-0.5 shrink-0">•</span>
              <span><InlineFormat text={item} /></span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Bold-only line = subheading
    if (/^\*\*[^*]+\*\*:?\s*$/.test(trimmed)) {
      elements.push(
        <p key={`h-${idx}`} className="font-semibold text-sm text-foreground mt-0.5">
          {trimmed.replace(/\*\*/g, "").replace(/:$/, "")}
        </p>
      );
      idx++;
      continue;
    }

    // Regular text
    elements.push(
      <p key={`p-${idx}`} className="text-sm"><InlineFormat text={trimmed} /></p>
    );
    idx++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

function InlineFormat({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={i} className="rounded bg-secondary px-1 py-0.5 text-xs font-mono">{part.slice(1, -1)}</code>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
