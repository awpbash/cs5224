"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isAuthenticated, refreshSession } from "@/lib/auth";

/** Routes that do not require authentication */
const PUBLIC_ROUTES = ["/", "/auth/login", "/auth/signup"];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "authenticated" | "public">(
    "loading"
  );

  useEffect(() => {
    // Public routes don't need auth check
    if (isPublicRoute(pathname)) {
      setStatus("public");
      return;
    }

    // Check if we have a valid token
    if (isAuthenticated()) {
      setStatus("authenticated");
      return;
    }

    // Try to refresh the session from Cognito's local storage
    refreshSession()
      .then((session) => {
        if (session) {
          setStatus("authenticated");
        } else {
          router.replace("/auth/login");
        }
      })
      .catch(() => {
        router.replace("/auth/login");
      });
  }, [pathname, router]);

  // Show a loading spinner while checking auth on protected routes
  if (status === "loading") {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-foreground" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
