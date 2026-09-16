/**
 * Next.js server instrumentation hook - runs once per server instance, before
 * the first request is handled.
 *
 * This is the only supported place to initialize Sentry on the server: the SDK
 * warns that "an instrumentation file is required for the Sentry SDK to be
 * initialized on the server" and that `sentry.server.config.ts` alone is not
 * enough. The runtime-specific configs are imported lazily so that Node-only
 * and Edge-only code never leak into the wrong bundle.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * Reports errors thrown in Server Components, Route Handlers and middleware
 * (App Router) to Sentry. This is a no-op when no DSN is configured.
 */
export const onRequestError = Sentry.captureRequestError;