'use client';

import dynamic from 'next/dynamic';
import { useReducedMotion } from 'framer-motion';
import { EMBER_GLOW } from './WatchmanScene';

/** Client-only 3D scene: zero SSR markup, zero hydration mismatch. */
const WatchmanScene = dynamic(() => import('./WatchmanScene'), {
  ssr: false,
  loading: () => <WatchmanFallback />,
});

/**
 * Elegant frosted-glass loading skeleton shown until the WebGL scene mounts.
 * Mirrors the pill-surface card language used across the altar modules.
 */
function WatchmanFallback() {
  return (
    <div
      aria-hidden="true"
      className="flex h-full w-full items-center justify-center rounded-[1.75rem] border border-white/10 bg-pill/60 backdrop-blur-xl"
    >
      <span className="h-16 w-16 animate-pulse rounded-full bg-gold/20 shadow-[0_0_32px_rgba(245,158,11,0.25)]" />
    </div>
  );
}

interface AvatarCanvasProps {
  /** Incremented on every "Say Amen" — starts the 800ms ember pulse. */
  amenPulseCount: number;
}

/**
 * Hero-side client gate for the 3D Contemplative Watchman.
 *
 * - `next/dynamic { ssr: false }` keeps every three.js/WebGL symbol out of
 *   the server bundle — the server HTML is a static frosted placeholder, so
 *   hydration is byte-identical (zero mismatch).
 * - Honors `prefers-reduced-motion`: reduced users get a calm, still
 *   silhouette rendered once (`frameloop="demand"` — no RAF loop cost),
 *   while the Amen ember pulse still lights on demand.
 */
export default function AvatarCanvas({ amenPulseCount }: AvatarCanvasProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div
      className="relative h-full w-full"
      style={{
        background: `radial-gradient(ellipse at 50% 62%, ${EMBER_GLOW}, transparent 68%)`,
      }}
    >
      <WatchmanScene
        amenPulseCount={amenPulseCount}
        still={prefersReducedMotion ?? false}
      />
    </div>
  );
}