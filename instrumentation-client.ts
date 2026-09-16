/**
 * Next.js client instrumentation hook - runs once on the client before hydration.
 *
 * The Sentry SDK only picks up `sentry.client.config.ts` during a **webpack**
 * build. Next.js 16 builds with Turbopack by default (and the SDK logs
 * "[@sentry/nextjs] When using Turbopack `sentry.client.config.ts` will no
 * longer work"), so the client SDK is initialized here instead.
 *
 * `sentry.client.config.ts` stays the single source of truth for client
 * initialization; this module just makes sure it is evaluated. Both bundlers
 * evaluate the imported module exactly once, so `Sentry.init` can never run
 * twice in the same client bundle.
 */
import "./sentry.client.config";

import * as Sentry from "@sentry/nextjs";

/**
 * Enables Sentry instrumentation for App Router client-side navigations.
 * The SDK expects this hook whenever an `instrumentation-client` file exists
 * and warns during the build when it is missing.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;