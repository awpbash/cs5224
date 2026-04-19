"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Upload,
  MessageSquareText,
  BrainCircuit,
  Lightbulb,
  ArrowRight,
} from "lucide-react";
import { getToken } from "@/lib/auth";

const STEPS = [
  {
    icon: Upload,
    title: "Upload Data",
    description:
      "Drag and drop your CSV files or pick a sample dataset. We handle profiling and preprocessing.",
  },
  {
    icon: MessageSquareText,
    title: "Describe Your Problem",
    description:
      "Tell us what you want to predict. Our chatbot helps you refine the problem definition.",
  },
  {
    icon: BrainCircuit,
    title: "Train Model",
    description:
      "We automatically select the best algorithm, tune hyperparameters, and train on AWS.",
  },
  {
    icon: Lightbulb,
    title: "Get Insights",
    description:
      "View business insights, feature importance, and run predictions on new data.",
  },
];

export default function LandingPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => { setLoggedIn(!!getToken()); }, []);
  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="relative bg-gradient-to-b from-[#fafaf7] to-background py-28 md:py-36 grain">
        <div className="mx-auto max-w-3xl px-6 text-center relative z-10">
          <h1 className="text-5xl md:text-6xl font-display tracking-tight text-foreground">
            AI-Powered Analytics for Retail SMEs
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
            Describe your business problem, upload your data, and get a trained
            ML model with actionable insights — no code or data science
            expertise required.
          </p>
          <div className="mt-12 flex items-center justify-center gap-4">
            <Link
              href={loggedIn ? "/dashboard" : "/projects/new"}
              className="inline-flex items-center gap-2 rounded-lg bg-foreground px-8 py-3 text-sm font-medium text-background transition-all duration-300 hover:bg-foreground/90"
            >
              {loggedIn ? "Go to Dashboard" : "Get Started"}
              <ArrowRight className="h-4 w-4" />
            </Link>
            {!loggedIn && (
              <Link
                href="/auth/login"
                className="inline-flex items-center rounded-lg border border-foreground px-8 py-3 text-sm font-medium text-foreground transition-all duration-300 hover:bg-foreground hover:text-background"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-24">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="text-center text-3xl font-display tracking-tight text-foreground">
            How It Works
          </h2>

          <div className="mt-16 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <div key={step.title} className="text-center border border-border/60 bg-card rounded-xl p-8">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <step.icon className="h-5 w-5" />
                </div>
                <p className="mt-5 text-xs text-muted-foreground">
                  {i + 1}
                </p>
                <h3 className="mt-1 text-sm font-medium">{step.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Compare CTA */}
      <section className="py-16 border-t">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-2xl font-display tracking-tight text-foreground">
            How does RetailMind compare?
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            See how we stack up against hiring a data scientist or using Amazon SageMaker.
          </p>
          <Link
            href="/compare"
            className="mt-6 inline-flex items-center gap-2 rounded-lg border border-foreground px-6 py-2.5 text-sm font-medium text-foreground transition-all duration-300 hover:bg-foreground hover:text-background"
          >
            View Comparison
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
