'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group, Mesh, PointLight } from 'three';

/** Palette C tokens (mirrors `--color-*` in src/app/globals.css). */
const PALETTE = {
  canvas: '#0A1118', // deep royal lapis
  pill: '#101D2B', // frosted maritime glass — robe/cowl base
  gold: '#F59E0B', // living ember — rim light + core glow
  goldDeep: '#FBBF24', // ember hover lift — Amen pulse peak
  espresso: '#F8FAFC', // crisp alabaster — clay key light
} as const;

/** Amen resonance envelope duration (task: ~800 ms). */
const AMEN_PULSE_SECONDS = 0.8;

/** Head-tracking smoothing per frame (higher = snappier, still damped). */
const HEAD_TRACK_LERP = 0.08;

/** Idle sway amplitude (radians) — a slow contemplative breath. */
const IDLE_SWAY_AMPLITUDE = 0.05;
const IDLE_SWAY_PERIOD = 5.5;

interface WatchmanModelProps {
  /**
   * Incremented on every "Say Amen". Changing props re-render the scene (so
   * the pulse starts even under `frameloop="demand"`), and the model stamps
   * its own clock time on the change — no external ref plumbing needed.
   */
  amenPulseCount: number;
  /** Reduced-motion mode: no pointer tracking, no idle sway; Amen still glows. */
  still?: boolean;
}

/**
 * Stylized low-poly "Contemplative Watchman" — a clay-like figure keeping
 * watch over the Daily Bread anchor. Built from smooth primitives: tapered
 * robe, cowl-framed head, gold trim, and an interior amber core that pulses
 * for 800ms when the believer offers an Amen.
 */
export default function WatchmanModel({
  amenPulseCount,
  still = false,
}: WatchmanModelProps) {
  const headRef = useRef<Group>(null);
  const bodyRef = useRef<Group>(null);
  const coreMeshRef = useRef<Mesh>(null);
  const coreLightRef = useRef<PointLight>(null);
  /** Clock time (s) the current/last Amen pulse began; -Infinity = never. */
  const pulseStartRef = useRef(-Infinity);
  /** Amen count observed but not yet stamped against the scene clock. */
  const pendingPulseRef = useRef(0);

  // Stamp the pulse on prop change; the envelope itself is driven in useFrame
  // so reduced-motion (demand frameloop) users still see the ember light.
  useEffect(() => {
    if (amenPulseCount > 0) {
      pendingPulseRef.current = amenPulseCount;
    }
  }, [amenPulseCount]);

  useFrame((state) => {
    const elapsed = state.clock.elapsedTime;

    if (pendingPulseRef.current !== 0) {
      pulseStartRef.current = elapsed;
      pendingPulseRef.current = 0;
    }

    // Damped head tracking: gentle yaw + pitch toward the pointer.
    if (!still && headRef.current) {
      const pointer = state.pointer; // -1..1, pre-smoothed by R3F
      const head = headRef.current;
      const targetYaw = pointer.x * 0.45;
      const targetPitch = -pointer.y * 0.22;
      head.rotation.y += (targetYaw - head.rotation.y) * HEAD_TRACK_LERP;
      head.rotation.x += (targetPitch - head.rotation.x) * HEAD_TRACK_LERP;
      // Subtle meditative tilt so the watchman never looks rigid.
      const tilt = Math.sin(elapsed / IDLE_SWAY_PERIOD) * IDLE_SWAY_AMPLITUDE;
      head.rotation.z += (tilt - head.rotation.z) * HEAD_TRACK_LERP;
    }

    // Idle body sway: the whole figure breathes slowly.
    if (!still && bodyRef.current) {
      bodyRef.current.rotation.y =
        Math.sin(elapsed / (IDLE_SWAY_PERIOD * 1.6)) * 0.02;
      bodyRef.current.position.y = Math.sin(elapsed / 3.2) * 0.02;
    }

    // Amen resonance: 800ms ember pulse from the interior core.
    const since = elapsed - pulseStartRef.current;
    const envelope =
      since >= 0 && since <= AMEN_PULSE_SECONDS
        ? Math.sin((since / AMEN_PULSE_SECONDS) * Math.PI)
        : 0;

    if (coreMeshRef.current) {
      coreMeshRef.current.scale.setScalar(1 + envelope * 0.35);
      const material = coreMeshRef.current.material;
      if (!Array.isArray(material) && 'emissiveIntensity' in material) {
        material.emissiveIntensity = 1.4 + envelope * 2.6;
      }
    }
    if (coreLightRef.current) {
      coreLightRef.current.intensity = 1.2 + envelope * 6.5;
    }

    // While the pulse is alive, keep the frame loop fed so reduced-motion
    // (demand frameloop) users see the full 800ms ember bloom.
    if (envelope > 0 && envelope < 1) {
      state.invalidate();
    }
  });

  return (
    <group>
      {/* Lighting: lapis ambient fill, alabaster key, ember rim (Palette C). */}
      <ambientLight intensity={0.5} color={PALETTE.canvas} />
      <directionalLight position={[3, 5, 4]} intensity={1.15} color={PALETTE.espresso} />
      <directionalLight position={[-4, 2.5, -3.5]} intensity={2.0} color={PALETTE.gold} />

      <group ref={bodyRef}>
        {/* Robe: smooth tapered capsule — matte midnight-slate clay. */}
        <mesh position={[0, 0.1, 0]} castShadow>
          <capsuleGeometry args={[0.52, 0.85, 12, 32]} />
          <meshStandardMaterial color={PALETTE.pill} roughness={0.82} metalness={0.08} />
        </mesh>

        {/* Shoulder mantle: capping disc. */}
        <mesh position={[0, 0.78, 0]} castShadow>
          <cylinderGeometry args={[0.5, 0.62, 0.22, 32]} />
          <meshStandardMaterial color={PALETTE.pill} roughness={0.85} metalness={0.06} />
        </mesh>

        {/* Gold shoulder trim: specular ember edge highlight. */}
        <mesh position={[0, 0.9, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.56, 0.035, 16, 48]} />
          <meshStandardMaterial
            color={PALETTE.gold}
            emissive={PALETTE.gold}
            emissiveIntensity={0.35}
            roughness={0.32}
            metalness={0.85}
          />
        </mesh>

        {/* Head group — damped pointer-tracking target. */}
        <group ref={headRef} position={[0, 1.28, 0]}>
          {/* Head: smooth clay sphere. */}
          <mesh castShadow>
            <sphereGeometry args={[0.3, 40, 40]} />
            <meshStandardMaterial color={PALETTE.pill} roughness={0.78} metalness={0.05} />
          </mesh>
          {/* Cowl: ring framing the face. */}
          <mesh position={[0, 0.06, -0.06]} rotation={[-0.28, 0, 0]}>
            <torusGeometry args={[0.32, 0.075, 20, 48]} />
            <meshStandardMaterial color={PALETTE.pill} roughness={0.88} metalness={0.05} />
          </mesh>
          {/* Specular gold cowl edge. */}
          <mesh position={[0, 0.06, -0.06]} rotation={[-0.28, 0, 0]}>
            <torusGeometry args={[0.395, 0.022, 12, 48]} />
            <meshStandardMaterial
              color={PALETTE.gold}
              emissive={PALETTE.gold}
              emissiveIntensity={0.3}
              roughness={0.32}
              metalness={0.85}
            />
          </mesh>
        </group>

        {/* Interior amber core: glows through the robe during Amen pulses. */}
        <mesh ref={coreMeshRef} position={[0, 0.62, 0.3]}>
          <sphereGeometry args={[0.16, 24, 24]} />
          <meshStandardMaterial
            color={PALETTE.gold}
            emissive={PALETTE.gold}
            emissiveIntensity={1.4}
          />
        </mesh>
        <pointLight
          ref={coreLightRef}
          position={[0, 0.62, 0.55]}
          intensity={1.2}
          distance={5}
          decay={2}
          color={PALETTE.goldDeep}
        />
      </group>
    </group>
  );
}