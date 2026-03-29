"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Lock, Shield, User } from "lucide-react";

import { createBrowserClient } from "@/lib/db/supabase-browser";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type ProfileRow = {
  full_name: string | null;
  email: string | null;
  branch: string | null;
  semester: number | null;
  role: string | null;
};

type FieldErrors = {
  current?: string;
  new?: string;
  confirm?: string;
};

function PasswordField({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
  show,
  onToggleShow,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  disabled?: boolean;
  show: boolean;
  onToggleShow: () => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn("pr-10", error && "border-destructive")}
          autoComplete={
            id === "current-password"
              ? "current-password"
              : id === "new-password"
                ? "new-password"
                : "new-password"
          }
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
          onClick={onToggleShow}
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

export default function StudentProfilePage() {
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const supabase = createBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setProfile(null);
          return;
        }
        const { data } = await supabase
          .from("profiles")
          .select("full_name, email, branch, semester, role")
          .eq("id", user.id)
          .single();
        setProfile(data as ProfileRow);
      } catch {
        setProfile(null);
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    if (!passwordSuccess) return;
    const t = setTimeout(() => setPasswordSuccess(""), 5000);
    return () => clearTimeout(t);
  }, [passwordSuccess]);

  useEffect(() => {
    if (!passwordError) return;
    const t = setTimeout(() => setPasswordError(""), 5000);
    return () => clearTimeout(t);
  }, [passwordError]);

  const initials = useMemo(() => {
    const name = profile?.full_name?.trim();
    if (!name) return "?";
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }, [profile?.full_name]);

  const validatePasswordForm = useCallback((): boolean => {
    const err: FieldErrors = {};
    if (!currentPassword.trim()) {
      err.current = "Required";
    }
    if (!newPassword.trim()) {
      err.new = "Required";
    } else if (newPassword.length < 8) {
      err.new = "Must be at least 8 characters";
    } else if (newPassword === currentPassword) {
      err.new = "Must be different from your current password";
    }
    if (!confirmPassword.trim()) {
      err.confirm = "Required";
    } else if (confirmPassword !== newPassword) {
      err.confirm = "Does not match new password";
    }
    setFieldErrors(err);
    return Object.keys(err).length === 0;
  }, [confirmPassword, currentPassword, newPassword]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");
    if (!validatePasswordForm() || !profile?.email) return;

    setIsChangingPassword(true);
    try {
      const supabase = createBrowserClient();
      const email = String(profile.email);

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });

      if (signInError) {
        setPasswordError("Current password is incorrect.");
        setIsChangingPassword(false);
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        setPasswordError(updateError.message);
      } else {
        setPasswordSuccess("Password changed successfully.");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setFieldErrors({});
      }
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsChangingPassword(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading profile…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>
            Could not load your profile. Please sign in again.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
          <User className="size-6 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">My Profile</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Shield className="size-5 text-muted-foreground" />
            Profile information
          </CardTitle>
          <CardDescription>Read-only details for your account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
              {initials}
            </div>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <p className="text-xl font-semibold">
                {profile.full_name ?? "—"}
              </p>
              <p className="text-muted-foreground">{profile.email ?? "—"}</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Branch</p>
              <p className="text-sm font-medium">{profile.branch ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Semester
              </p>
              <p className="text-sm font-medium">
                {profile.semester != null
                  ? `Semester ${profile.semester}`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Role</p>
              <Badge variant="secondary" className="mt-0.5">
                Student
              </Badge>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Account</p>
              <p className="text-sm font-medium">Active</p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            To update your branch or semester, contact your administrator.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Lock className="size-5 text-muted-foreground" />
            Change password
          </CardTitle>
          <CardDescription>
            Re-enter your current password, then choose a new one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-4">
            {passwordError ? (
              <Alert variant="destructive">
                <AlertDescription>{passwordError}</AlertDescription>
              </Alert>
            ) : null}
            {passwordSuccess ? (
              <Alert className="border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/30 dark:text-green-100">
                <AlertDescription>{passwordSuccess}</AlertDescription>
              </Alert>
            ) : null}

            <PasswordField
              id="current-password"
              label="Current password"
              value={currentPassword}
              onChange={(v) => {
                setCurrentPassword(v);
                setFieldErrors((f) => ({ ...f, current: undefined }));
              }}
              error={fieldErrors.current}
              disabled={isChangingPassword}
              show={showCurrent}
              onToggleShow={() => setShowCurrent((s) => !s)}
            />
            <PasswordField
              id="new-password"
              label="New password"
              value={newPassword}
              onChange={(v) => {
                setNewPassword(v);
                setFieldErrors((f) => ({ ...f, new: undefined }));
              }}
              error={fieldErrors.new}
              disabled={isChangingPassword}
              show={showNew}
              onToggleShow={() => setShowNew((s) => !s)}
            />
            <PasswordField
              id="confirm-password"
              label="Confirm new password"
              value={confirmPassword}
              onChange={(v) => {
                setConfirmPassword(v);
                setFieldErrors((f) => ({ ...f, confirm: undefined }));
              }}
              error={fieldErrors.confirm}
              disabled={isChangingPassword}
              show={showConfirm}
              onToggleShow={() => setShowConfirm((s) => !s)}
            />

            <Button type="submit" disabled={isChangingPassword}>
              {isChangingPassword ? "Updating…" : "Update password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
