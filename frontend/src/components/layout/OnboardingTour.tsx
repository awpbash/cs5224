"use client";

import { useState, useEffect } from "react";
import { Upload, MessageSquare, Cpu, BarChart3, X } from "lucide-react";

const STEPS = [
  {
    icon: Upload,
    title: "Upload your data",
    description:
      "Start by uploading a CSV file or selecting one of our preloaded sample datasets. We support tabular data up to 500 MB.",
  },
  {
    icon: MessageSquare,
    title: "Describe your problem",
    description:
      "Chat with our AI assistant to define your business question. It will suggest the right target variable, features, and model type.",
  },
  {
    icon: Cpu,
    title: "Train a model",
    description:
      "We automatically select and tune the best model for your data. No data science expertise needed — just click Train.",
  },
  {
    icon: BarChart3,
    title: "Get business insights",
    description:
      "Receive plain-English recommendations, key metrics, and feature importance explanations you can act on immediately.",
  },
];

export default function OnboardingTour() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const completed = localStorage.getItem("onboarding_completed");
    if (!completed) {
      setVisible(true);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem("onboarding_completed", "true");
    setVisible(false);
  };

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      handleClose();
    }
  };

  const handleSkip = () => {
    handleClose();
  };

  if (!visible) return null;

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 rounded-2xl bg-card border border-border shadow-2xl p-8">
        {/* Close button */}
        <button
          onClick={handleSkip}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
          title="Skip tour"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Step content */}
        <div className="text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950">
            <Icon className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h2 className="text-xl font-semibold mb-2">{current.title}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {current.description}
          </p>
        </div>

        {/* Step indicator dots */}
        <div className="flex justify-center gap-1.5 mt-6 mb-6">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step
                  ? "w-6 bg-emerald-600 dark:bg-emerald-400"
                  : "w-1.5 bg-border"
              }`}
            />
          ))}
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-between">
          <button
            onClick={handleSkip}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleNext}
            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-5 py-2 text-sm font-medium text-background hover:bg-foreground/90 transition-all duration-300"
          >
            {isLast ? "Get Started" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
