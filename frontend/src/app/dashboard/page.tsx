"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Sparkles, AlertTriangle, Trash2 } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { listProjects, deleteProject } from "@/lib/api";
import type { Project, ProjectStatus, UseCase } from "@/lib/types";
import OnboardingTour from "@/components/layout/OnboardingTour";

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-secondary", className)} />;
}

const STATUS_STYLES: Record<ProjectStatus, string> = {
  CREATED: "bg-secondary text-foreground/70 border-border",
  DATA_UPLOADED: "bg-blue-50 text-blue-600 border-blue-200",
  PROFILED: "bg-blue-50 text-blue-600 border-blue-200",
  TRAINING: "bg-amber-50 text-amber-600 border-amber-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  FAILED: "bg-red-50 text-red-600 border-red-200",
};

const STATUS_LABELS: Record<ProjectStatus, string> = {
  CREATED: "New",
  DATA_UPLOADED: "Data Ready",
  PROFILED: "Analyzed",
  TRAINING: "Training...",
  COMPLETED: "Done",
  FAILED: "Failed",
};

const USE_CASE_LABELS: Record<UseCase, string> = {
  churn_prediction: "Churn Prediction",
  sales_forecasting: "Sales Forecasting",
  customer_segmentation: "Customer Segmentation",
  demand_forecasting: "Demand Forecasting",
  custom: "Custom",
};

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = () => {
    setLoading(true);
    setError(null);
    listProjects()
      .then((data) => {
        const mapped = data.map((p) => ({
          ...p,
          status: (p.status ?? "CREATED").toUpperCase() as ProjectStatus,
          useCase: (p.useCase || "custom") as UseCase,
        }));
        setProjects(mapped);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Failed to load projects";
        setError(msg);
      })
      .finally(() => setLoading(false));
  };

  const handleDelete = async (e: React.MouseEvent, projectId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this project? This cannot be undone.")) return;
    try {
      await deleteProject(projectId);
      setProjects((prev) => prev.filter((p) => p.projectId !== projectId));
      toast("success", "Project deleted");
    } catch {
      toast("error", "Failed to delete project. Please try again.");
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="mb-10">
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border/60 bg-card p-5 shadow-sm"
            >
              <Skeleton className="h-4 w-3/4 mb-4" />
              <div className="flex gap-2 mb-4">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10 flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <AlertTriangle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-red-500">{error}</p>
        <button
          onClick={fetchProjects}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-all duration-300 hover:bg-secondary"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <OnboardingTour />
      <div className="mb-10">
        <h1 className="text-3xl font-display tracking-tight">Your Projects</h1>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border/60 bg-card shadow-sm py-20 px-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-100 to-indigo-100 mb-5">
            <Sparkles className="h-7 w-7 text-purple-600" />
          </div>
          <h2 className="text-lg font-medium mb-2">No projects yet</h2>
          <p className="text-muted-foreground text-sm mb-6 max-w-sm">
            Create your first project to start building AI models from your data — no data science expertise required.
          </p>
          <Link
            href="/projects/new"
            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:bg-foreground/90 transition-all duration-300"
          >
            <Plus className="h-4 w-4" />
            Create your first project
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {projects.map((project) => (
            <Link
              key={project.projectId}
              href={`/projects/${project.projectId}/${
                project.status === "COMPLETED" ? "results" :
                project.status === "TRAINING" ? "train" :
                project.status === "PROFILED" ? "profile" :
                project.status === "DATA_UPLOADED" ? "chat" :
                "upload"
              }`}
              className="block group"
            >
              <div className={cn(
                "rounded-xl border border-border/60 bg-card p-5 shadow-sm transition-all duration-300 hover:shadow-md hover:border-border",
                project.status === "TRAINING" && "ring-2 ring-amber-300 ring-offset-1"
              )}>
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-sm font-medium">{project.projectName}</h3>
                  <button
                    onClick={(e) => handleDelete(e, project.projectId)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-all"
                    title="Delete project"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 mb-3">
                  <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
                    {USE_CASE_LABELS[project.useCase]}
                  </span>
                  <span className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs",
                    STATUS_STYLES[project.status]
                  )}>
                    {project.status === "TRAINING" && (
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse mr-1.5 align-middle" />
                    )}
                    {STATUS_LABELS[project.status]}
                  </span>
                </div>

                <p className="text-xs text-muted-foreground">
                  {formatRelativeTime(project.createdAt)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
