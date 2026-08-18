"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Lock, Shield, User } from "lucide-react";

import { createBrowserClient } from "@/lib/db/supabase-browser";
import { MonoTag } from "@/components/ui/mono-tag";
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
      <Label htmlFor={id} className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-600">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            "rounded-8 border-ink-200 pr-10 font-plex-sans focus-visible:ring-ink-900",
            error && "border-brick-red"
          )}
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
          className="absolute right-2 top-1/2 min-h-8 min-w-8 -translate-y-1/2 rounded-4 p-1 text-ink-500 transition-colors duration-180 ease-out hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
          onClick={onToggleShow}
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {error ? (
        <p className="font-plex-sans text-xs text-brick-red">{error}</p>
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
        <p className="font-plex-sans text-body-sm text-ink-500">Loading profile…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-4">
        <div className="rounded-8 border border-brick-red bg-paper p-4">
          <p className="font-plex-sans text-body-sm text-brick-red">
            Could not load your profile. Please sign in again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-8 border border-ochre bg-paper">
          <User className="size-6 text-ochre" />
        </div>
        <h1 className="font-plex-serif text-display-sm font-semibold text-ink">My Profile</h1>
      </div>

      <div className="rounded-12 border border-ink-200 bg-paper p-6">
        <div className="flex items-center gap-2">
          <Shield className="size-5 text-ink-400" />
          <h2 className="font-plex-sans text-body font-semibold text-ink">Profile information</h2>
        </div>
        <p className="mt-1 font-plex-sans text-body-sm text-ink-500">Read-only details for your account.</p>

        <div className="mt-6 space-y-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-ink font-plex-sans text-lg font-semibold text-paper">
              {initials}
            </div>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <p className="font-plex-sans text-body-lg font-semibold text-ink">
                {profile.full_name ?? "—"}
              </p>
              <p className="font-plex-sans text-body-sm text-ink-500">{profile.email ?? "—"}</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">Branch</p>
              <p className="mt-0.5 font-plex-sans text-body-sm font-medium text-ink">{profile.branch ?? "—"}</p>
            </div>
            <div>
              <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">
                Semester
              </p>
              <p className="mt-0.5 font-plex-sans text-body-sm font-medium text-ink">
                {profile.semester != null
                  ? `Semester ${profile.semester}`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">Role</p>
              <MonoTag className="mt-1">Student</MonoTag>
            </div>
            <div>
              <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">Account</p>
              <p className="mt-0.5 font-plex-sans text-body-sm font-medium text-ink">Active</p>
            </div>
          </div>

          <p className="font-plex-sans text-xs text-ink-500">
            To update your branch or semester, contact your administrator.
          </p>
        </div>
      </div>

      <div className="rounded-12 border border-ink-200 bg-paper p-6">
        <div className="flex items-center gap-2">
          <Lock className="size-5 text-ink-400" />
          <h2 className="font-plex-sans text-body font-semibold text-ink">Change password</h2>
        </div>
        <p className="mt-1 font-plex-sans text-body-sm text-ink-500">
          Re-enter your current password, then choose a new one.
        </p>

        <form onSubmit={handleChangePassword} className="mt-6 space-y-4">
          {passwordError ? (
            <div className="rounded-8 border border-brick-red bg-paper p-3">
              <p className="font-plex-sans text-body-sm text-brick-red">{passwordError}</p>
            </div>
          ) : null}
          {passwordSuccess ? (
            <div className="rounded-8 border border-mastery-green bg-paper p-3">
              <p className="font-plex-sans text-body-sm text-mastery-green">{passwordSuccess}</p>
            </div>
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

          <button
            type="submit"
            disabled={isChangingPassword}
            className="flex h-11 items-center gap-1.5 rounded-8 bg-ink px-5 font-plex-sans text-body-sm font-medium text-paper transition-colors duration-180 ease-out hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            {isChangingPassword ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
