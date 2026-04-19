"use client";

import { useEffect } from "react";
import { CheckCircle, XCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";

export function ToastContainer() {
  const { toasts, dismiss } = useToast();

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          id={toast.id}
          variant={toast.variant}
          message={toast.message}
          onDismiss={dismiss}
        />
      ))}
    </div>
  );
}

function ToastItem({
  id,
  variant,
  message,
  onDismiss,
}: {
  id: string;
  variant: "success" | "error";
  message: string;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), 4000);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border px-4 py-3 shadow-md text-sm animate-in slide-in-from-right-5 fade-in duration-300",
        variant === "success"
          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
          : "bg-red-50 border-red-200 text-red-800"
      )}
    >
      {variant === "success" ? (
        <CheckCircle className="h-4 w-4 shrink-0 text-emerald-600" />
      ) : (
        <XCircle className="h-4 w-4 shrink-0 text-red-600" />
      )}
      <span className="flex-1">{message}</span>
      <button
        onClick={() => onDismiss(id)}
        className="shrink-0 rounded-md p-0.5 opacity-60 hover:opacity-100 transition-opacity"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
