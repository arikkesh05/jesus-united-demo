import type { NextConfig } from "next";
// Imported from the `@sentry/nextjs/config` subpath: re-exporting
// `withSentryConfig` from the `@sentry/nextjs` root logs a deprecation warning
// and is removed in SDK v11.
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  // Only print Sentry build logs in CI; local builds stay quiet.
  silent: !process.env.CI,

  // Include Next.js internals and dependency code in the source map upload so
  // production stack traces resolve beyond first-party frames.
  widenClientFileUpload: true,

  // v10 replacement for the removed `hideSourceMaps: true` option: generated
  // source maps are deleted after being uploaded and their `sourceMappingURL`
  // comments are stripped, so they are never served in production.
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },

  // v10 replacement for the deprecated `disableLogger: true` option.
  // Webpack-only, therefore a no-op under Turbopack (Next 16's default bundler).
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
