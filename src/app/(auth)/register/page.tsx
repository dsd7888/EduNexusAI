"use client";

import { createBrowserClient } from "@/lib/db/supabase-browser";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateField(
  name: string,
  value: string | number | undefined,
  all: { fullName: string; email: string; password: string; confirmPassword: string; role: string; department: string; branch: string; semester: string }
): string | null {
  switch (name) {
    case "fullName":
      if (!all.fullName.trim()) return "Full name is required.";
      if (all.fullName.trim().length < 2) return "Full name must be at least 2 characters.";
      return null;
    case "email":
      if (!all.email.trim()) return "Email is required.";
      if (!EMAIL_REGEX.test(all.email.trim())) return "Please enter a valid email.";
      return null;
    case "password":
      if (!all.password) return "Password is required.";
      if (all.password.length < 8) return "Password must be at least 8 characters.";
      return null;
    case "confirmPassword":
      if (!all.confirmPassword) return "Please confirm your password.";
      if (all.password !== all.confirmPassword) return "Passwords do not match.";
      return null;
    case "role":
      if (!all.role) return "Please select a role.";
      return null;
    case "department":
      if (!all.department.trim()) return "Department is required.";
      return null;
    case "branch":
      if (all.role === "student" && !all.branch) return "Branch is required.";
      return null;
    case "semester":
      if (all.role === "student") {
        if (!all.semester) return "Semester is required.";
        const n = Number(all.semester);
        if (isNaN(n) || n < 1 || n > 8) return "Semester must be 1-8.";
      }
      return null;
    default:
      return null;
  }
}

export default function RegisterPage() {
  const fullNameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const departmentRef = useRef<HTMLInputElement>(null);
  const branchTriggerRef = useRef<HTMLButtonElement>(null);
  const semesterRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<"student" | "faculty" | "">("");
  const [department, setDepartment] = useState("");
  const [branch, setBranch] = useState<"chem" | "mech" | "">("");
  const [semester, setSemester] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fullNameRef.current?.focus();
  }, []);

  const runValidation = useCallback(() => {
    const all = {
      fullName,
      email,
      password,
      confirmPassword,
      role,
      department,
      branch,
      semester,
    };
    const errors: Record<string, string> = {};
    const fields: (keyof typeof all)[] = ["fullName", "email", "password", "confirmPassword", "role", "department", "branch", "semester"];
    fields.forEach((f) => {
      const msg = validateField(f, all[f], all);
      if (msg) errors[f] = msg;
    });
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [fullName, email, password, confirmPassword, role, department, branch, semester]);

  const handleSubmit = useCallback(async () => {
    if (!runValidation()) return;

    setLoading(true);
    setError(null);
    setFieldErrors({});

    const supabase = createBrowserClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          role,
          department: department.trim(),
          branch: role === "student" ? branch || null : null,
          semester: role === "student" && semester ? Number(semester) : null,
        },
      },
    });

    if (!signUpError && !data?.user && !data?.session) {
      setError("An account with this email already exists. Please sign in instead.");
      setLoading(false);
      return;
    }

    if (signUpError?.message?.includes("rate limit") || signUpError?.message?.includes("email_send_rate_limit")) {
      setError("Too many attempts. Please wait a few minutes before trying again.");
      setLoading(false);
      return;
    }

    if (signUpError) {
      setLoading(false);
      setError(signUpError.message);
      return;
    }

    setSuccess(true);
    setLoading(false);
  }, [fullName, email, password, role, department, branch, semester, runValidation]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, field: string) => {
    if (e.key !== "Enter") return;
    e.preventDefault();

    if (field === "department") {
      if (role !== "student") handleSubmit();
      else branchTriggerRef.current?.focus();
    } else if (field === "semester") {
      handleSubmit();
    } else if (field === "fullName") {
      emailRef.current?.focus();
    } else if (field === "email") {
      passwordRef.current?.focus();
    } else if (field === "password") {
      confirmPasswordRef.current?.focus();
    } else if (field === "confirmPassword") {
      departmentRef.current?.focus();
    }
  }, [role, handleSubmit]);

  if (success) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md shadow-md">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-2xl font-bold">EduNexus AI</CardTitle>
            <CardDescription>Your AI-powered learning platform</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="border-green-500/50 bg-green-500/10 text-green-800 dark:text-green-300 dark:border-green-400/50 dark:bg-green-500/10">
              <AlertDescription>
                Account created! Please check your email to confirm your account.
              </AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter className="flex justify-center">
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
                Sign In
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto shadow-md">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold">EduNexus AI</CardTitle>
          <CardDescription>Your AI-powered learning platform</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div role="group" aria-label="Create account form" className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="fullName" className="sr-only">Full Name</label>
              <Input
                ref={fullNameRef}
                id="fullName"
                name="fullName"
                type="text"
                autoComplete="name"
                placeholder="Full Name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, "fullName")}
                disabled={loading}
                aria-invalid={!!fieldErrors.fullName}
              />
              {fieldErrors.fullName && (
                <p className="text-sm text-destructive">{fieldErrors.fullName}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="email" className="sr-only">Email</label>
              <Input
                ref={emailRef}
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, "email")}
                disabled={loading}
                aria-invalid={!!fieldErrors.email}
              />
              {fieldErrors.email && (
                <p className="text-sm text-destructive">{fieldErrors.email}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="sr-only">Password</label>
              <div className="relative">
                <Input
                  ref={passwordRef}
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, "password")}
                  disabled={loading}
                  aria-invalid={!!fieldErrors.password}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:pointer-events-none disabled:opacity-50"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  disabled={loading}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {fieldErrors.password && (
                <p className="text-sm text-destructive">{fieldErrors.password}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="sr-only">Confirm Password</label>
              <div className="relative">
                <Input
                  ref={confirmPasswordRef}
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Confirm Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, "confirmPassword")}
                  disabled={loading}
                  aria-invalid={!!fieldErrors.confirmPassword}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((p) => !p)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:pointer-events-none disabled:opacity-50"
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  disabled={loading}
                >
                  {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {fieldErrors.confirmPassword && (
                <p className="text-sm text-destructive">{fieldErrors.confirmPassword}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="role" className="sr-only">Role</label>
              <Select value={role} onValueChange={(v) => { setRole(v as "student" | "faculty"); setTimeout(() => departmentRef.current?.focus(), 0); }} disabled={loading}>
                <SelectTrigger id="role" className="w-full" aria-invalid={!!fieldErrors.role}>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="student">Student</SelectItem>
                  <SelectItem value="faculty">Faculty</SelectItem>
                </SelectContent>
              </Select>
              {fieldErrors.role && <p className="text-sm text-destructive">{fieldErrors.role}</p>}
            </div>

            <div className="space-y-2">
              <label htmlFor="department" className="sr-only">Department</label>
              <Input
                ref={departmentRef}
                id="department"
                name="department"
                type="text"
                autoComplete="organization"
                placeholder="Department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, "department")}
                disabled={loading}
                aria-invalid={!!fieldErrors.department}
              />
              {fieldErrors.department && (
                <p className="text-sm text-destructive">{fieldErrors.department}</p>
              )}
            </div>

            {role === "student" && (
              <>
                <div className="space-y-2 transition-all">
                  <label htmlFor="branch" className="sr-only">Branch</label>
                  <Select value={branch} onValueChange={(v) => { setBranch(v as "chem" | "mech"); setTimeout(() => semesterRef.current?.focus(), 0); }} disabled={loading}>
                    <SelectTrigger ref={branchTriggerRef} id="branch" className="w-full" aria-invalid={!!fieldErrors.branch}>
                      <SelectValue placeholder="Select branch" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="chem">Chemistry</SelectItem>
                      <SelectItem value="mech">Mechanical</SelectItem>
                    </SelectContent>
                  </Select>
                  {fieldErrors.branch && <p className="text-sm text-destructive">{fieldErrors.branch}</p>}
                </div>

                <div className="space-y-2 transition-all">
                  <label htmlFor="semester" className="sr-only">Semester</label>
                  <Input
                    ref={semesterRef}
                    id="semester"
                    name="semester"
                    type="number"
                    min={1}
                    max={8}
                    placeholder="Semester (1-8)"
                    value={semester}
                    onChange={(e) => setSemester(e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, "semester")}
                    disabled={loading}
                    aria-invalid={!!fieldErrors.semester}
                  />
                  {fieldErrors.semester && (
                    <p className="text-sm text-destructive">{fieldErrors.semester}</p>
                  )}
                </div>
              </>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                "Create Account"
              )}
            </Button>
          </div>
        </CardContent>

        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
              Sign In
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
