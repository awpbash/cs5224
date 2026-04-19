"use client";

import Link from "next/link";
import {
  Clock,
  DollarSign,
  Users,
  Zap,
  GraduationCap,
  ArrowRight,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const APPROACHES = [
  {
    name: "Hire a Data Scientist",
    icon: Users,
    time: "2-4 weeks",
    cost: "$8,000 - $15,000/month",
    expertise: "Expert required",
    steps: [
      "Post job listing & interview candidates",
      "Onboard and explain business context",
      "Clean and prepare data manually",
      "Select and train models (Python/R)",
      "Evaluate and iterate on results",
      "Build dashboards and reports",
      "Present recommendations to stakeholders",
    ],
    pros: ["Full customization", "Deep analysis possible"],
    cons: [
      "Expensive — $100K+/year salary",
      "Weeks to first insight",
      "Dependent on one person",
      "Need to explain retail domain",
    ],
    highlight: false,
  },
  {
    name: "RetailMind",
    icon: Zap,
    time: "< 10 minutes",
    cost: "Free tier available",
    expertise: "No technical skills needed",
    steps: [
      "Upload your CSV or pick a sample dataset",
      "Describe your business problem in plain English",
      "Review AI-suggested analysis setup",
      "Click Train — AutoML handles the rest",
      "Get business recommendations instantly",
    ],
    pros: [
      "Zero ML knowledge required",
      "Results in minutes, not weeks",
      "19 models tested automatically",
      "Plain-English business recommendations",
      "Pay only for what you use",
    ],
    cons: ["Tabular data only", "Less customization than custom code"],
    highlight: true,
  },
  {
    name: "Amazon SageMaker",
    icon: GraduationCap,
    time: "1-3 days",
    cost: "$0.063/hr+ (per instance)",
    expertise: "AWS + ML knowledge required",
    steps: [
      "Set up AWS account and IAM roles",
      "Create SageMaker notebook instance",
      "Upload and prepare data in S3",
      "Choose algorithm and configure training",
      "Monitor training job in console",
      "Deploy model endpoint",
      "Build custom inference pipeline",
      "Interpret results manually",
    ],
    pros: [
      "Full AWS ecosystem integration",
      "Highly scalable",
      "Many algorithm options",
    ],
    cons: [
      "Steep learning curve",
      "Complex setup and configuration",
      "No business-language insights",
      "Easy to overspend if misconfigured",
    ],
    highlight: false,
  },
];

export default function ComparePage() {
  return (
    <div className="mx-auto max-w-6xl px-6 pb-16 pt-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-display tracking-tight mb-3">
          Why RetailMind?
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          See how RetailMind compares to traditional approaches for getting
          AI-powered business insights from your retail data.
        </p>
      </div>

      {/* Comparison cards */}
      <div className="grid md:grid-cols-3 gap-6 mb-16">
        {APPROACHES.map((approach) => (
          <div
            key={approach.name}
            className={cn(
              "rounded-2xl border p-6 shadow-sm flex flex-col",
              approach.highlight
                ? "border-emerald-400 bg-emerald-50/30 ring-2 ring-emerald-200"
                : "border-border/60 bg-card"
            )}
          >
            {approach.highlight && (
              <span className="self-start rounded-full bg-emerald-600 text-white text-xs font-medium px-3 py-1 mb-4">
                Recommended
              </span>
            )}
            <div className="flex items-center gap-3 mb-4">
              <div
                className={cn(
                  "h-10 w-10 rounded-lg flex items-center justify-center",
                  approach.highlight ? "bg-emerald-100" : "bg-secondary"
                )}
              >
                <approach.icon
                  className={cn(
                    "h-5 w-5",
                    approach.highlight ? "text-emerald-600" : "text-muted-foreground"
                  )}
                />
              </div>
              <h2 className="text-lg font-semibold">{approach.name}</h2>
            </div>

            {/* Key metrics */}
            <div className="space-y-3 mb-6">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm text-foreground/70">
                  Time to insight:{" "}
                </span>
                <span
                  className={cn(
                    "text-sm font-semibold",
                    approach.highlight ? "text-emerald-700" : "text-foreground"
                  )}
                >
                  {approach.time}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm text-foreground/70">Cost: </span>
                <span
                  className={cn(
                    "text-sm font-semibold",
                    approach.highlight ? "text-emerald-700" : "text-foreground"
                  )}
                >
                  {approach.cost}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm text-foreground/70">Expertise: </span>
                <span
                  className={cn(
                    "text-sm font-semibold",
                    approach.highlight ? "text-emerald-700" : "text-foreground"
                  )}
                >
                  {approach.expertise}
                </span>
              </div>
            </div>

            {/* Steps */}
            <div className="mb-6">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Steps required
              </p>
              <ol className="space-y-1.5">
                {approach.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-foreground/70">
                    <span className="rounded-full bg-secondary text-muted-foreground h-4 w-4 flex items-center justify-center shrink-0 text-[10px] font-medium mt-0.5">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>

            {/* Pros & Cons */}
            <div className="mt-auto space-y-3">
              <div>
                {approach.pros.map((pro) => (
                  <div
                    key={pro}
                    className="flex items-start gap-1.5 text-xs text-green-700 mb-1"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    {pro}
                  </div>
                ))}
              </div>
              <div>
                {approach.cons.map((con) => (
                  <div
                    key={con}
                    className="flex items-start gap-1.5 text-xs text-red-500 mb-1"
                  >
                    <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    {con}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="text-center">
        <Link
          href="/projects/new"
          className="inline-flex items-center gap-2 rounded-lg bg-foreground px-8 py-3 text-base font-medium text-background transition-all hover:bg-foreground/90"
        >
          Try RetailMind Free
          <ArrowRight className="h-4 w-4" />
        </Link>
        <p className="text-xs text-muted-foreground mt-3">
          No credit card required. Free tier includes 5 training jobs per month.
        </p>
      </div>
    </div>
  );
}
