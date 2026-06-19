import { createAdminClient } from '@/lib/db/supabase-server';
import { requireRole, requireAuth, apiError, apiSuccess } from '@/lib/api/helpers';
import { recomputeOverall } from '@/lib/placement/readiness';
import type { NextRequest } from 'next/server';

export async function GET() {
  try {
    const authResult = await requireRole(['student']);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const adminClient = createAdminClient();
    const { data: profile, error } = await adminClient
      .from('student_placement_profiles')
      .select('*')
      .eq('student_id', user.id)
      .maybeSingle();

    if (error) return apiError('Failed to fetch profile', 500);

    return apiSuccess({ profile: profile ?? null });
  } catch {
    return apiError('Internal server error', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(['student']);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const {
      cgpa,
      active_backlogs,
      history_backlogs,
      primary_target,
      dream_companies,
      open_to_relocation,
      resume_data,
      setup_complete,
    } = body;

    const adminClient = createAdminClient();

    // Fetch existing scores (or default to 0 for first setup)
    const { data: existing } = await adminClient
      .from('student_placement_profiles')
      .select('readiness_aptitude, readiness_verbal, readiness_domain, readiness_coding, readiness_communication, primary_target')
      .eq('student_id', user.id)
      .maybeSingle();

    const mergedProfile = {
      readiness_aptitude:      existing?.readiness_aptitude      ?? 0,
      readiness_verbal:        existing?.readiness_verbal        ?? 0,
      readiness_domain:        existing?.readiness_domain        ?? 0,
      readiness_coding:        existing?.readiness_coding        ?? 0,
      readiness_communication: existing?.readiness_communication ?? 0,
      primary_target:          primary_target ?? existing?.primary_target ?? 'service_it',
    };

    const readiness_overall = recomputeOverall(mergedProfile);

    const upsertPayload = {
      student_id:              user.id,
      readiness_overall,
      ...(cgpa              !== undefined && { cgpa }),
      ...(active_backlogs   !== undefined && { active_backlogs }),
      ...(history_backlogs  !== undefined && { history_backlogs }),
      ...(primary_target    !== undefined && { primary_target }),
      ...(dream_companies   !== undefined && { dream_companies }),
      ...(open_to_relocation !== undefined && { open_to_relocation }),
      ...(resume_data       !== undefined && { resume_data }),
      ...(setup_complete    !== undefined && { setup_complete }),
    };

    const { data: upserted, error } = await adminClient
      .from('student_placement_profiles')
      .upsert(upsertPayload, { onConflict: 'student_id' })
      .select()
      .single();

    if (error) return apiError('Failed to save profile', 500);

    return apiSuccess({ profile: upserted });
  } catch {
    return apiError('Internal server error', 500);
  }
}
