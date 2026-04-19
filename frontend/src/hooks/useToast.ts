"use client";

import { useCallback, useSyncExternalStore } from "react";

export interface Toast {
  id: string;
  variant: "success" | "error";
  message: string;
}

let toasts: Toast[] = [];
let listeners: Array<() => void> = [];

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function getSnapshot(): Toast[] {
  return toasts;
}

let nextId = 0;

export function toast(variant: "success" | "error", message: string) {
  const id = String(++nextId);
  toasts = [...toasts, { id, variant, message }];
  emitChange();

  // Auto-remove after 4.5s (buffer beyond the 4s UI auto-dismiss)
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emitChange();
  }, 4500);
}

export function useToast() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const dismiss = useCallback((id: string) => {
    toasts = toasts.filter((t) => t.id !== id);
    emitChange();
  }, []);

  return { toasts: current, dismiss, toast };
}
