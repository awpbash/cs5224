import type {
  Project,
  Job,
  DataProfile,
  PreloadedDataset,
  ChatMessage,
  SuggestedConfig,
  InferenceResponse,
} from "./types";
import { getToken, signOut } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  // Handle expired/invalid token - redirect to login
  if (res.status === 401) {
    signOut();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/auth")) {
      window.location.href = "/auth/login";
    }
    throw new Error("Session expired. Please sign in again.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

// ─── Projects ───────────────────────────────────────────────────────────────

export function createProject(body: {
  projectName: string;
  useCase: string;
  taskType: string;
}) {
  return request<Project>("/projects", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listProjects() {
  return request<Project[]>("/projects");
}

export function getProject(id: string) {
  return request<Project>(`/projects/${id}`);
}

export function updateProject(
  id: string,
  body: Record<string, unknown>
) {
  return request<Project>(`/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteProject(id: string) {
  return request<void>(`/projects/${id}`, { method: "DELETE" });
}

// ─── Data ───────────────────────────────────────────────────────────────────

export function getUploadUrl(projectId: string, filename: string) {
  return request<{ uploadUrl: string; s3Key: string }>(
    `/projects/${projectId}/upload-url`,
    { method: "POST", body: JSON.stringify({ filename }) }
  );
}

export function selectPreloaded(projectId: string, datasetId: string) {
  return request<Project>(`/projects/${projectId}/select-preloaded`, {
    method: "POST",
    body: JSON.stringify({ datasetId }),
  });
}

export function listPreloadedDatasets() {
  return request<PreloadedDataset[]>("/preloaded-datasets");
}

// ─── Profile ────────────────────────────────────────────────────────────────

export function recomputeProfile(
  projectId: string,
  targetColumn: string,
  selectedFeatures?: string[],
  fullProfile?: boolean
) {
  return request<{
    dataProfile?: DataProfile;
    correlation?: Record<string, Record<string, number>>;
    pca?: {
      varianceExplained: number[];
      cumulativeVariance: number[];
      components: number;
      featureNames: string[];
      loadings?: { pc: number; topFeatures: { feature: string; loading: number }[] }[];
    };
    classBalance?: { label: string; count: number }[];
    targetDistribution?: {
      type: string;
      column: string;
      histogram: { bin: string; count: number }[];
    };
  }>(`/projects/${projectId}/recompute-profile`, {
    method: "POST",
    body: JSON.stringify({ targetColumn, selectedFeatures, fullProfile }),
  });
}

// ─── Pipeline ───────────────────────────────────────────────────────────────

export function triggerPipeline(
  projectId: string,
  body: {
    targetColumn: string;
    selectedFeatures?: string[];
    modelType?: string;
    mode?: string;
    trainSplit?: number;
    hyperparameters?: Record<string, string>;
  }
) {
  return request<{ jobId: string }>(`/projects/${projectId}/train`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getJobStatus(projectId: string, jobId: string) {
  return request<Job>(`/projects/${projectId}/jobs/${jobId}`);
}

// ─── Inference ──────────────────────────────────────────────────────────────

export function runInference(
  projectId: string,
  jobId: string,
  features: Record<string, string | number>
) {
  return request<InferenceResponse>(
    `/projects/${projectId}/jobs/${jobId}/infer`,
    { method: "POST", body: JSON.stringify({ features }) }
  );
}

export function getModelDownloadUrl(projectId: string, jobId: string) {
  return request<{ downloadUrl: string }>(
    `/projects/${projectId}/jobs/${jobId}/download`
  );
}

// ─── Chatbot ────────────────────────────────────────────────────────────────

export function sendChatMessage(body: {
  sessionId?: string;
  projectId?: string;
  message: string;
}) {
  return request<{
    sessionId: string;
    reply: string;
    suggestedConfig: SuggestedConfig | null;
    messages: ChatMessage[];
  }>("/chat", { method: "POST", body: JSON.stringify(body) });
}

// ─── Interpret ──────────────────────────────────────────────────────────────

export function interpretResults(projectId: string, jobId: string) {
  return request<{
    businessSummary: string;
    recommendations: { title: string; description: string; impact: string }[];
    insights?: { feature: string; explanation: string }[];
  }>(`/projects/${projectId}/jobs/${jobId}/interpret`, { method: "POST" });
}

// ─── Results Chat ──────────────────────────────────────────────────────────

export function resultsChatMessage(
  projectId: string,
  message: string,
  history: { role: string; content: string }[]
) {
  return request<{ reply: string }>(`/projects/${projectId}/results-chat`, {
    method: "POST",
    body: JSON.stringify({ message, history }),
  });
}
