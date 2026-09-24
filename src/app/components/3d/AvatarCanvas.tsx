"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Frosted-glass loading skeleton — byte-identical on the server and the first
 * client render, mirroring the pill-surface language of the altar modules.
 */
function AvatarSkeleton() {
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
  /** Incremented on every "Say Amen" — starts the 800ms amber rim surge. */
  amenPulseCount: number;
}

/**
 * The Three.js viewport is a client-only concern: it needs a WebGL context, a window
 * measurement and a 2.1 MB GLB — none of which exist at prerender time. `ssr: false`
 * keeps the react-three-fiber / drei / three bundle out of the server render and off the
 * initial payload, and every pre-canvas render — the server pass, the first client pass
 * during hydration, and this component's `loading` placeholder while the chunk streams in —
 * goes through the single `AvatarSkeleton` below: three identical trees, nothing to
 * mismatch. (`tests/avatarCanvasSsr.test.mjs` pins that markup contract.)
 */
const WatchmanScene = dynamic(() => import("./WatchmanScene"), {
  ssr: false,
  loading: () => <AvatarSkeleton />,
});

/**
 * Hero-side client gate for the Watchman figurine viewport — the real
 * `/models/watchman.glb`, rendered in WebGL with react-three-fiber + drei.
 *
 * Reliability layers:
 * 1. `mounted` guard — the canvas is created only after hydration and the first paint,
 *    so shader compilation and mesh decoding can never delay the hero's first paint,
 *    and the render loop never races the framer-motion tree.
 * 2. `prefers-reduced-motion` — forwarded to the scene, which stops the auto-orbit and holds
 *    the figure in its idle stance with no gestures (no wave, no thumbs up) while the Amen
 *    acknowledgement still answers in light.
 */
export default function AvatarCanvas({ amenPulseCount }: AvatarCanvasProps) {
  const [mounted, setMounted] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    // Deferred to the next frame: guarantees the effect fires after the first paint AND
    // keeps the synchronous `set-state-in-effect` lint rule satisfied (state is set from
    // an async frame callback, not the effect body).
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!mounted) {
    return <AvatarSkeleton />;
  }

  return (
    <WatchmanScene
      amenPulseCount={amenPulseCount}
      reducedMotion={prefersReducedMotion ?? false}
    />
  );
}
