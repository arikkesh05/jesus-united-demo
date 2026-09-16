import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Next.js 16 Proxy (successor of the deprecated `middleware` file convention —
 * identical responsibilities, renamed by the framework). It refreshes the
 * Supabase auth session on every matched incoming request so Server Components
 * and Route Handlers always read a valid access token, and rotated session
 * cookies are persisted back to the browser on the way out.
 */
export async function proxy(request: NextRequest) {
  // Env-gated (same philosophy as the DSN-gated Sentry init): without Supabase
  // credentials the proxy is a pass-through, so local/CI builds stay healthy.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.next();
  }

  // Start from an unmodified response; any rotated cookies are replayed onto it.
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  /**
   * `getUser()` re-validates the JWT against the Supabase auth server and
   * transparently refreshes an expired session when possible. Never replace
   * this with `getSession()`/`getClaims()` here: those read the cookie payload
   * without server-side verification and can be forged client-side.
   */
  try {
    await supabase.auth.getUser();
  } catch (error) {
    // An auth-server outage must never block page loads; the request simply
    // continues with the existing cookie state and the app renders as a guest.
    console.error('Supabase session refresh failed:', error);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Run on every route except static assets:
     * - `_next/static` and `_next/image` (build chunks + image optimizer)
     * - `favicon.ico`
     * - image, audio, and webfont file extensions
     */
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|mp3|ogg|wav|woff|woff2)$).*)',
  ],
};
