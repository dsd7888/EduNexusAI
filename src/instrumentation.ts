/**
 * Next.js instrumentation hook — the catch-all half of the pilot's error
 * visibility.
 *
 * `logCappedError` (src/lib/api/helpers.ts) covers errors a route CAUGHT and
 * turned into a 500. This covers the ones nothing caught at all: a throw in a
 * server component, a crash before any handler's try block, a render error.
 * Those never reach a route's catch, so without this they exist only in
 * Vercel's runtime log, which nobody reads until after a student complains.
 *
 * One file, zero per-route churn — `onRequestError` fires for every server-side
 * request error in the app.
 */

export async function register(): Promise<void> {
  // Nothing to bootstrap. The hook below is the whole point of this file, but
  // Next.js only loads the module when `register` is exported.
}

export async function onRequestError(
  err: unknown,
  request: {
    path?: string;
    method?: string;
    headers?: Record<string, string | undefined>;
  },
  context: {
    routerKind?: string;
    routePath?: string;
    routeType?: string;
  }
): Promise<void> {
  // Node-runtime only. The edge runtime has no service-role DB access here, and
  // importing the admin client there would break the build.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    // Imported lazily so the edge bundle never pulls in the admin client.
    const { persistAppError } = await import("@/lib/api/helpers");

    const message = err instanceof Error ? err.message : String(err);

    persistAppError({
      scope: `[unhandled] ${context.routePath ?? request.path ?? "unknown"}`,
      route: request.path ?? context.routePath,
      httpMethod: request.method,
      message: message.slice(0, 500),
      stack: err instanceof Error ? err.stack : undefined,
      origin: "unhandled",
      metadata: {
        routerKind: context.routerKind ?? null,
        routeType: context.routeType ?? null,
      },
    });
  } catch (hookErr) {
    // Never let the reporting hook itself surface — it would replace a useful
    // stack trace with a useless one.
    console.error("[instrumentation] onRequestError failed:", hookErr);
  }
}
