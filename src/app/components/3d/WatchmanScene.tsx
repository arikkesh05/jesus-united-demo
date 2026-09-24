"use client";

import { Component, Suspense, useRef, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import {
  CAMERA_FOV,
  CAMERA_POSITION,
  FIGURINE_GROUND_Y,
  ORBIT_MAX_POLAR_ANGLE,
  ORBIT_MIN_POLAR_ANGLE,
  ORBIT_TARGET,
  PEDESTAL_CENTER_Y,
  PEDESTAL_RADIUS,
  PEDESTAL_RING_TUBE,
  PEDESTAL_RING_Y,
  PEDESTAL_THICKNESS,
  RIM_BASE_INTENSITY,
  amenFlare,
  amenProgress,
} from "@/lib/watchmanStage";
import WatchmanModel from "./WatchmanModel";

/**
 * Studio rig (spec): a strong ambient lift over the lapis canvas, a warm key from the upper
 * right, a cool fill from the left, and an amber rim/backlight that separates the figure from
 * the dark stage. The asset ships authored PBR materials and NORMAL data (see WatchmanModel), so
 * every light in here contributes real shading — nothing in the rig compensates for the mesh.
 *
 * Shadow maps stay off deliberately: the grounding shadow is the pedestal's `<ContactShadows>`
 * pool — contact-accurate, 512² — and a directional map would fight a *skinned* rig (its bones
 * move the caster between the depth pass and the light every frame) while adding a second,
 * longer shadow competing with the contact-accurate pool.
 */
const AMBIENT_INTENSITY = 1.8;
const KEY_INTENSITY = 2.8;
const KEY_COLOR = "#FFF5E6";
const FILL_INTENSITY = 1.4;
const FILL_COLOR = "#B4D7FF";

/** Palette C tokens (`src/app/globals.css`): gold `--color-gold`, pill `--color-pill`. */
const GOLD = "#F59E0B";
const ACRYLIC_TINT = "#101D2B";

/** 60% IBL: enough city-lit sheen to keep the figure's matte panels alive, never a second key. */
const ENVIRONMENT_INTENSITY = 0.6;

/** Pedestal flare (spec): the point light inside the slab reaches 6.0 for the 800ms after an Amen. */
const PEDESTAL_FLARE_INTENSITY = 6.0;

/**
 * Bounded reach, so the flare glows the pedestal's own rim and the hems hanging above it instead
 * of washing the studio rig.
 */
const PEDESTAL_FLARE_RANGE = 2.6;

/**
 * The acrylic is lit from inside: a whisper of ember at rest, a full glow while an Amen lands.
 * The emissives, not the light, carry the answer a camera can see — the point light sits *inside*
 * the slab (spec), two centimetres under the soles, where it can only reach surfaces whose normals
 * point down: the robe's underside, the sheep's belly, the acrylic's interior.
 */
const PEDESTAL_EMISSIVE_BASE = 0.08;
const PEDESTAL_EMISSIVE_FLARE = 0.85;

/** The halo ring is the flare's visible half: it brightens where the light itself cannot be seen. */
const RING_EMISSIVE_BASE = 1.4;
const RING_EMISSIVE_FLARE = 1.8;

/**
 * Browsers can refuse a WebGL context (hardened policy, driver blocklist, headless VM).
 * R3F's `fallback` prop only renders *inside* the `<canvas>` element, which is invisible in
 * every browser that supports canvas — so the check has to happen before the Canvas mounts,
 * or the hero silently becomes a 380px void with an unhandled context-creation rejection.
 *
 * Detected at module scope: this chunk is client-only (`ssr: false`), so it evaluates once
 * in the browser — outside render, with no state, and stable for the page's lifetime.
 */
const WEBGL_SUPPORTED = hasWebGLSupport();

function hasWebGLSupport(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
  } catch {
    // Hardened browsers throw instead of returning null; both answers mean "no WebGL".
    return false;
  }
}

/**
 * The figurine is a local asset and always loads; the `city` HDRI is fetched from
 * drei's asset CDN at runtime (raw.githack.com, which has been observed answering 403).
 * An IBL is a finishing touch, not a load-bearing one here, so it gets its own error
 * boundary + suspense: a failed or slow fetch silently degrades to the four studio
 * lights instead of taking the hero down with it.
 */
class EnvironmentBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

interface WatchmanSceneProps {
  /** Bumped on every "Say Amen" — drives the amber rim surge on the figurine. */
  amenPulseCount: number;
  /** Honours `prefers-reduced-motion`: no auto-orbit, the figurine holds still, Amens still answer. */
  reducedMotion?: boolean;
}

export default function WatchmanScene({
  amenPulseCount,
  reducedMotion = false,
}: WatchmanSceneProps) {
  /** Owned here alongside the rest of the studio rig, driven by the figurine's Amen surge. */
  const rimLightRef = useRef<THREE.DirectionalLight>(null);

  if (!WEBGL_SUPPORTED) {
    // Quiet, on-brand degradation: a factual line in the hero's own type scale, rather than
    // a blank 380px stage the visitor cannot interpret. (Not exposed to assistive tech —
    // the hero container is `role="img"`, whose children are presentational by definition.)
    return (
      <p className="flex h-full w-full items-center justify-center px-6 text-center text-xs font-medium leading-relaxed text-pill-ink/70">
        The 3D figurine needs WebGL, which this browser has switched off.
      </p>
    );
  }

  /*
   * `[touch-action:pan-y_pinch-zoom]!` — the important flag is load-bearing. three's
   * OrbitControls writes `touch-action: none` *inline* onto this same element (it is R3F's event
   * source, and therefore the controller's dom element), and only an `!important` author rule
   * outranks an inline style. Without the override the hero — 340px wide, the full width of a
   * phone — is a scroll trap: a vertical swipe would turn the figurine instead of scrolling the
   * page. Horizontal drags still reach the controller, and r186's OrbitControls ends its gesture
   * on `pointercancel` (the event a scroll-claim dispatches), so it can never be stranded.
   */
  return (
    <Canvas
      dpr={[1, 1.5]}
      className="watchman-stage"
      camera={{
        position: CAMERA_POSITION,
        fov: CAMERA_FOV,
        near: 0.1,
        far: 40,
      }}
      gl={{
        antialias: true,
        alpha: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.35,
      }}
    >
      <ambientLight intensity={AMBIENT_INTENSITY} />

      {/* Warm key from the upper right. No shadow map: the pedestal's contact-shadow pool is the
          grounding shadow on this stage (see the rig note above). */}
      <directionalLight
        position={[3, 5, 4]}
        intensity={KEY_INTENSITY}
        color={KEY_COLOR}
      />

      {/* Cool fill from the left — keeps the shadow side from collapsing into mud. */}
      <directionalLight
        position={[-3, 2, 2]}
        intensity={FILL_INTENSITY}
        color={FILL_COLOR}
      />

      {/* Amber rim/backlight — surges to 6.0 for 800ms on every Amen (see WatchmanModel). */}
      <directionalLight
        ref={rimLightRef}
        position={[0, 4, -4]}
        intensity={RIM_BASE_INTENSITY}
        color={GOLD}
      />

      {/* The stage owns the ground: the acrylic slab the figurine stands on, its gold halo, its
          inner ember core, and the contact-shadow pool that welds the soles to it. */}
      <Pedestal amenPulseCount={amenPulseCount} />

      {/* The figurine is a local asset: it suspends on its own so the lights and the
          backdrop are never held hostage by the mesh decode. */}
      <Suspense fallback={null}>
        <WatchmanModel
          amenPulseCount={amenPulseCount}
          reducedMotion={reducedMotion}
          rimLightRef={rimLightRef}
        />
      </Suspense>

      {/* Real 360° orbit. Zoom and pan are off (spec) — which also turns the polar clamps into a
          framing guarantee rather than a hope: the camera can only travel a fixed-radius arc
          inside them, and `watchmanStage.test.mjs` proves the composition stays inside the
          frustum at both ends: the composed crown and the pedestal's rim. `autoRotate` turns the
          stage slowly while nobody is dragging: three's controller only rotates in its NONE
          state, so a drag pauses it natively, and reduced motion switches it off entirely. */}
      <OrbitControls
        target={ORBIT_TARGET}
        enableZoom={false}
        enablePan={false}
        enableDamping
        dampingFactor={0.06}
        minPolarAngle={ORBIT_MIN_POLAR_ANGLE}
        maxPolarAngle={ORBIT_MAX_POLAR_ANGLE}
        autoRotate={!reducedMotion}
        autoRotateSpeed={1}
      />

      <EnvironmentBoundary>
        <Suspense fallback={null}>
          <Environment
            preset="city"
            environmentIntensity={ENVIRONMENT_INTENSITY}
          />
        </Suspense>
      </EnvironmentBoundary>
    </Canvas>
  );
}

interface PedestalProps {
  /** Bumped on every "Say Amen" — starts the slab's 800ms flare. */
  amenPulseCount: number;
}

/**
 * The acrylic pedestal: slab, halo ring, ember core, and the spec'd contact-shadow pool.
 *
 * All of it is stage furniture — it never moves — so its frame work is capped at one pass over
 * three mutable values during an Amen window, with a settled early-out in between.
 */
function Pedestal({ amenPulseCount }: PedestalProps) {
  const slabRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.PointLight>(null);
  const lastPulseRef = useRef(0);
  const pulseStartRef = useRef(Number.NEGATIVE_INFINITY);
  /** Settled flag: once the window closes, stop rewriting identical values every frame. */
  const settledRef = useRef(true);

  useFrame((state) => {
    if (amenPulseCount !== lastPulseRef.current) {
      lastPulseRef.current = amenPulseCount;
      pulseStartRef.current = state.clock.elapsedTime;
      settledRef.current = false;
    }

    if (settledRef.current) return;

    const flare = amenFlare(
      amenProgress(state.clock.elapsedTime, pulseStartRef.current),
    );
    if (flare === 0) settledRef.current = true;

    const glow = glowRef.current;
    if (glow) glow.intensity = PEDESTAL_FLARE_INTENSITY * flare;

    const slabMaterial = slabRef.current?.material;
    if (slabMaterial instanceof THREE.MeshPhysicalMaterial) {
      slabMaterial.emissiveIntensity =
        PEDESTAL_EMISSIVE_BASE + PEDESTAL_EMISSIVE_FLARE * flare;
    }

    const ringMaterial = ringRef.current?.material;
    if (ringMaterial instanceof THREE.MeshStandardMaterial) {
      ringMaterial.emissiveIntensity =
        RING_EMISSIVE_BASE + RING_EMISSIVE_FLARE * flare;
    }
  });

  return (
    <group>
      {/* Contact shadow pool (spec): anchors the sandals and the sheep to the acrylic surface,
          with the plane 2mm above the slab's top face so the two can never z-fight. */}
      <ContactShadows
        position={[0, FIGURINE_GROUND_Y, 0]}
        opacity={0.75}
        scale={2.8}
        blur={1.8}
        far={1.5}
        resolution={512}
        color="#000000"
      />

      {/* Illuminated acrylic slab: its top face meets the ground plane from below, so the
          figurine's soles land exactly on it. */}
      <mesh ref={slabRef} position={[0, PEDESTAL_CENTER_Y, 0]}>
        <cylinderGeometry
          args={[PEDESTAL_RADIUS, PEDESTAL_RADIUS, PEDESTAL_THICKNESS, 64]}
        />
        <meshPhysicalMaterial
          color={ACRYLIC_TINT}
          roughness={0.15}
          metalness={0.2}
          transmission={0.6}
          thickness={PEDESTAL_THICKNESS}
          transparent
          opacity={0.85}
          emissive={GOLD}
          emissiveIntensity={PEDESTAL_EMISSIVE_BASE}
        />
      </mesh>

      {/* Gold halo on the slab's upper rim, seated entirely below the ground plane so the shadow
          pool's depth pass (which renders everything above the plane) can never capture it. */}
      <mesh
        ref={ringRef}
        position={[0, PEDESTAL_RING_Y, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <torusGeometry args={[PEDESTAL_RADIUS, PEDESTAL_RING_TUBE, 16, 96]} />
        <meshStandardMaterial
          color={GOLD}
          emissive={GOLD}
          emissiveIntensity={RING_EMISSIVE_BASE}
          roughness={0.3}
          metalness={0.2}
        />
      </mesh>

      {/* Radial ember core inside the slab (spec: 6.0 for 800ms on an Amen). */}
      <pointLight
        ref={glowRef}
        position={[0, PEDESTAL_CENTER_Y, 0]}
        color={GOLD}
        intensity={0}
        distance={PEDESTAL_FLARE_RANGE}
        decay={2}
      />
    </group>
  );
}
