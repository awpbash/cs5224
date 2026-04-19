"use client";

import React, { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProjectId } from "@/hooks/useProjectId";
import { Send, Play, Target, Columns, Zap, Clock, Edit3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getProject, sendChatMessage, updateProject } from "@/lib/api";
import type { ChatMessage, SuggestedConfig, TaskType } from "@/lib/types";

function FormattedMessage({ content }: { content: string }) {
  // Strip JSON config blocks
  let cleaned = content.replace(/```\s*json?\s*[\s\S]*?```/gi, "").trim();
  cleaned = cleaned.replace(/\{[^{}]*"(useCase|suggestedTarget|taskType)"[^{}]*\}/g, "").trim();
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  // Split into lines and render each line with proper formatting
  const lines = cleaned.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines — they become spacing
    if (!trimmed) {
      if (elements.length > 0) {
        elements.push(<div key={`sp-${i}`} className="h-1.5" />);
      }
      i++;
      continue;
    }

    // Markdown headers: ## or ### → render as styled subheadings
    if (/^#{1,4}\s/.test(trimmed)) {
      const headerText = trimmed.replace(/^#{1,4}\s*/, "");
      elements.push(
        <p key={`hd-${i}`} className="font-semibold text-sm text-foreground mt-2 mb-0.5">
          <InlineFormat text={headerText} />
        </p>
      );
      i++;
      continue;
    }

    // Numbered list: collect consecutive numbered items
    if (/^\d+[\.\)]\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[\.\)]\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[\.\)]\s*/, ""));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="list-decimal list-inside space-y-1 pl-1">
          {items.map((item, j) => (
            <li key={j} className="text-sm"><InlineFormat text={item} /></li>
          ))}
        </ol>
      );
      continue;
    }

    // Bullet list: collect consecutive bullet items
    if (/^[-•*]\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-•*]\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-•*]\s*/, ""));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="space-y-1 pl-1">
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
        <p key={`h-${i}`} className="font-semibold text-sm text-foreground mt-1">
          {trimmed.replace(/\*\*/g, "").replace(/:$/, "")}
        </p>
      );
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={`p-${i}`} className="text-sm">
        <InlineFormat text={trimmed} />
      </p>
    );
    i++;
  }

  return <div className="space-y-1">{elements}</div>;
}

function InlineFormat({ text }: { text: string }) {
  // Handle **bold** and `code` inline formatting
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={i} className="rounded bg-secondary px-1 py-0.5 text-xs font-mono text-foreground/80">{part.slice(1, -1)}</code>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export default function ChatPage() {
  const id = useProjectId();
  const router = useRouter();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [suggestedConfig, setSuggestedConfig] = useState<SuggestedConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [dataColumns, setDataColumns] = useState<string[]>([]);
  const [editingTarget, setEditingTarget] = useState(false);
  const [editTarget, setEditTarget] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getProject(id).then((project) => {
      if (project.dataProfile) {
        const dp = project.dataProfile as { columns?: { name: string }[] };
        if (dp.columns) {
          setDataColumns(dp.columns.map((c) => c.name));
        }
      }
      if (project.targetColumn || project.taskType) {
        setSuggestedConfig({
          useCase: project.useCase || "custom",
          taskType: project.taskType || "classification",
          suggestedTarget: project.targetColumn || "",
          suggestedFeatures: (project.selectedFeatures as string[]) || [],
          businessContext: "",
          timeFrame: "N/A",
        });
      }
    }).catch(() => {});
  }, [id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: inputValue.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    try {
      const response = await sendChatMessage({
        message: userMessage.content,
        sessionId,
        projectId: id,
      });

      if (response.sessionId) setSessionId(response.sessionId);
      if (response.suggestedConfig) setSuggestedConfig(response.suggestedConfig);

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: response.reply,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant" as const,
          content: "Sorry, something went wrong. Please try again.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !(e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
    // Ctrl+Enter or Cmd+Enter to accept and proceed
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && suggestedConfig) {
      e.preventDefault();
      handleAccept();
    }
  };

  const handleAccept = async () => {
    if (!suggestedConfig) return;
    try {
      await updateProject(id, {
        targetColumn: suggestedConfig.suggestedTarget,
        selectedFeatures: suggestedConfig.suggestedFeatures,
        taskType: suggestedConfig.taskType,
        useCase: suggestedConfig.useCase,
      });
    } catch {
      // Continue even if save fails
    }
    router.push(`/projects/${id}/profile`);
  };

  // Global keyboard shortcut for Ctrl/Cmd+Enter to accept
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && suggestedConfig) {
        e.preventDefault();
        handleAccept();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedConfig]);

  const handleTargetEdit = () => {
    if (suggestedConfig) {
      setSuggestedConfig({
        ...suggestedConfig,
        suggestedTarget: editTarget,
      });
    }
    setEditingTarget(false);
  };

  const toggleFeature = (col: string) => {
    if (!suggestedConfig) return;
    const features = suggestedConfig.suggestedFeatures;
    if (features.includes(col)) {
      setSuggestedConfig({
        ...suggestedConfig,
        suggestedFeatures: features.filter((f) => f !== col),
      });
    } else {
      setSuggestedConfig({
        ...suggestedConfig,
        suggestedFeatures: [...features, col],
      });
    }
  };

  return (
    <div className="flex flex-col" style={{ minHeight: "80vh" }}>
      <div className="flex flex-col lg:flex-row flex-1" style={{ minHeight: 0 }}>
        {/* LEFT: Chat area */}
        <div className="flex flex-col w-full lg:w-[45%]">
          <h2 className="text-lg font-bold mb-4">Chat with RetailMind</h2>

          <div
            className="flex-1 space-y-3 overflow-y-auto pr-6 pb-4"
            style={{ maxHeight: "420px" }}
          >
            {messages.length === 0 && (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground mb-4">
                  Describe your business problem to get started.
                </p>
                <div className="space-y-1.5">
                  {[
                    "I want to predict which customers will churn",
                    "Help me forecast next month's sales",
                    `I want to predict ${dataColumns.length > 0 ? dataColumns[dataColumns.length - 1] : "my target variable"}`,
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => { setInputValue(q); }}
                      className="block w-full text-left text-xs rounded-lg border border-border/60 px-3 py-2 text-muted-foreground hover:bg-secondary hover:text-foreground transition-all duration-300"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => {
              if (msg.role === "assistant" && !msg.content) return null;
              return (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap animate-message-in",
                      msg.role === "user"
                        ? "bg-foreground/5 border border-border/60 text-foreground"
                        : "bg-secondary border border-border/40 text-foreground/90"
                    )}
                  >
                    {msg.role === "assistant" ? (
                      <FormattedMessage content={msg.content} />
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>
              );
            })}
            {isLoading && messages[messages.length - 1]?.role === "assistant" && !messages[messages.length - 1]?.content && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm bg-secondary border border-border/40 text-muted-foreground">
                  <span className="inline-flex gap-1">
                    <span className="animate-pulse">.</span>
                    <span className="animate-pulse" style={{ animationDelay: "150ms" }}>.</span>
                    <span className="animate-pulse" style={{ animationDelay: "300ms" }}>.</span>
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="pr-6 pt-4">
            <div className="border border-border/60 rounded-xl px-3 py-2.5 bg-card">
              <input
                ref={inputRef}
                type="text"
                placeholder="Describe your problem or ask to change the target..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full text-sm outline-none bg-transparent placeholder-muted-foreground mb-2"
              />
              <div className="flex items-center justify-end">
                <button
                  onClick={handleSend}
                  disabled={!inputValue.trim() || isLoading}
                  className="w-7 h-7 rounded-full bg-foreground text-background flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300 hover:bg-foreground/90"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Vertical divider */}
        <div className="hidden lg:block w-px bg-border/60 mx-4" />

        {/* RIGHT: Problem Summary */}
        <div className="flex flex-col pl-0 lg:pl-4 w-full lg:w-[55%] mt-6 lg:mt-0">
          <h2 className="text-2xl font-display mb-4">Your Analysis Setup</h2>

          {suggestedConfig ? (
            <div className="space-y-4">
              {/* Target column */}
              <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-amber-600" />
                    <span className="text-xs font-medium text-muted-foreground">Predicting:</span>
                  </div>
                  <button
                    onClick={() => { setEditingTarget(true); setEditTarget(suggestedConfig.suggestedTarget); }}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <Edit3 className="h-3 w-3" /> Change
                  </button>
                </div>
                {editingTarget ? (
                  <div className="space-y-2">
                    <select
                      value={editTarget}
                      onChange={(e) => setEditTarget(e.target.value)}
                      className="w-full rounded-md border border-border px-3 py-2 text-sm"
                    >
                      {dataColumns.map((col) => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                      {!dataColumns.includes(editTarget) && editTarget && (
                        <option value={editTarget}>{editTarget}</option>
                      )}
                    </select>
                    <div className="flex gap-2">
                      <button
                        onClick={handleTargetEdit}
                        className="text-xs bg-foreground text-background px-3 py-1 rounded-md hover:bg-foreground/90 transition-all duration-200"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingTarget(false)}
                        className="text-xs text-muted-foreground px-3 py-1 rounded-md hover:bg-secondary"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-base font-semibold text-amber-800">{suggestedConfig.suggestedTarget || "Not set"}</p>
                )}
              </div>

              {/* Task type */}
              <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Prediction Type:</span>
                </div>
                <div className="flex gap-2">
                  {(["classification", "regression"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setSuggestedConfig({ ...suggestedConfig, taskType: t as TaskType })}
                      className={cn(
                        "rounded-lg px-3 py-1.5 text-sm font-medium border transition-all duration-300",
                        suggestedConfig.taskType === t
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-border text-muted-foreground hover:border-foreground/30"
                      )}
                    >
                      {t === "classification" ? "Category prediction (e.g., Yes/No)" : "Number prediction (e.g., $1,234)"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Business context */}
              {suggestedConfig.businessContext && (
                <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">Business Context</span>
                  </div>
                  <p className="text-sm text-foreground/80">{suggestedConfig.businessContext}</p>
                  {suggestedConfig.timeFrame && suggestedConfig.timeFrame !== "N/A" && (
                    <p className="text-xs text-muted-foreground mt-1">Time Period: {suggestedConfig.timeFrame}</p>
                  )}
                </div>
              )}

              {/* Suggested features */}
              {dataColumns.length > 0 && (
                <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <Columns className="h-4 w-4 text-emerald-600" />
                    <span className="text-xs font-medium text-muted-foreground">
                      Features
                    </span>
                    <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-semibold">
                      {suggestedConfig.suggestedFeatures.length} of {dataColumns.filter(c => c !== suggestedConfig.suggestedTarget).length} selected
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                    {dataColumns
                      .filter((col) => col !== suggestedConfig.suggestedTarget)
                      .map((col) => {
                        const selected = suggestedConfig.suggestedFeatures.includes(col);
                        return (
                          <button
                            key={col}
                            onClick={() => toggleFeature(col)}
                            className={cn(
                              "rounded-full border px-2 py-1 text-xs transition-all duration-300",
                              selected
                                ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                                : "border-border text-muted-foreground hover:border-foreground/30"
                            )}
                          >
                            {col}
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-muted-foreground text-center">
                Describe your business problem in the chat<br />and a configuration will appear here.
              </p>
            </div>
          )}

          {/* Accept / Reject buttons */}
          {suggestedConfig && (
            <div className="flex flex-col items-center mt-6">
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={handleAccept}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-all duration-300"
                >
                  <Play className="h-4 w-4 fill-current" />
                  Accept and Proceed
                </button>
                <button
                  onClick={() => inputRef.current?.focus()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-border text-foreground text-sm font-medium hover:bg-secondary transition-all duration-300"
                >
                  Reject and Modify
                </button>
              </div>
              <span className="text-[11px] text-muted-foreground mt-1.5">
                {"\u2318\u21B5"} to accept
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
