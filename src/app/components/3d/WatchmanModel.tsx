"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import {
  AMEN_GESTURE_CLIP,
  BREATHING_PIVOT_Y,
  CLICK_GESTURE_CLIP,
  FIGURINE_BASE_Y,
  FIGURINE_CENTER_Y,
  FIGURINE_HALF_WIDTH,
  FIGURINE_HEIGHT,
  FIGURINE_SCALE,
  GESTURE_FADE_SECONDS,
  IDLE_CLIP,
  IDLE_FADE_IN_SECONDS,
  amenProgress,
  gestureClip,
  rimIntensity,
  type GestureSource,
} from "@/lib/watchmanStage";

/**
 * Studio rig for the shipped GLB character.
 *
 * The asset is skeletal, not a statue: 3 clips, 1 skin / 34 joints, 6,235 vertices and 8,116
 * triangles in one skinned mesh, a baked base-color texture and authored PBR surface factors
 * (metallic 0.05, roughness 0.85), normalized to a unit-height box.
 * Its measured numbers live in `@/lib/watchmanStage`, which also owns the clip policy, the fades
 * and the on-stage scale — this file only drives them.
 *
 * Two things about the blend layer worth knowing before editing:
 *
 *  1. **drei already steps the mixer.** `useAnimations` runs `mixer.update(delta)` from its own
 *     `useFrame`, so this component must never call `update` itself or every clip would play at
 *     double speed. It only *schedules* (fadeIn / fadeOut / play / reset) and reads.
 *  2. **`actions` are lazy getters.** drei defines one per clip, and the getter returns
 *     `undefined` unless the root ref is attached — which is why every access here happens inside
 *     effects, handlers or the frame loop, never during render, and always with `?.`.
 */
const MODEL_PATH = "/models/watchman.glb";

/**
 * Click tolerance. R3F reports `event.delta` as the pointer's travel in pixels since pointerdown,
 * which is exactly the difference between "the visitor tapped the hero" and "the visitor finished
 * orbiting the camera on top of it".
 */
const CLICK_DRAG_TOLERANCE_PX = 6;

/**
 * Invisible hit cylinder: the played silhouette (half-width 0.912 world units) with a 5% ledge —
 * 0.958, still inside the 1.0 platter — so thumbs land and a ray never has to walk the character's
 * meshes, which matters more now that they are skinned: raycasting a skinned part resolves every
 * vertex through its bones.
 */
const HIT_RADIUS = FIGURINE_HALF_WIDTH * 1.05;

/**
 * Idle breathing: the micro-sway that keeps the figurine from reading as a frozen render between
 * gesture clicks.
 *
 * The Idle clip animates the *bones*; this animates the rig *group*, one level up, so the two never
 * fight over the same transform. Amplitude is deliberately tiny — 0.005 rad is 0.29°, which at the
 * figure's 1.2-unit half-height moves the silhouette edge by about 6mm, under 0.3% of the frame at
 * the hero's narrowest card. It is a "did something just move?" signal, not an animation, and it is
 * tuned to stay under the threshold where a viewer consciously registers it as motion.
 */
const IDLE_SWAY_RADIANS = 0.005;

/** One full breath every 3.5s — slow enough to read as breathing rather than as a sway. */
const IDLE_BREATH_SECONDS = 3.5;

/** The vertical companion: a barely-perceptible swell, a fraction of a millimetre of scale. */
const IDLE_BREATH_SCALE = 0.0015;

interface WatchmanModelProps {
  /** Incremented by DailyReflection on every "Say Amen" — plays the thumbs-up and the rim surge. */
  amenPulseCount: number;
  /** Reduced motion: the character holds its stance (the Amen still answers in light). */
  reducedMotion?: boolean;
  /** Amber rim / backlight owned by the scene — the Amen surge drives its intensity. */
  rimLightRef: RefObject<THREE.DirectionalLight | null>;
}

/**
 * Matte-porcelain surface band (spec). The rig is lit by a strong key and a weak fill, so any
 * glossier surface would answer it with a hard specular hot-spot instead of a broad soft sheen —
 * the "glossy plastic" read. Clamping *into* this band (rather than overwriting) leaves a future
 * export that already sits inside it completely untouched, and still pulls a stray glossy re-export
 * back to the sculpted-clay finish the rest of the stage assumes.
 */
const SURFACE_ROUGHNESS_MIN = 0.75;
const SURFACE_ROUGHNESS_MAX = 0.85;
const SURFACE_METALNESS_MIN = 0.02;
const SURFACE_METALNESS_MAX = 0.05;

/** Clamp helper shared by the roughness and metalness bands (kept pure and in one place). */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Puts a cloth/skin material into the matte band without discarding authored surface detail: the
 * scalar factors are clamped *into* the band rather than overwritten, and a present normal map is
 * dialled back so an over-strong authored detail cannot shimmer under the hard key.
 */
function matteSurface(material: THREE.Material): void {
  if (!(material instanceof THREE.MeshStandardMaterial)) return;

  // The shipped export authors roughness 0.85 / metallic 0.05, which is already inside both bands;
  // these clamps are guards, so an in-band re-export renders byte-identically to the shipped one.
  material.roughness = clamp(
    material.roughness,
    SURFACE_ROUGHNESS_MIN,
    SURFACE_ROUGHNESS_MAX,
  );
  material.metalness = clamp(
    material.metalness,
    SURFACE_METALNESS_MIN,
    SURFACE_METALNESS_MAX,
  );

  // The scalar clamp above is the whole job. A `roughnessMap`, if a future export brings one, still
  // multiplies this value, so the authored variation survives as variation rather than being
  // flattened by a constant — which is what keeps cloth reading as fabric and not as clay.
  //
  // `normalScale` is the one genuine adjustment: an over-strong authored normal detail is what makes
  // a matte surface shimmer into hammered metal under a hard key, so it is dialled back to 0.6 when
  // a normal map is present. The shipped asset has NORMAL *data* but no normal *map*, so this is a
  // no-op today and a guard tomorrow.
  if (material.normalMap) material.normalScale.set(0.6, 0.6);
}

/**
 * One-time scene preparation. Guards are per-geometry / per-material, so a StrictMode double-run (or
 * a second consumer of the cached scene) is a no-op.
 */
function prepareScene(scene: THREE.Object3D) {
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;

    // The shipped export carries NORMAL data, so this guard is a no-op today and exists only so a
    // future export cannot render as a black silhouette: without a normal attribute WebGL feeds
    // (0, 0, 0) and `MeshStandardMaterial` shades at `dot(N, L) = 0` under every light in the rig.
    // The previous iteration *also* forced `metalness = 0` here; this asset authors 0.05 (with
    // roughness 0.85), which is correct and worth keeping, so that override is gone rather than
    // silently rewriting artwork.
    if (!mesh.geometry.attributes.normal) {
      mesh.geometry.computeVertexNormals();
    }

    /*
     * Colour space. three does tag a base-colour texture sRGB when it loads it through the glTF
     * path, so this is a no-op for the shipped asset — but only because `GLTFLoader` cooperated.
     * A texture handed over by any other route (or a re-export that inlines its image without
     * declaring the colour space) arrives tagged linear, and sRGB data read as linear renders
     * washed-out and low-contrast: precisely the "flat, no depth" complaint this pass fixes. Stated
     * explicitly so the figure's warmth is a decision, not a loader side effect.
     */
    const material = mesh.material as THREE.Material & { map?: THREE.Texture | null };
    if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;

    // Matte porcelain / sculpted clay across the cloth and skin — see SURFACE_* above.
    if (Array.isArray(mesh.material)) mesh.material.forEach(matteSurface);
    else matteSurface(mesh.material);

    // A skinned mesh's bound is computed once, in the rest pose — but the hands travel well past it
    // mid-clip (Wave reaches 0.367 source units out against a 0.197 rest radius), so the frustum
    // culler would pop them out of view: keep the skinned mesh out of culling.
    const skinned = mesh as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) skinned.frustumCulled = false;
  });
}

/** drei's lazily-built action map: one entry per clip, `null` until the root ref attaches. */
type WatchmanActions = {
  [key: string]: THREE.AnimationAction | null | undefined;
};

/**
 * One-shot clip configuration, kept at module scope for the same reason as `prepareScene`: an
 * `AnimationAction` is a runtime mixer object drei hands out for callers to drive — not
 * render-owned state — and `clampWhenFinished` (three ships no setter for it) is what holds a
 * gesture's final pose through the cross-fade the mixer's `finished` event starts. Set once per
 * action, not once per tap.
 */
function configureGestureClips(actions: WatchmanActions): void {
  for (const clip of [CLICK_GESTURE_CLIP, AMEN_GESTURE_CLIP]) {
    const gesture = actions[clip];
    if (!gesture) continue;
    gesture.setLoop(THREE.LoopOnce, 1);
    gesture.clampWhenFinished = true;
  }
}

export default function WatchmanModel({
  amenPulseCount,
  reducedMotion = false,
  rimLightRef,
}: WatchmanModelProps) {
  const { scene, animations } = useGLTF(MODEL_PATH);

  /** The blend tree's root: every clip targets bones and morphs inside this group. */
  const rigRef = useRef<THREE.Group>(null);
  /**
   * The idle-breathing pivot, nested inside the blend tree and seated on the ground plane so the
   * soles are its fixed point (see the frame loop). Kept separate from `rigRef` because the mixer
   * owns that one's transform space, and the hit volume is positioned in it.
   */
  const breathRef = useRef<THREE.Group>(null);
  const { actions, mixer } = useAnimations(animations, rigRef);

  /** Last Amen count seen — the effect below stamps the window when this changes. */
  const lastPulseRef = useRef(0);
  const pulseStartRef = useRef(Number.NEGATIVE_INFINITY);
  /** The scene clock, mirrored every frame so an effect can stamp a window without a state trip. */
  const clockRef = useRef(0);

  useLayoutEffect(() => {
    prepareScene(scene);
  }, [scene]);

  /** Configures both gesture clips as soon as the mixer has actions to configure (see above). */
  useLayoutEffect(() => {
    configureGestureClips(actions);
  }, [actions]);

  /**
   * The idle loop. `reset()` so the loop starts from the clip's own frame zero, `fadeIn` so a later
   * mount (StrictMode's double run, a re-mount) eases in instead of popping. Under reduced motion
   * there is no loop at all — the character holds the stance the asset was authored in, the same
   * promise the last iteration made ("rests level and still") — and the cleanup fades it out, so
   * flipping the preference mid-session settles instead of snapping.
   */
  useEffect(() => {
    const idle = actions[IDLE_CLIP];
    if (!idle || reducedMotion) return;

    idle.reset().fadeIn(IDLE_FADE_IN_SECONDS).play();
    return () => {
      idle.fadeOut(IDLE_FADE_IN_SECONDS);
    };
  }, [actions, reducedMotion]);

  /**
   * Reduced motion is the gesture switch too: a one-shot clip already in flight when the preference
   * flips is faded out, so a live preference change is answered immediately.
   */
  useEffect(() => {
    if (!reducedMotion) return;
    actions[CLICK_GESTURE_CLIP]?.fadeOut(GESTURE_FADE_SECONDS);
    actions[AMEN_GESTURE_CLIP]?.fadeOut(GESTURE_FADE_SECONDS);
  }, [actions, reducedMotion]);

  /**
   * The mixer's own completion event is what returns the rig to Idle. The gesture has looped once
   * and clamped — `paused`, holding its final pose — so fading it out while fading the idle loop
   * back in (rather than resetting Idle to frame zero) cross-fades from the pose the visitor is
   * looking at, with no visible seam.
   */
  useEffect(() => {
    const idle = actions[IDLE_CLIP];
    const onFinished = (event: { action: THREE.AnimationAction }) => {
      event.action.fadeOut(GESTURE_FADE_SECONDS);
      idle?.fadeIn(GESTURE_FADE_SECONDS);
    };

    mixer.addEventListener("finished", onFinished);
    return () => mixer.removeEventListener("finished", onFinished);
  }, [actions, mixer]);

  /**
   * Plays a gesture once (its loop mode and clamped final pose are configured once, above). Idle
   * is faded out rather than stopped, so its phase keeps running and the return is seamless, and
   * the gesture is `reset()` so a re-trigger mid-clip restarts it instead of finishing early.
   * Memoised so the Amen effect's dependency array doesn't churn the callback every render.
   */
  const playGesture = useCallback(
    (source: GestureSource) => {
      if (reducedMotion) return;

      const gesture = actions[gestureClip(source)];
      if (!gesture) return;

      actions[IDLE_CLIP]?.fadeOut(GESTURE_FADE_SECONDS);
      gesture.reset().fadeIn(GESTURE_FADE_SECONDS).play();
    },
    [actions, reducedMotion],
  );

  /** Tap-to-wave, with orbit drags excluded — see CLICK_DRAG_TOLERANCE_PX. */
  function handleClick(event: ThreeEvent<MouseEvent>) {
    if (event.delta > CLICK_DRAG_TOLERANCE_PX) return;
    playGesture("click");
  }

  /**
   * The Amen: a counter tick stamps its window on the scene clock and answers with the
   * thumbs-up. Declarative on purpose — the prop *is* the event — and the stamp lands before the
   * next frame renders, so the rim surge and the gesture appear on the same painted frame. The
   * early return makes re-runs (a changed callback identity) no-ops, which is what lets the
   * dependency array name `playGesture` honestly.
   */
  useEffect(() => {
    if (amenPulseCount === lastPulseRef.current) return;
    lastPulseRef.current = amenPulseCount;
    pulseStartRef.current = clockRef.current;
    playGesture("amen");
  }, [amenPulseCount, playGesture]);

  useFrame((state) => {
    const elapsed = state.clock.elapsedTime;
    clockRef.current = elapsed;

    // Amber rim / backlight surge: full strength on the pulse's first frame, then decaying across
    // the window (the shared envelope returns the resting value outside it, so this stays
    // unconditional) — and it answers under reduced motion too, where a gesture cannot.
    const rimLight = rimLightRef.current;
    if (rimLight)
      rimLight.intensity = rimIntensity(
        amenProgress(elapsed, pulseStartRef.current),
      );

    /*
     * Idle breathing (spec): a micro-sway so the figurine reads as subtly alive between gesture
     * clicks. Two sinusoids a quarter-cycle apart — yaw from one, the vertical swell from the other
     * — so the motion traces a slow ellipse rather than pulsing on a single axis.
     *
     * It is written to `breathRef` (the group pivoted at the ground plane), *not* to `rigRef`. That
     * matters: `rigRef` sits at the world origin, ~1 unit above the soles, so yaw there would slide
     * the feet sideways and the scale would sink them 3mm into the slab — fighting the contact
     * shadow this same pass is trying to tighten. Pivoting at `FIGURINE_GROUND_Y` makes the soles
     * the fixed point, so the figure swells and turns *about its own feet* and the grounding holds.
     *
     * Reduced motion returns the group to rest *and writes the zeros*, rather than skipping: a
     * visitor who flips the OS preference mid-session would otherwise leave the rig stranded at
     * whatever offset it happened to be on, and the abrupt return would be exactly the snap the
     * preference is asking us to avoid.
     */
    const breathRig = breathRef.current;
    if (!breathRig) return;

    if (reducedMotion) {
      breathRig.rotation.y = 0;
      breathRig.scale.setScalar(1);
      return;
    }

    const breath = (elapsed * Math.PI * 2) / IDLE_BREATH_SECONDS;
    breathRig.rotation.y = Math.sin(breath) * IDLE_SWAY_RADIANS;
    const swell = 1 + Math.cos(breath) * IDLE_BREATH_SCALE;
    breathRig.scale.set(swell, swell, swell);
  });

  return (
    /*
     * The rig is a plain container: the *primitive* carries the fitted scale and the base offset
     * that lands the soles on the ground plane, so the model's own origin and the stage's ground
     * never have to agree. The group is what the mixer binds to.
     *
     * Inside it, `breathRef` is the idle-breathing pivot: it is *seated* on the ground plane and the
     * primitive hangs off it at the base offset from there, so scaling or yawing it moves the figure
     * about its own soles and the contact shadow stays welded to the feet. The hit volume stays out
     * here, in the un-breathed space, so the micro-sway cannot walk a tap target out from under a
     * thumb that was already on its way down.
     */
    <group ref={rigRef}>
      <group ref={breathRef} position={[0, BREATHING_PIVOT_Y, 0]}>
        <primitive
          object={scene}
          scale={FIGURINE_SCALE}
          position={[0, FIGURINE_BASE_Y - BREATHING_PIVOT_Y, 0]}
        />
      </group>

      {/*
       * Invisible hit volume. R3F raycasts every object carrying a pointer handler *and its
       * descendants* on every pointer event, so an `onClick` on the rig would walk all 20 meshes —
       * the skinned hands included — each time the pointer crossed the hero. This 24-triangle
       * cylinder takes the handler instead: the same tap target for a fraction of the raycasting.
       * It stays invisible to the renderer *and* to passes that swap in their own material (drei's
       * ContactShadows overrides `scene.overrideMaterial` for its depth pass) because both skip
       * `visible === false` — while three's `Raycaster` deliberately does not.
       */}
      <mesh
        visible={false}
        onClick={handleClick}
        position={[0, FIGURINE_CENTER_Y, 0]}
      >
        <cylinderGeometry
          args={[HIT_RADIUS, HIT_RADIUS, FIGURINE_HEIGHT, 12, 1, true]}
        />
        <meshBasicMaterial side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// Warm the HTTP cache as soon as this client chunk executes — the character is the hero, so its GLB
// should never wait for the component tree to mount.
useGLTF.preload(MODEL_PATH);
