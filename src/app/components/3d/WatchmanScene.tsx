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
  RIM_POSITION,
  amenFlare,
  amenProgress,
} from "@/lib/watchmanStage";
import WatchmanModel from "./WatchmanModel";

/**
 * Studio rig: a low ambient floor over the lapis canvas, a warm key from the upper front right, a
 * cool fill from the low back left, and a gold rim from behind and above. The asset ships authored
 * PBR materials and NORMAL data (see WatchmanModel), so every light in here contributes real
 * shading — nothing in the rig compensates for the mesh.
 *
 * The hierarchy is three-point and deliberately *narrow* in range, which is what makes the folds
 * read: the key alone carries form, the fill is a fraction of it so the shadow side stays cool and
 * legible instead of grey, and the rim is nearly as strong as the key so the silhouette always has
 * a gold edge against the dark stage. Everything below is scaled together — moving one without the
 * others collapses the contrast this rig exists to create.
 *
 * Shadow maps stay off deliberately: the grounding shadow is the pedestal's `<ContactShadows>`
 * pool — contact-accurate, 512² — and a directional map would fight a *skinned* rig (its bones
 * move the caster between the depth pass and the light every frame) while adding a second,
 * longer shadow competing with the contact-accurate pool.
 */

/**
 * Ambient floor (spec: 0.35). Deliberately low: this is the "bounce off the altar cloth" term, and
 * it exists to keep occluded creases from going to pure black. The previous 1.8 was a flat-lift
 * value that washed the whole figure toward mid-grey and erased the fold shadows the key is
 * supposed to carve.
 */
const AMBIENT_INTENSITY = 0.35;

/**
 * Key light (spec): warm altar sunlight, upper front right at `[2.5, 4, 3]`, intensity 1.6, a
 * soft amber-white rather than pure white so the highlights stay inside the brand's warm palette.
 * This is the only light with enough energy to model the robe's folds.
 */
const KEY_INTENSITY = 1.6;
const KEY_COLOR = "#FFF5EA";
const KEY_POSITION: [number, number, number] = [2.5, 4, 3];

/**
 * Fill (spec): a cool sky/navy bounce from the low back left at `[-2.5, 1.5, -1]`, intensity 0.5.
 * A third of the key's strength on purpose — enough to put blue into the shadow side of the cloth
 * so folds separate, not enough to lift them back to grey. Placed low and behind (rather than
 * beside) so it grazes the robe's silhouette edge instead of flattening the front.
 */
const FILL_INTENSITY = 0.5;
const FILL_COLOR = "#1E293B";
const FILL_POSITION: [number, number, number] = [-2.5, 1.5, -1];

/** Palette C tokens (`src/app/globals.css`): gold `--color-gold`, deep `--color-gold-deep`. */
const GOLD = "#F59E0B";
const GOLD_DEEP = "#FBBF24";
const ACRYLIC_TINT = "#101D2B";

/**
 * 40% IBL: enough city-lit sheen to keep the figure's matte panels alive, never a second key. It
 * was 60% against the old flat-lift rig; with the ambient floor and fill now carrying real
 * separation, a full-strength environment would quietly re-flatten the cloth.
 */
const ENVIRONMENT_INTENSITY = 0.4;

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
 * Contact-shadow pool (spec). Every number here is a *contact* calibration, not a soft-shadow one:
 * the job is to weld the sandals to the acrylic, so the pool stays tight, dark and close.
 *
 *   opacity 0.7  dense enough that the soles read as bearing weight (the previous 0.75 over a
 *                wider pool read as a smudge once the camera dropped to chest height)
 *   blur    2.0  enough falloff to be a shadow rather than a stencil, still tight under the feet
 *   scale   2.2  shrunk from 2.8 so the pool hugs the figurine instead of reaching the slab's rim,
 *                which keeps the pedestal edge crisp against the dark card
 *   far     1.1  from 1.5 — captures the sandals and the hem above them, and nothing higher up the
 *                robe, so a raised arm during a Wave cannot smear a second shadow across the slab
 */
const CONTACT_SHADOW_OPACITY = 0.7;
const CONTACT_SHADOW_BLUR = 2.0;
const CONTACT_SHADOW_SCALE = 2.2;
const CONTACT_SHADOW_FAR = 1.1;

/**
 * The brass ring. Bronze-coloured and near-metallic so the key and rim both find a specular
 * highlight on it — the previous flat gold at roughness 0.3 / metalness 0.2 had almost no
 * highlight band to catch, which is what left the pedestal's edge looking unfinished.
 */
const RING_METALNESS = 0.85;
const RING_ROUGHNESS = 0.18;
const BRASS = "#C9A227";

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
      {/*
       * The studio rig, in the order it reads: a low ambient floor that only keeps occluded creases
       * off pure black, the warm key that actually models the robe, a cool low back-left fill that
       * separates the shadow side without greying it, and the gold rim that draws the silhouette.
       * No shadow maps — the grounding shadow is the pedestal's contact pool (see the rig note).
       */}
      <ambientLight intensity={AMBIENT_INTENSITY} />

      {/* Key: warm altar sunlight, upper front right. */}
      <directionalLight
        position={KEY_POSITION}
        intensity={KEY_INTENSITY}
        color={KEY_COLOR}
      />

      {/* Fill: cool sky bounce, low and behind on the left — grazes the cloth, never floods it. */}
      <directionalLight
        position={FILL_POSITION}
        intensity={FILL_INTENSITY}
        color={FILL_COLOR}
      />

      {/* Gold rim, behind and slightly above — surges from 1.4 to 6.0 for 800ms on every Amen
          (see WatchmanModel). */}
      <directionalLight
        ref={rimLightRef}
        position={RIM_POSITION}
        intensity={RIM_BASE_INTENSITY}
        color={GOLD_DEEP}
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
          with the plane 2mm above the slab's top face so the two can never z-fight. Tight and
          close — see the calibration above. */}
      <ContactShadows
        position={[0, FIGURINE_GROUND_Y, 0]}
        opacity={CONTACT_SHADOW_OPACITY}
        scale={CONTACT_SHADOW_SCALE}
        blur={CONTACT_SHADOW_BLUR}
        far={CONTACT_SHADOW_FAR}
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

      {/* Brass halo on the slab's upper rim, seated entirely below the ground plane so the shadow
          pool's depth pass (which renders everything above the plane) can never capture it. Kept
          metallic and polished so the key and rim both leave a travelling specular gleam on it —
          that highlight is what separates the pedestal's edge from the dark card behind it. */}
      <mesh
        ref={ringRef}
        position={[0, PEDESTAL_RING_Y, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <torusGeometry args={[PEDESTAL_RADIUS, PEDESTAL_RING_TUBE, 16, 96]} />
        <meshStandardMaterial
          color={BRASS}
          emissive={GOLD}
          emissiveIntensity={RING_EMISSIVE_BASE}
          roughness={RING_ROUGHNESS}
          metalness={RING_METALNESS}
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
