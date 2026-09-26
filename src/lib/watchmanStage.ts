/**
 * Watchman figurine — the pure stage + rig contract.
 *
 * The hero is a skinned, animated character standing on an illuminated acrylic pedestal. This
 * module pins that composition — the ground plane the soles rest on, the platter that fills it, the
 * camera framing that keeps the platter and the crown inside the viewport at every allowed orbit
 * angle — and the clip policy the rig plays.
 *
 * Every figure number is *measured* from the shipped asset (`public/models/watchman.glb`, the
 * FBX2glTF export of the rigged shepherd, baked to a unit-height box by
 * `scripts/normalizeWatchmanGlb.mjs`: soles pinned at Y = 0, crown at Y = 1, x/z centred) with
 * three's own GLTFLoader and the exact skin-aware vertex path the renderer uses
 * (`Mesh.getVertexPosition`). It is not read off a bounding box: an AABB transformed by a rotated
 * parent *inflates*, and an animated rig leaves its rest bounds anyway — so the pins below are
 * sampled across Idle, Wave and ThumbsUp (`scripts/measureWatchmanBounds.mjs`).
 *
 *   geometry       6,235 vertices / 8,116 triangles, 1 skin, 34 joints, 3 clips
 *                           (un-welded, so the mesh can carry its texture seams; see
 *                            `tests/watchmanAsset.test.mjs` and the header of that module)
 *   crown          1.0000   normalized head top — rest is exact, every clip samples below it
 *   sole           0.0000   deepest vertex across all three clips — never dips beneath it
 *   silhouette     0.3800   widest swing from the Y axis while the rig plays: measured peak
 *                           0.3669 (rest 0.1970, idle sway 0.3470), carried at 0.38 so the
 *                           tap volume keeps a small ledge over the gesture frames
 *   gesture reach  0.3669   Wave/ThumbsUp hand mid-clip — inside the silhouette bound and
 *                           under the composed crown (see the orbit note)
 *
 * Dependency-free on purpose: `tests/watchmanStage.test.mjs` transpiles this file and exercises
 * the formulas directly (node:test + ts.transpileModule + node:vm, the harness the globe modules
 * already use) — and re-derives the asset facts above from the GLB's own JSON chunk, so a swapped
 * model fails the suite instead of silently re-scaling or un-grounding the hero.
 */

// --- The figurine's world -------------------------------------------------------------------

/**
 * Source-asset measurements, in model units after the normalization bake: the soles sit on the
 * origin (Y = 0), the crown on Y = 1, and x/z are centred, so these read straight off the shipped
 * POSITION accessor — which the suite pins against the GLB itself.
 */
export const MODEL_CROWN_Y = 1.0;
export const MODEL_SOLE_Y = 0.0;
export const MODEL_HEIGHT = MODEL_CROWN_Y - MODEL_SOLE_Y;
/** Widest swing from the Y axis while the rig plays — measured 0.3669, carried at 0.38 (see header). */
export const MODEL_SILHOUETTE_RADIUS = 0.38;
/** Wave/ThumbsUp hand mid-clip: measured peak, now inside the silhouette bound above. */
export const MODEL_GESTURE_REACH = 0.3669;

/** On-stage height of the character: the composition the retained pedestal and camera were fitted to. */
export const FIGURINE_HEIGHT = 2.4;

/**
 * Fit scale. The normalized asset is exactly one unit tall, so the composition's 2.4 units fall
 * out directly: `2.4 / 1.0 = 2.4`, landing the crown on the 1.4 world ridge exactly. (Against the
 * pre-bake 0.00999-unit box the stale 4.4612-unit constants would have scaled the hero down to
 * 5.4mm — the invisible-figure bug this contract was recalibrated for.)
 */
export const FIGURINE_SCALE = FIGURINE_HEIGHT / MODEL_HEIGHT;

/** The stage's ground plane: the soles rest on it, the pedestal's top face meets it. */
export const FIGURINE_GROUND_Y = -1.0;

/** Crown height — the top of the composition. */
export const FIGURINE_TOP_Y = FIGURINE_GROUND_Y + FIGURINE_HEIGHT;

/**
 * The character's vertical centre — the hit volume's pivot. Once the sole sits on the plane,
 * `GROUND + HEIGHT` *is* the crown of the resting pose (the suite pins that identity against the
 * measured crown), which is what makes "the composition is 2.4 units tall" a measurement.
 */
export const FIGURINE_CENTER_Y = (FIGURINE_GROUND_Y + FIGURINE_TOP_Y) / 2;

/**
 * The primitive's own y offset. The normalized asset pins its soles at exactly 0, so the anchor
 * collapses to the ground plane itself: `GROUND - 0 × SCALE`. The deepest vertex of every shipped
 * clip lands exactly on it — Idle's closest approach measures +3e-5 model units (a hair proud) —
 * so no frame of Idle, Wave or ThumbsUp can sink a foot through the slab.
 */
export const FIGURINE_BASE_Y =
  FIGURINE_GROUND_Y - MODEL_SOLE_Y * FIGURINE_SCALE;

/**
 * Horizontal half-extent at scale: `0.38 × 2.4 = 0.912` world units — the widest frame the rig
 * ever plays sits inside the platter's rim (radius 1.0) while the tap volume's 5% ledge reaches
 * toward it. The suite pins both ends: no overhang past the rim, and no silent re-scale can
 * shrink the hero to a speck on a dinner-plate stage.
 */
export const FIGURINE_HALF_WIDTH = MODEL_SILHOUETTE_RADIUS * FIGURINE_SCALE;

// --- The pedestal ----------------------------------------------------------------------------

/** Slim acrylic slab, 0.04 world units thick. */
export const PEDESTAL_THICKNESS = 0.04;

/** The slab the character stands on: radius 1.0 — what the tap volume's ledge reaches toward. */
export const PEDESTAL_RADIUS = 1.0;

/**
 * The contact-shadow plane (spec: y = -1.0) and the slab's top face both want to sit on the
 * ground plane, and two coplanar planes z-fight. Dropping the acrylic 2mm under the plane hides
 * inside the shadow pool's own blur and keeps the soles exactly on `FIGURINE_GROUND_Y`.
 */
export const PEDESTAL_Z_FIGHT_GUARD = 0.002;

/** Slab centre: its top face lands one guard-width under the ground plane. */
export const PEDESTAL_CENTER_Y =
  FIGURINE_GROUND_Y - PEDESTAL_THICKNESS / 2 - PEDESTAL_Z_FIGHT_GUARD;

/** Lowest point of the composition — what the camera has to keep in frame. */
export const PEDESTAL_BOTTOM_Y =
  FIGURINE_GROUND_Y - PEDESTAL_THICKNESS - PEDESTAL_Z_FIGHT_GUARD;

/**
 * The halo ring's tube straddles the slab's upper rim, kept entirely *below* the ground plane:
 * drei's ContactShadows renders every visible object between the plane and its `far` into a depth
 * texture, so a ring poking above the plane would burn a phantom ring into the shadow pool.
 */
export const PEDESTAL_RING_TUBE = 0.012;
export const PEDESTAL_RING_Y =
  FIGURINE_GROUND_Y - PEDESTAL_RING_TUBE - PEDESTAL_Z_FIGHT_GUARD;

// --- Camera + orbit framing -------------------------------------------------------------------

/**
 * Vertical field of view of the hero's camera.
 *
 * Widened 45 → 57 for the altar-desk framing below. A 2.44-unit composition pivoting at *heart*
 * level (0.47, not the composition's midpoint) hangs far lower in frame than it used to, so a 45°
 * lens no longer clears the pedestal's underside at the narrowest card. 57° restores the framing
 * margin the old rig had (both land at 89.2% of the half-frame on the binding vertical axis) while
 * the *reduced* orbit distance keeps the perspective from opening into a wide-angle distortion.
 */
export const CAMERA_FOV = 57;

/**
 * Distance from the orbit pivot. Pulled in from 4.6 to 4.2: with the pivot raised to the chest,
 * holding the old distance would have pushed the camera *up* (the old mount sat at Y = 1.600,
 * above the crown) — the exact "looking down on it" read this recalibration removes. The suite
 * proves the composition still clears the frustum at both orbit limits on the narrowest card.
 */
export const CAMERA_DISTANCE = 4.2;

/**
 * The camera starts 15° above the horizon: an eye-level mount would show the slab edge-on as a
 * line, and the clamp ceiling below (20° of reachable elevation) is what keeps every orbit angle
 * in the same product-shot register rather than drifting back toward a top-down plan view.
 */
export const CAMERA_ELEVATION = (15 * Math.PI) / 180;

/**
 * Polar clamps (spec). They are also the framing guarantee: zoom and pan are off, so the only way a
 * visitor can move the camera is around a fixed-radius arc inside these limits, and the suite proves
 * the composition — the crown, the pedestal's rim and the resting silhouette at its widest height —
 * stays inside the frustum at both ends, at the narrowest card the hero renders in.
 *
 * The ceiling is the load-bearing one. At `π/3` a visitor could drag the camera 30° above the
 * horizon, which foreshortens the torso and inflates the head — the "statuette photographed from a
 * drone" read. Clamped to 70° (20° of reachable elevation) the whole arc stays in the 0–20° band,
 * inside the 15–20° the mount uses, so no drag can reintroduce the top-down.
 *
 * Gesture clips used to be the exception — the old rig threw its hand past the platter and could
 * cross a narrow card's edge. The normalized shepherd never leaves the composition: Wave peaks at
 * 0.37 source units out (0.88 world, inside the rim) and 0.998 crown-heights up, so every frame of
 * every clip stays inside what this guarantee covers.
 */
export const ORBIT_MIN_POLAR_ANGLE = (70 * Math.PI) / 180;
export const ORBIT_MAX_POLAR_ANGLE = Math.PI / 2.05;

/**
 * Where the figure's sternum sits along the composed 2.4-unit figure, as a fraction of its height
 * above the ground plane. Measured off the shipped rig's bone chain (hips at ~0.48, spine at ~0.62,
 * clavicle at ~0.72) — 0.6125 is the sternum's own height fraction, and the camera looking here
 * instead of at the composition's midpoint is what stops the head dominating the frame.
 */
export const FIGURINE_HEART_FRACTION = 0.6125;

/**
 * Orbit pivot: the figurine's heart, not the centre of the composition bounding box.
 *
 * The old value was `(PEDESTAL_BOTTOM_Y + FIGURINE_TOP_Y) / 2` ≈ 0.179 — the midpoint of pedestal
 * *underside to crown*, which sits at the figure's waist. Pivoting there framed the composition
 * symmetrically but pushed the camera above the crown and tilted it down onto the top of the head.
 * At the sternum the camera reads the figurine the way you would lean over a desk to inspect a
 * collectible: level with the chest, looking slightly down the length of the robe.
 */
export const ORBIT_TARGET_Y =
  FIGURINE_GROUND_Y + FIGURINE_HEIGHT * FIGURINE_HEART_FRACTION;

/**
 * Mounted camera position: the pivot, offset by the elevation angle. `sin` is the height and
 * `cos` is the horizontal distance — and the polar angle drei's controller clamps (and reads
 * back off this position) is `π/2 - CAMERA_ELEVATION`, so the two conventions have to stay in
 * step. The suite pins them, and it caught them swapped once already.
 */
export const CAMERA_POSITION: [number, number, number] = [
  0,
  ORBIT_TARGET_Y + CAMERA_DISTANCE * Math.sin(CAMERA_ELEVATION),
  CAMERA_DISTANCE * Math.cos(CAMERA_ELEVATION),
];

/** The same pivot as an array, for `OrbitControls target={...}` (R3F applies it via `fromArray`). */
export const ORBIT_TARGET: [number, number, number] = [0, ORBIT_TARGET_Y, 0];

/**
 * The idle-breathing pivot — the same height as the ground plane, by design.
 *
 * `WatchmanModel` seats a group here and drives a micro-sway and a vertical swell on it, which is
 * what makes the figurine read as alive between gestures. It has to be the *ground plane* and not
 * the world origin: the rig group sits at the origin, a unit above the soles, so a sway applied
 * there would slide the feet sideways and a swell would lift them off the acrylic — the exact
 * "feet feel detached" symptom the contact-shadow calibration in the scene exists to fix. Pinned to
 * the sole line, the figure turns and breathes *about its own feet* and the grounding never moves.
 * The suite pins the equality.
 */
export const BREATHING_PIVOT_Y = FIGURINE_GROUND_Y;

// --- The Amen window (800ms, spec) -------------------------------------------------------------

export const AMEN_PULSE_MS = 800;

/**
 * Gold rim / backlight. The studio rig's rim is a three-point *silhouette* light, so its rest value
 * is calibrated against the key in `WatchmanScene` rather than in isolation: at 3.5 it out-shone the
 * 2.8 key and turned every back-facing edge into a hard white-hot band. It now rests just under the
 * key's 1.6 and still carries the full 6.0 on the instant of an Amen, so the celebratory flare is
 * now a *surge* against a quiet rim instead of a step down from a rim that was already blinding.
 */
export const RIM_BASE_INTENSITY = 1.4;

/** The Amen surge — 4.3× the resting rim, which is what makes the moment read at a glance. */
export const RIM_SURGE_INTENSITY = 6.0;

/**
 * Where the rim hangs: behind and slightly above the figure, at `[0, 2.5, -2.5]`.
 *
 * Co-owned here (rather than inline in the scene) because it is a *framing* constant as much as a
 * lighting one: the gold edge only separates the figurine from the dark stage while the camera looks
 * at it from the front arc, and the orbit clamps above guarantee it always does. Raising it back
 * toward the old `[0, 4, -4]` would drop the rim below the shoulders on the widest poses, losing
 * the outline exactly when the silhouette is widest.
 */
export const RIM_POSITION: [number, number, number] = [0, 2.5, -2.5];

/** The decay the rim surge and the pedestal flare share: `(1 - p) ^ 1.4`. */
export const AMEN_DECAY_EXPONENT = 1.4;

/**
 * Progress through the Amen window: 0 on the tick, 1 at +800ms, larger than 1 once it is over.
 * Callers hand it the scene clock, so the window needs no timers and no state.
 */
export function amenProgress(
  elapsedSeconds: number,
  pulseStartSeconds: number,
): number {
  return (elapsedSeconds - pulseStartSeconds) * (1000 / AMEN_PULSE_MS);
}

/**
 * The shared Amen decay: 1 at the tick → 0 at +800ms. The clamp is load-bearing — `Math.pow` of a
 * negative base with a fractional exponent is NaN, and callers legitimately evaluate this both
 * before the window opens and long after it closes.
 */
export function amenFlare(progress: number): number {
  const clamped = Math.min(Math.max(progress, 0), 1);
  return Math.pow(1 - clamped, AMEN_DECAY_EXPONENT);
}

/** Rim intensity at a moment in the window — the resting value outside it. */
export function rimIntensity(progress: number): number {
  return (
    RIM_BASE_INTENSITY +
    (RIM_SURGE_INTENSITY - RIM_BASE_INTENSITY) * amenFlare(progress)
  );
}

// --- The clip policy --------------------------------------------------------------------------

/**
 * The three clips this rig plays — the full set the GLB ships. The names are the asset's own
 * (three matches clips by string), so the suite asserts them against the file itself rather than
 * trusting this comment.
 */
export const IDLE_CLIP = "Idle";
export const CLICK_GESTURE_CLIP = "Wave";
export const AMEN_GESTURE_CLIP = "ThumbsUp";

/** Who asked for the gesture: the visitor's tap on the hero, or the Amen button. */
export type GestureSource = "click" | "amen";

/**
 * The clip a gesture source plays: a tap is answered with a wave, an Amen with a thumbs up —
 * semantically right for each, and both are *shipped* clips, so the rig never reaches for a clip
 * the asset does not have (the suite checks the pair against the GLB).
 */
export function gestureClip(source: GestureSource): string {
  return source === "amen" ? AMEN_GESTURE_CLIP : CLICK_GESTURE_CLIP;
}

/** Cross-fade into the idle loop on mount (spec). */
export const IDLE_FADE_IN_SECONDS = 0.5;

/**
 * Cross-fade around a one-shot gesture (spec): the same duration in and out, so a tap mid-gesture
 * and the mixer's own return to Idle take the same path.
 */
export const GESTURE_FADE_SECONDS = 0.2;
