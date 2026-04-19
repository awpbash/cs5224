"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, TrendingDown, ShoppingCart, Users, BarChart3, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { createProject } from "@/lib/api";

const USE_CASES = [
  {
    id: "churn_prediction",
    label: "Churn Prediction",
    description: "Predict which customers are likely to leave",
    icon: TrendingDown,
    taskType: "classification" as const,
  },
  {
    id: "sales_forecasting",
    label: "Sales Forecasting",
    description: "Forecast future revenue or sales volume",
    icon: BarChart3,
    taskType: "regression" as const,
  },
  {
    id: "customer_segmentation",
    label: "Customer Segmentation",
    description: "Group customers by behavior or demographics",
    icon: Users,
    taskType: "classification" as const,
  },
  {
    id: "demand_forecasting",
    label: "Demand Forecasting",
    description: "Predict product demand across stores or time",
    icon: ShoppingCart,
    taskType: "regression" as const,
  },
  {
    id: "custom",
    label: "Custom Problem",
    description: "Define your own prediction task",
    icon: Pencil,
    taskType: "classification" as const,
  },
];

export default function NewProjectPage() {
  const router = useRouter();
  const [projectName, setProjectName] = useState("");
  const [selectedUseCase, setSelectedUseCase] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selected = USE_CASES.find((u) => u.id === selectedUseCase);

  const handleCreate = async () => {
    if (!projectName.trim()) {
      setError("Give your project a name");
      return;
    }
    if (!selectedUseCase) {
      setError("Pick a use case");
      return;
    }

    setError("");
    setLoading(true);
    try {
      const result = await createProject({
        projectName: projectName.trim(),
        useCase: selectedUseCase,
        taskType: selected?.taskType ?? "classification",
      });
      router.push(`/projects/${result.projectId}/upload`);
    } catch (err) {
      console.error("Failed to create project", err);
      setError(err instanceof Error ? err.message : "Failed to create project");
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-6 py-14">
      <h1 className="text-3xl font-display tracking-tight mb-10">New Project</h1>

      <div className="space-y-8">
        {/* Project name */}
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">
            Project name
          </label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => { setProjectName(e.target.value); setError(""); }}
            placeholder="e.g. Q1 Churn Analysis"
            className="w-full rounded-lg border border-border px-4 h-12 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-200 transition-all duration-300"
            autoFocus
          />
        </div>

        {/* Use case selection */}
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">
            What are you trying to solve?
          </label>
          <div className="grid grid-cols-1 gap-2.5">
            {USE_CASES.map((uc) => {
              const Icon = uc.icon;
              const isSelected = selectedUseCase === uc.id;
              return (
                <button
                  key={uc.id}
                  onClick={() => { setSelectedUseCase(uc.id); setError(""); }}
                  className={cn(
                    "flex items-center gap-3 rounded-xl p-4 text-left transition-all duration-300 border",
                    isSelected
                      ? "border-emerald-500 bg-emerald-50/50 shadow-sm"
                      : "border-border/60 shadow-sm hover:border-border hover:shadow-md"
                  )}
                >
                  <div className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                    isSelected ? "bg-emerald-600 text-white" : "bg-secondary text-muted-foreground"
                  )}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className={cn("text-sm font-medium", isSelected ? "text-foreground" : "text-foreground/80")}>
                      {uc.label}
                    </p>
                    <p className="text-xs text-muted-foreground">{uc.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}

        {/* Create button */}
        <button
          onClick={handleCreate}
          disabled={loading}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-foreground h-12 text-sm font-medium text-background transition-all duration-300 hover:bg-foreground/90 disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              Create Project
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
