"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useProjectId } from "@/hooks/useProjectId";
import { cn } from "@/lib/utils";
import {
  Upload,
  MessageCircle,
  BarChart3,
  Play,
  Trophy,
  Zap,
  Check,
} from "lucide-react";

const STEPS = [
  { key: "upload", label: "Upload", icon: Upload, href: "upload" },
  { key: "chat", label: "Chat", icon: MessageCircle, href: "chat" },
  { key: "profile", label: "Profile", icon: BarChart3, href: "profile" },
  { key: "train", label: "Train", icon: Play, href: "train" },
  { key: "results", label: "Results", icon: Trophy, href: "results" },
  { key: "infer", label: "Inference", icon: Zap, href: "infer" },
] as const;

export default function StepBar() {
  const id = useProjectId();
  const pathname = usePathname();

  const currentStepIndex = STEPS.findIndex((step) =>
    pathname.endsWith(`/${step.href}`)
  );

  return (
    <div className="bg-[#fafaf7]/90 backdrop-blur-xl border-b border-border/40">
      <div className="mx-auto max-w-5xl px-6 py-4">
        <nav className="flex items-center justify-between">
          {STEPS.map((step, index) => {
            const isActive = index === currentStepIndex;
            const isCompleted = currentStepIndex > index;
            const isClickable = isActive || isCompleted;
            const StepIcon = step.icon;

            const content = (
              <>
                <div
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-lg border-2 transition-all duration-300",
                    isActive &&
                      "border-emerald-600 bg-emerald-600 text-white shadow-sm",
                    isCompleted &&
                      "border-emerald-600 bg-emerald-50 text-emerald-600",
                    !isActive &&
                      !isCompleted &&
                      "border-border text-muted-foreground"
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <StepIcon className="h-4 w-4" />
                  )}
                </div>
                <span
                  className={cn(
                    "text-xs font-medium",
                    isActive && "text-emerald-600",
                    isCompleted && "text-foreground",
                    !isActive && !isCompleted && "text-muted-foreground"
                  )}
                >
                  {step.label}
                </span>
              </>
            );

            return (
              <React.Fragment key={step.key}>
                {isClickable ? (
                  <Link
                    href={`/projects/${id}/${step.href}`}
                    className="flex flex-col items-center gap-1.5 transition-all duration-300"
                  >
                    {content}
                  </Link>
                ) : (
                  <div
                    className="flex flex-col items-center gap-1.5 transition-all duration-300 cursor-not-allowed"
                  >
                    {content}
                  </div>
                )}

                {index < STEPS.length - 1 && (
                  <div
                    className={cn(
                      "h-0.5 flex-1 mx-2 rounded transition-all duration-300",
                      isCompleted ? "bg-emerald-600" : "bg-border"
                    )}
                  />
                )}
              </React.Fragment>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
