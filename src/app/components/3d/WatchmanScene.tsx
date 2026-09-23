'use client';

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import WatchmanModel from './WatchmanModel';

/** Palette C token mirror. */
const EMBER_GLOW = 'rgba(245, 158, 11, 0.16)';

interface WatchmanSceneProps {
  /** Incremented on every "Say Amen" — starts the 800ms ember pulse. */
  amenPulseCount: number;
  /**
   * Reduced-motion mode: render one calm, still frame (`frameloop="demand"`,
   * no idle sway, no pointer tracking). The Amen ember pulse still lights.
   */
  still?: boolean;
}

/**
 * R3F scene staging the Watchman: continuous loop clamped to `dpr={[1, 1.5]}`
 * for mobile battery efficiency, low-power GPU hint, and a lapis-fogged
 * camera framing the figure in quiet contemplation. Reduced-motion users
 * get a single still frame instead of an animated loop.
 */
export default function WatchmanScene({
  amenPulseCount,
  still = false,
}: WatchmanSceneProps) {
  return (
    <Canvas
      camera={{ position: [0, 1.35, 3.4], fov: 42 }}
      dpr={[1, 1.5]}
      frameloop={still ? 'demand' : 'always'}
      gl={{ antialias: true, powerPreference: 'low-power' }}
      style={{ background: 'transparent' }}
    >
      <fog attach="fog" args={['#0A1118', 4.5, 9]} />
      <Suspense fallback={null}>
        <WatchmanModel amenPulseCount={amenPulseCount} still={still} />
      </Suspense>
    </Canvas>
  );
}

/** Re-exported for the frosted fallback tint in AvatarCanvas. */
export { EMBER_GLOW };