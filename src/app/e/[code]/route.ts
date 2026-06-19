import { createAdminClient } from "@/lib/db/supabase-server";
import { fetchExplainerHtml } from "@/lib/explainer/storage";

// Public route — explainers are shareable with students, no auth required
// (proxy.ts lets /e/* through). We stream the stored HTML directly so opening
// /e/abc12345 plays the explainer immediately (no redirect, no React page).

function notFoundHtml(message: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Explainer not found</title>
<style>
  html,body{height:100%;margin:0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0b1020;color:#f8fafc}
  .wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px}
  h1{font-size:clamp(20px,4vw,28px);margin:0}
  p{color:#94a3b8;margin:0;max-width:36ch;line-height:1.5}
</style></head>
<body><div class="wrap"><h1>Explainer not found</h1><p>${message}</p></div></body></html>`;
  return new Response(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ code: string }> }
) {
  const { code } = await ctx.params;

  if (!code || !/^[a-z0-9]{4,16}$/.test(code)) {
    return notFoundHtml("This link doesn't look like a valid explainer.");
  }

  const admin = createAdminClient();

  const { data: row, error } = await admin
    .from("explainers")
    .select("storage_path")
    .eq("short_code", code)
    .maybeSingle();

  if (error || !row) {
    return notFoundHtml("This explainer may have been removed or never existed.");
  }

  const storagePath = (row as { storage_path: string }).storage_path;
  const html = await fetchExplainerHtml(admin, storagePath);

  if (html == null) {
    return notFoundHtml("We couldn't load this explainer right now.");
  }

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
