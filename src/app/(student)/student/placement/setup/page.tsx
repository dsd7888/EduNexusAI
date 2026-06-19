"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  PlacementTarget,
  PlacementCompanyProfile,
  TARGET_LABELS,
} from "@/types/placement";

// ─── Constants ────────────────────────────────────────────────────────────────

const TARGET_DESCRIPTIONS: Record<PlacementTarget, string> = {
  service_it:       "TCS, Infosys, Wipro, Cognizant, Capgemini, Accenture",
  product:          "Google, Microsoft, Atlassian, Adobe",
  core_engineering: "L&T, Bosch, Tata Motors, Siemens",
  bfsi:             "HDFC, ICICI, Deloitte, EY, KPMG",
  consulting:       "McKinsey, BCG, ZS Associates, Accenture Strategy",
  startup:          "Early-stage, generalist roles",
};

const TARGETS: PlacementTarget[] = [
  "service_it",
  "product",
  "core_engineering",
  "bfsi",
  "consulting",
  "startup",
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormData {
  cgpa: string;
  active_backlogs: number;
  history_backlogs: number;
  open_to_relocation: boolean;
  primary_target: PlacementTarget;
  dream_companies: string[];
}

const INITIAL_FORM: FormData = {
  cgpa: "",
  active_backlogs: 0,
  history_backlogs: 0,
  open_to_relocation: true,
  primary_target: "service_it",
  dream_companies: [],
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PlacementSetupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <PlacementSetupInner />
    </Suspense>
  );
}

function PlacementSetupInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isEditMode = searchParams.get("edit") === "true";
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [companies, setCompanies] = useState<PlacementCompanyProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const [profileRes, companiesRes] = await Promise.all([
          fetch("/api/placement/profile"),
          fetch("/api/placement/companies"),
        ]);

        const profileData = await profileRes.json();
        if (profileData.profile?.setup_complete && !isEditMode) {
          router.replace("/student/placement");
          return;
        }

        const companiesData = await companiesRes.json();
        setCompanies(companiesData.companies ?? []);
      } catch {
        toast.error("Failed to load setup data");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [router, isEditMode]);

  function update<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function validateStep(): boolean {
    if (step === 1) {
      const cgpa = parseFloat(form.cgpa);
      if (!form.cgpa || isNaN(cgpa) || cgpa < 0 || cgpa > 10) {
        toast.error("Enter a valid CGPA between 0.0 and 10.0");
        return false;
      }
    }
    return true;
  }

  function handleNext() {
    if (!validateStep()) return;
    setStep((s) => s + 1);
  }

  function toggleCompany(slug: string) {
    setForm((prev) => {
      const current = prev.dream_companies;
      if (current.includes(slug)) {
        return { ...prev, dream_companies: current.filter((s) => s !== slug) };
      }
      if (current.length >= 6) {
        toast.warning("Maximum 6 companies can be selected");
        return prev;
      }
      return { ...prev, dream_companies: [...current, slug] };
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/placement/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cgpa: parseFloat(form.cgpa),
          active_backlogs: form.active_backlogs,
          history_backlogs: form.history_backlogs,
          open_to_relocation: form.open_to_relocation,
          primary_target: form.primary_target,
          dream_companies: form.dream_companies,
          setup_complete: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to save profile");
        return;
      }

      router.replace("/student/placement");
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const cgpaNum = parseFloat(form.cgpa) || 0;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Header */}
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Placement Setup</h1>
        <p className="text-sm text-muted-foreground">
          Set up your profile once to unlock all placement features
        </p>
      </div>

      {/* Step Indicator */}
      <StepIndicator current={step} />

      {/* Step Content */}
      <Card>
        <CardContent className="pt-6">
          {step === 1 && <Step1 form={form} update={update} />}
          {step === 2 && (
            <Step2
              selected={form.primary_target}
              onSelect={(t) => update("primary_target", t)}
            />
          )}
          {step === 3 && (
            <Step3
              companies={companies}
              selected={form.dream_companies}
              cgpa={cgpaNum}
              onToggle={toggleCompany}
            />
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => s - 1)}
          disabled={step === 1}
        >
          <ChevronLeft className="size-4 mr-1" />
          Back
        </Button>

        {step < 3 ? (
          <Button onClick={handleNext}>
            Next
            <ChevronRight className="size-4 ml-1" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="min-w-36"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              "Complete Setup"
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Step Indicator ───────────────────────────────────────────────────────────

const STEP_LABELS = ["Academic Profile", "Target & Goals", "Dream Companies"];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const done = current > n;
        const active = current === n;
        return (
          <div key={n} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  "flex size-8 items-center justify-center rounded-full text-sm font-medium transition-colors",
                  done && "bg-emerald-500 text-white",
                  active && !done && "bg-blue-600 text-white",
                  !done && !active && "bg-gray-300 text-gray-600"
                )}
              >
                {done ? <Check className="size-4" /> : n}
              </div>
              <span
                className={cn(
                  "whitespace-nowrap text-xs",
                  active && "font-medium text-blue-600",
                  done && !active && "text-emerald-600",
                  !done && !active && "text-gray-500"
                )}
              >
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div
                className={cn(
                  "mx-3 mb-5 h-px w-14 transition-colors md:w-24",
                  current > n ? "bg-emerald-500" : "bg-gray-200"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Academic Profile ─────────────────────────────────────────────────

function Step1({
  form,
  update,
}: {
  form: FormData;
  update: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Your Academic Profile</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          This helps us match you to eligible companies.
        </p>
      </div>

      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="cgpa">
            CGPA <span className="text-destructive">*</span>
          </Label>
          <Input
            id="cgpa"
            type="number"
            min={0}
            max={10}
            step={0.1}
            placeholder="e.g. 7.5"
            value={form.cgpa}
            onChange={(e) => update("cgpa", e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="active_bl">Active Backlogs</Label>
            <Input
              id="active_bl"
              type="number"
              min={0}
              value={form.active_backlogs}
              onChange={(e) =>
                update("active_backlogs", parseInt(e.target.value) || 0)
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hist_bl">History Backlogs</Label>
            <Input
              id="hist_bl"
              type="number"
              min={0}
              value={form.history_backlogs}
              onChange={(e) =>
                update("history_backlogs", parseInt(e.target.value) || 0)
              }
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border bg-white px-4 py-3">
          <div>
            <p className="text-sm font-medium">Open to Relocation</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Willing to work anywhere in India?
            </p>
          </div>
          <Switch
            checked={form.open_to_relocation}
            onCheckedChange={(v) => update("open_to_relocation", v)}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: Target & Goals ───────────────────────────────────────────────────

function Step2({
  selected,
  onSelect,
}: {
  selected: PlacementTarget;
  onSelect: (t: PlacementTarget) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">What are you targeting?</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Your primary target shapes your readiness scoring.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TARGETS.map((target) => {
          const active = selected === target;
          return (
            <button
              key={target}
              type="button"
              onClick={() => onSelect(target)}
              className={cn(
                "cursor-pointer rounded-xl border p-4 text-left transition-all",
                active
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 bg-white hover:border-blue-300"
              )}
            >
              <p className="font-medium text-gray-900">
                {TARGET_LABELS[target]}
              </p>
              <p className="mt-0.5 text-sm leading-snug text-gray-500">
                {TARGET_DESCRIPTIONS[target]}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step 3: Dream Companies ──────────────────────────────────────────────────

function Step3({
  companies,
  selected,
  cgpa,
  onToggle,
}: {
  companies: PlacementCompanyProfile[];
  selected: string[];
  cgpa: number;
  onToggle: (slug: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Pick your target companies</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Select up to 6 companies you want to track.
          </p>
        </div>
        <span className="mt-1 shrink-0 text-xs text-muted-foreground">
          {selected.length} / 6
        </span>
      </div>

      {selected.length >= 6 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          Maximum 6 companies selected. Deselect one to choose another.
        </p>
      )}

      {companies.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No companies available yet.
        </p>
      ) : (
        <div className="grid max-h-96 grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
          {companies.map((company) => {
            const isSelected = selected.includes(company.slug);
            const belowCgpa =
              company.min_cgpa !== null && cgpa < company.min_cgpa;
            return (
              <button
                key={company.id}
                type="button"
                onClick={() => onToggle(company.slug)}
                className={cn(
                  "cursor-pointer rounded-xl border p-4 text-left transition-all",
                  isSelected
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 bg-white hover:border-blue-300",
                  belowCgpa && "opacity-60"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-tight text-gray-900">
                    {company.name}
                  </p>
                  {company.is_mass_recruiter && (
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      Mass Recruiter
                    </span>
                  )}
                </div>
                {company.min_cgpa !== null && (
                  <p
                    className={cn(
                      "mt-1 text-xs",
                      belowCgpa ? "text-amber-600" : "text-gray-500"
                    )}
                  >
                    Min CGPA: {company.min_cgpa.toFixed(1)}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
