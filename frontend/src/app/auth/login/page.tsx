"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, parseCognitoError } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Check for success message from signup confirmation redirect
  useEffect(() => {
    const msg = searchParams.get("confirmed");
    if (msg === "true") {
      setSuccess("Email verified successfully! You can now sign in.");
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      await signIn(email, password);
      router.push("/dashboard");
    } catch (err: unknown) {
      const message = parseCognitoError(err);
      if (message === "EMAIL_NOT_CONFIRMED") {
        setError(
          "Your email has not been verified yet. Please check your inbox for a verification code."
        );
      } else {
        setError(message);
      }
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="items-center space-y-3 pb-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <BarChart3 className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl font-display">
            Sign in to RetailMind
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Enter your credentials to continue
          </p>
        </CardHeader>

        <CardContent>
          {success && (
            <div className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-destructive">{error}</p>
                {error.includes("not been verified") && (
                  <Link
                    href={`/auth/signup?verify=${encodeURIComponent(email)}`}
                    className="inline-block text-sm font-medium text-primary hover:underline"
                  >
                    Enter verification code
                  </Link>
                )}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full"
            >
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <Link
              href="/auth/forgot-password"
              className="text-sm text-muted-foreground hover:text-primary hover:underline"
            >
              Forgot your password?
            </Link>
          </div>

          <p className="mt-3 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              href="/auth/signup"
              className="font-medium text-primary hover:underline"
            >
              Create one
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
