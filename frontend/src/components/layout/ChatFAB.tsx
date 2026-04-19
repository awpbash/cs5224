"use client";

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getToken } from "@/lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

async function chatRequest(message: string, sessionId?: string) {
  const token = getToken();
  const res = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message, sessionId }),
  });
  if (!res.ok) throw new Error("Chat unavailable");
  return res.json() as Promise<{ sessionId: string; reply: string }>;
}

interface Message {
  role: "user" | "assistant";
  text: string;
}

export default function ChatFAB() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Hi! I'm RetailMind. How can I help you with your analytics?" },
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: userMessage }]);
    setLoading(true);

    try {
      const response = await chatRequest(userMessage, sessionId);

      if (response.sessionId) {
        setSessionId(response.sessionId);
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: response.reply },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Sorry, something went wrong. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {open && (
        <div className="mb-3 w-80 rounded-xl border border-border/60 bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 bg-card rounded-t-xl">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-100">
                <MessageCircle className="h-3.5 w-3.5 text-emerald-600" />
              </div>
              <span className="text-sm font-semibold">RetailMind Assistant</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-secondary">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="h-64 overflow-y-auto p-3 space-y-2">
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                  m.role === "user"
                    ? "ml-auto bg-foreground/5 border border-border/60 text-foreground"
                    : "bg-secondary text-foreground/90"
                )}
              >
                {m.text}
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-secondary rounded-2xl px-3 py-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-pulse" />
                    <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-pulse" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <form
            className="flex items-center gap-2 border-t border-border/60 px-3 py-2.5"
            onSubmit={handleSubmit}
          >
            <input
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Ask me anything..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="h-7 w-7 rounded-full bg-foreground text-background flex items-center justify-center hover:bg-foreground/90 disabled:opacity-50 transition-all duration-300"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </button>
          </form>
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-background shadow-lg transition-all duration-300 hover:bg-foreground/90 hover:shadow-xl"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>
    </div>
  );
}
