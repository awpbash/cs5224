"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart3, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  signUp,
  confirmSignUp,
  resendConfirmationCode,
  parseCognitoError,
} from "@/lib/auth";

type Step = "register" | "verify";

export default function SignupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendMessage, setResendMessage] = useState("");

  // If redirected from login with ?verify=email, jump straight to verify step
  useEffect(() => {
    const verifyEmail = searchParams.get("verify");
    if (verifyEmail) {
      setEmail(verifyEmail);
      setStep("verify");
    }
  }, [searchParams]);

  // ─── Registration ──────────────────────────────────────────────────────────

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      await signUp(email, password, name);
      setStep("verify");
    } catch (err: unknown) {
      setError(parseCognitoError(err));
    } finally {
      setLoading(false);
    }
  };

  // ─── Verification ──────────────────────────────────────────────────────────

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await confirmSignUp(email, code);
      router.push("/auth/login?confirmed=true");
    } catch (err: unknown) {
      setError(parseCognitoError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setError("");
    setResendMessage("");

    try {
      await resendConfirmationCode(email);
      setResendMessage("A new verification code has been sent to your email.");
    } catch (err: unknown) {
      setError(parseCognitoError(err));
    }
  };

  // ─── Register Form ─────────────────────────────────────────────────────────

  if (step === "register") {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-background px-4 py-12">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="items-center space-y-3 pb-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white">
              <BarChart3 className="h-6 w-6" />
            </div>
            <CardTitle className="text-2xl font-display">
              Create your account
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Get started with RetailMind for free
            </p>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleRegister} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Jane Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

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
                  placeholder="Create a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
                <p className="text-xs text-muted-foreground">
                  At least 8 characters with uppercase, lowercase, numbers, and
                  special characters.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>

              {error && (
                <p className="text-sm font-medium text-destructive">{error}</p>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full"
              >
                {loading ? "Creating account..." : "Create Account"}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link
                href="/auth/login"
                className="font-medium text-primary hover:underline"
              >
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Verification Form ──────────────────────────────────────────────────────

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="items-center space-y-3 pb-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <BarChart3 className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl font-display">
            Verify your email
          </CardTitle>
          <p className="text-sm text-muted-foreground text-center">
            We sent a verification code to{" "}
            <span className="font-medium text-foreground">{email}</span>.
            <br />
            Enter it below to complete registration.
          </p>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleVerify} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="code">Verification Code</Label>
              <Input
                id="code"
                type="text"
                placeholder="Enter 6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoFocus
                maxLength={6}
              />
            </div>

            {error && (
              <p className="text-sm font-medium text-destructive">{error}</p>
            )}

            {resendMessage && (
              <p className="text-sm font-medium text-green-700">
                {resendMessage}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full"
            >
              {loading ? "Verifying..." : "Verify Email"}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={handleResendCode}
              className="text-sm font-medium text-primary hover:underline"
            >
              Resend verification code
            </button>
          </div>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => setStep("register")}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to registration
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
