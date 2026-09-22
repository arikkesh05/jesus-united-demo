'use client';

import { useEffect } from 'react';

/**
 * Registers the offline & notification service worker without ever blocking
 * the initial render: registration is deferred until after the window `load`
 * event and an idle callback (setTimeout fallback) so hydration and first
 * paint stay untouched. All navigator access is client-effect-only (SSR-safe)
 * and every failure is a silent no-op — the offline shell is a progressive
 * enhancement, never a hard dependency.
 */
export default function PwaRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    // Service workers require a secure context (https, or localhost in dev).
    if (!window.isSecureContext) return;

    let cancelled = false;

    const register = () => {
      if (cancelled) return;
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Best-effort: an offline-capable shell is enhancement, not requirement.
      });
    };

    const schedule = () => {
      if (cancelled) return;
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(register);
      } else {
        window.setTimeout(register, 200);
      }
    };

    if (document.readyState === 'complete') {
      schedule();
      return () => {
        cancelled = true;
      };
    }

    window.addEventListener('load', schedule, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('load', schedule);
    };
  }, []);

  return null;
}