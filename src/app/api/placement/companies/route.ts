import { createAdminClient } from '@/lib/db/supabase-server';
import { requireAuth, apiError, apiSuccess } from '@/lib/api/helpers';

export async function GET() {
  try {
    const authResult = await requireAuth();
    if (authResult instanceof Response) return authResult;

    const adminClient = createAdminClient();
    const today = new Date().toISOString().slice(0, 10);

    const [{ data: companies, error: companiesError }, { data: drives, error: drivesError }] =
      await Promise.all([
        adminClient
          .from('placement_company_profiles')
          .select('*')
          .eq('is_active', true)
          .order('display_order', { ascending: true }),
        adminClient
          .from('placement_drives')
          .select('*, company:placement_company_profiles(*)')
          .eq('is_active', true)
          .gte('drive_date', today)
          .order('drive_date', { ascending: true }),
      ]);

    if (companiesError) return apiError('Failed to fetch companies', 500);
    if (drivesError)   return apiError('Failed to fetch drives', 500);

    return apiSuccess({ companies: companies ?? [], drives: drives ?? [] });
  } catch {
    return apiError('Internal server error', 500);
  }
}
