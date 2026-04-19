"use client";

/**
 * Returns the real project ID from the browser URL.
 *
 * With static export + CloudFront rewriting, useParams() may return the
 * pre-rendered fallback ID (e.g. "proj_001") instead of the actual UUID.
 * This hook reads from window.location.pathname to get the real ID.
 */
export function useProjectId(): string {
  if (typeof window !== "undefined") {
    const match = window.location.pathname.match(/\/projects\/([^/]+)/);
    if (match && match[1]) {
      return match[1];
    }
  }
  return "unknown";
}
