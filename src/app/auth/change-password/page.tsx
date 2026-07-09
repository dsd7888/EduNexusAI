"use client";

import { createBrowserClient } from "@/lib/db/supabase-browser";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

const MIN_LENGTH = 8;

// form:      entering + confirming the new password
// finishing: password IS set in Supabase Auth, but clearing the must_change_password
//            flag failed — retry ONLY that call, never the password (a repeated
//            identical password could be rejected and strand the user in a loop).
// done:      flag cleared, gate retired
type Phase = "form" | "finishing" | "done";

export default function ChangePasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("form");

  // Retire the forced-change gate for this user (own row only). Returns true on
  // success. Standalone so the "finishing" state can retry it without a password.
  const clearFlag = useCallback(async (): Promise<boolean> => {
    const res = await fetch("/api/auth/change-password", { method: "POST" });
    return res.ok;
  }, []);

  const handleSubmit = useCallback(async () => {
    if (password.length < MIN_LENGTH) {
      setError(`Your new password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }

    setLoading(true);
    setError(null);

    const supabase = createBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setLoading(false);
      setError(updateError.message);
      return;
    }

    // Password is now set in Supabase Auth. From here on we NEVER resubmit it — only
    // retry the flag-clear, so a failure here can't loop the user back through Auth.
    const ok = await clearFlag();
    setLoading(false);
    setPhase(ok ? "done" : "finishing");
  }, [password, confirm, clearFlag]);

  const handleFinish = useCallback(async () => {
    setLoading(true);
    setError(null);
    const ok = await clearFlag();
    setLoading(false);
    if (ok) {
      setPhase("done");
    } else {
      setError(
        "We still couldn't finish setting up your account. Please try again."
      );
    }
  }, [clearFlag]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-md">
        {phase === "done" ? (
          <>
            <CardHeader className="space-y-2 text-center">
              <div className="flex justify-center">
                <CheckCircle2 className="size-10 text-primary" />
              </div>
              <CardTitle className="text-2xl font-bold">
                Password updated
              </CardTitle>
              <CardDescription>
                You&apos;re all set. Let&apos;s add your first subject.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href="/faculty/syllabus">Continue to Syllabus</Link>
              </Button>
            </CardContent>
          </>
        ) : phase === "finishing" ? (
          <>
            <CardHeader className="space-y-2 text-center">
              <CardTitle className="text-2xl font-bold">
                Almost there
              </CardTitle>
              <CardDescription>
                Your new password is set. We just need to finish setting up your
                account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                type="button"
                onClick={handleFinish}
                disabled={loading}
                className="w-full"
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Finishing...
                  </>
                ) : (
                  "Finish setup"
                )}
              </Button>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader className="space-y-1 text-center">
              <CardTitle className="text-2xl font-bold">
                Set your password
              </CardTitle>
              <CardDescription>
                Before you start, please choose a new password for your account.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="new-password" className="sr-only">
                  New password
                </label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="New password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={loading}
                    aria-invalid={!!error}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:pointer-events-none disabled:opacity-50"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    disabled={loading}
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="confirm-password" className="sr-only">
                  Confirm new password
                </label>
                <Input
                  id="confirm-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Confirm new password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                  aria-invalid={!!error}
                />
              </div>

              <Button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                className="w-full"
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save password"
                )}
              </Button>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
