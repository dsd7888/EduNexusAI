/**
 * Do not import this in client components.
 * For client components, use @/lib/db/supabase-browser.
 */

export {
  createAdminClient,
  createServerClient,
  createServerClientForRequestResponse,
} from "./supabase-server";
