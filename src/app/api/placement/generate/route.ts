import { routeAI } from "@/lib/ai/router";
import { createAdminClient, createServerClient } from "@/lib/db/supabase-server";
import { buildPlacementTestPrompt, cleanQuestions } from "@/lib/placement/generator";
import type { NextRequest } from "next/server";

function parsePlacementQuestions(raw: string): any[] | null {
  // Attempt 1: direct parse after cleaning fences
  try {
    const clean = raw
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/gi, "")
      .trim();
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed) && parsed.length >= 3) return cleanQuestions(parsed);
  } catch {}

  // Attempt 2: extract JSON array between first [ and last ]
  try {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) {
      const slice = raw.slice(start, end + 1);
      const parsed = JSON.parse(slice);
      if (Array.isArray(parsed) && parsed.length >= 3) return cleanQuestions(parsed);
    }
  } catch {}

  // Attempt 3: fix common trailing comma issues then parse
  try {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start !== -1 && end !== -1) {
      const slice = raw
        .slice(start, end + 1)
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]");
      const parsed = JSON.parse(slice);
      if (Array.isArray(parsed) && parsed.length >= 3) return cleanQuestions(parsed);
    }
  } catch {}

  // Attempt 4: truncation recovery — salvage complete objects
  try {
    const start = raw.indexOf("[");
    if (start !== -1) {
      const slice = raw.slice(start);
      const objects: any[] = [];
      let depth = 0;
      let objStart = -1;
      for (let i = 0; i < slice.length; i++) {
        if (slice[i] === "{") {
          if (depth === 0) objStart = i;
          depth++;
        } else if (slice[i] === "}") {
          depth--;
          if (depth === 0 && objStart !== -1) {
            try {
              const obj = JSON.parse(slice.slice(objStart, i + 1));
              if (obj.question && obj.answer) objects.push(obj);
            } catch {}
            objStart = -1;
          }
        }
      }
      if (objects.length >= 3) return cleanQuestions(objects);
    }
  } catch {}

  return null;
}

function getBranchFallbackSyllabus(branch: string): string {
  const fallbacks: Record<string, string> = {
    Mechanical:
      "Thermodynamics (laws, cycles, heat transfer), Fluid Mechanics (Bernoulli, flow types), Strength of Materials (stress, strain, beams), Manufacturing Processes, Engineering Mechanics (statics, dynamics)",
    Chemical:
      "Chemical Reaction Engineering, Mass Transfer, Heat Transfer, Thermodynamics, Process Control, Fluid Mechanics, Material and Energy Balances",
    "Computer Science":
      "Data Structures (arrays, trees, graphs), Algorithms (sorting, searching, complexity), Operating Systems, DBMS, Computer Networks, Object-Oriented Programming",
    Electronics:
      "Electronic Devices, Digital Logic, Signals and Systems, Control Systems, Communication Systems, Microprocessors",
    Electrical:
      "Circuit Analysis, Electrical Machines, Power Systems, Control Systems, Signals and Systems, Electromagnetic Theory",
    Civil:
      "Structural Analysis, Concrete Structures, Soil Mechanics, Fluid Mechanics, Transportation Engineering, Environmental Engineering",
    "Information Technology":
      "Data Structures, Algorithms, Database Management, Computer Networks, Software Engineering, Web Technologies",
  };
  return (
    fallbacks[branch] ??
    "Engineering Mathematics, Engineering Physics, Basic Electronics, Programming Fundamentals, Engineering Drawing"
  );
}

async function generateWithRetry(
  prompt: string,
  maxAttempts = 3
): Promise<any[] | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[placement/generate] Attempt ${attempt}/${maxAttempts}`);
      const result = await routeAI("placement_gen", {
        messages: [{ role: "user", content: prompt }],
      });
      const raw = String(result.content ?? "");

      // Check for refusal (short response, no JSON array)
      if (raw.length < 200 || !raw.includes("{")) {
        console.warn(
          `[placement/generate] Refusal detected on attempt ${attempt}`
        );
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        return null;
      }

      const questions = parsePlacementQuestions(raw);
      if (questions) {
        console.log(
          `[placement/generate] Success on attempt ${attempt}. Questions: ${questions.length}`
        );
        return questions;
      }

      console.warn(`[placement/generate] Parse failed on attempt ${attempt}`);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (err) {
      console.error(`[placement/generate] Error on attempt ${attempt}:`, err);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Auth check — student only
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: roleProfile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if ((roleProfile as { role?: string } | null)?.role !== "student") {
      return Response.json(
        { error: "Forbidden: Students only" },
        { status: 403 }
      );
    }

    // 2. Parse body
    const { companyId } = await request.json();
    if (!companyId) {
      return Response.json({ error: "companyId is required" }, { status: 400 });
    }

    // 3. Fetch company
    const { data: company } = await adminClient
      .from("placement_companies")
      .select("id, name, branches, aptitude_pattern, difficulty")
      .eq("id", companyId)
      .single();

    if (!company) {
      return Response.json({ error: "Company not found" }, { status: 404 });
    }

    // 4. Fetch student profile
    const { data: profile } = await adminClient
      .from("profiles")
      .select("branch, semester")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return Response.json({ error: "Profile not found" }, { status: 404 });
    }

    // 5. Branch match check (allow mismatch)
    const companyBranches = Array.isArray((company as any).branches)
      ? ((company as any).branches as string[])
      : [];
    const studentBranch = (profile as any).branch ?? "Engineering";
    if (!companyBranches.includes(studentBranch)) {
      // Intentionally allowed; using student's branch for technical generation
    }

    // 6. Fetch syllabus content for student's branch and combine
    const { data: subjects } = await adminClient
      .from("subjects")
      .select("id")
      .eq("branch", studentBranch);
    const subjectIds = (subjects ?? []).map((s: any) => s.id);

    let combinedSyllabus = "";
    if (subjectIds.length > 0) {
      const { data: rows } = await adminClient
        .from("subject_content")
        .select("content")
        .in("subject_id", subjectIds);

      combinedSyllabus = (rows ?? [])
        .map((r: any) => r.content)
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 4000);
    }
    // If syllabus is too sparse, use branch-generic technical topics
    const syllabusForPrompt =
      combinedSyllabus.length > 100
        ? combinedSyllabus
        : getBranchFallbackSyllabus(studentBranch ?? "Engineering");

    // Build single prompt for all 30 questions
    const prompt = buildPlacementTestPrompt({
      companyName: (company as any).name,
      branch: profile.branch ?? "Engineering",
      aptitudePattern: (company as any).aptitude_pattern,
      syllabusContent: syllabusForPrompt,
      difficulty: (company as any).difficulty,
      totalQuestions: 30,
    });

    console.log("[placement/generate] Generating 30 questions with Pro...");
    const questions = await generateWithRetry(prompt, 2); // 2 retries max

    if (!questions || questions.length < 10) {
      console.error(
        `[placement/generate] Failed: got ${questions?.length ?? 0} questions`
      );
      return Response.json(
        { error: "Failed to generate test. Please try again." },
        { status: 500 }
      );
    }

    if (questions.length < 28) {
      console.warn(`[placement/generate] Partial: ${questions.length} questions`);
    }

    console.log(`[placement/generate] Done: ${questions.length} questions`);

    // 10. Track usage analytics
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data: existingUsage } = await adminClient
        .from("usage_analytics")
        .select("id, event_count")
        .eq("date", today)
        .eq("user_id", user.id)
        .eq("event_type", "placement_test")
        .maybeSingle();

      if (existingUsage) {
        await adminClient
          .from("usage_analytics")
          .update({
            event_count: (existingUsage.event_count ?? 0) + 1,
          })
          .eq("id", existingUsage.id);
      } else {
        await adminClient.from("usage_analytics").insert({
          date: today,
          user_id: user.id,
          subject_id: null,
          event_type: "placement_test",
          event_count: 1,
        });
      }
    } catch (err) {
      console.error("[placement/generate] usage_analytics error:", err);
    }

    return Response.json({
      questions,
      companyName: (company as any).name as string,
    });
  } catch (err) {
    console.error("[placement/generate] error:", err);
    return Response.json({ error: "Failed to generate test" }, { status: 500 });
  }
}

