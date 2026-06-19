import { createAdminClient } from '@/lib/db/supabase-server';
import { requireAuth, apiError, apiSuccess } from '@/lib/api/helpers';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (authResult instanceof Response) return authResult;

    const { slug } = await params;
    const adminClient = createAdminClient();
    const today = new Date().toISOString().slice(0, 10);

    const { data: company, error: companyError } = await adminClient
      .from('placement_company_profiles')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();

    if (companyError) return apiError('Failed to fetch company', 500);
    if (!company)     return apiError('Company not found', 404);

    const { data: drives, error: drivesError } = await adminClient
      .from('placement_drives')
      .select('*')
      .eq('company_id', company.id)
      .eq('is_active', true)
      .gte('drive_date', today)
      .order('drive_date', { ascending: true });

    if (drivesError) return apiError('Failed to fetch drives', 500);

    return apiSuccess({ company, drives: drives ?? [] });
  } catch {
    return apiError('Internal server error', 500);
  }
}
