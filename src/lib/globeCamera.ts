/**
 * Interactive globe camera & marker maths (Phase 2 — Task 3.2).
 *
 * Pure, dependency-free helpers that drive `MissionGlobe`'s orbit, zoom and
 * billboard-marker behaviour. Keeping this maths out of the three.js module
 * makes every number that moves the camera unit-testable without a GPU (see
 * `tests/globeScene.test.mjs`).
 *
 * Angles are radians. `theta` is the camera's azimuth (longitude, growing
 * eastward like `latLngToVector3`) and `phi` is its polar angle measured from
 * `+Y` (the North Pole), so `phi = PI / 2` puts the camera on the Equator.
 */

import { latLngToVector3, type GlobeLatLng, type GlobeVector3 } from '@/lib/globe';
import type { GlobeMarker } from '@/lib/types';

/** A camera/orbit snapshot: azimuth, polar angle and radial distance. */
export interface GlobeOrbitState {
  theta: number;
  phi: number;
  distance: number;
}

/** Closest the camera may approach the globe surface (radius 100). */
export const GLOBE_ZOOM_MIN = 130;
/** Furthest the camera may pull back while keeping the globe readable (Refero spec). */
export const GLOBE_ZOOM_MAX = 380;
/** Comfortable framing used on first paint and for unusable zoom values. */
export const GLOBE_DEFAULT_DISTANCE = 260;
/** Camera field of view in degrees. */
export const GLOBE_FOV = 42;

/** Pitch window: never quite the poles, so the camera can never flip (Refero spec ±0.25). */
export const GLOBE_PITCH_MIN = 0.25;
export const GLOBE_PITCH_MAX = Math.PI - GLOBE_PITCH_MIN;

/** Equivalent to a 0.05 ease factor at 60 Hz, independent of frame rate. */
export const GLOBE_DAMPING_LAMBDA = -60 * Math.log(1 - 0.05);
export const GLOBE_ZOOM_LAMBDA = 7;

/** Radians of rotation per dragged pixel, and the idle drift per second. */
export const GLOBE_ROTATE_SPEED = 0.0052;
export const GLOBE_IDLE_SPIN_SPEED = 0.045;
/** Radians added by an arrow-key nudge. */
export const GLOBE_KEY_ROTATE_STEP = 0.12;
/** Multiplier applied by the `+` / `-` zoom keys. */
export const GLOBE_KEY_ZOOM_FACTOR = 1.18;

/** Wheel sensitivity (exponential) and the largest delta honoured per event. */
export const GLOBE_WHEEL_SENSITIVITY = 0.0012;
export const GLOBE_WHEEL_MAX_DELTA = 600;

/** Pointer travel (px) above which a gesture is a drag and never a tap. */
export const CLICK_SLOP_PX = 6;

/** How far above a marker cluster the opening view is pitched. */
export const GLOBE_VIEW_TILT = 0.18;

/** Billboard sizing (world units) and label metrics. */
export const MARKER_BASE_SIZE = 9.5;
export const MARKER_LABEL_HEIGHT = 4.6;
export const MARKER_LABEL_CHAR_WIDTH = 2.35;
export const MARKER_LABEL_MIN_WIDTH = 8;
export const MARKER_LABEL_MAX_WIDTH = 22;
/** Marker scale applied at the near/far ends of the zoom range. */
export const MARKER_SCALE_NEAR = 0.88;
export const MARKER_SCALE_FAR = 1.55;
/** Dimming floor for markers sliding around the horizon. */
export const MARKER_HORIZON_FLOOR = 0.25;

/** Fallback framing used when there are no markers to frame. */
export const GLOBE_FALLBACK_VIEW: GlobeOrbitState = {
  theta: -1.7059,
  phi: 1.05,
  distance: GLOBE_DEFAULT_DISTANCE,
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** Clamps a camera distance into [GLOBE_ZOOM_MIN, GLOBE_ZOOM_MAX]. */
export function clampZoom(distance: number): number {
  if (!Number.isFinite(distance)) return GLOBE_DEFAULT_DISTANCE;
  return clamp(distance, GLOBE_ZOOM_MIN, GLOBE_ZOOM_MAX);
}

/** Clamps a polar angle so the camera always looks level with the horizon. */
export function clampPitch(phi: number): number {
  return clamp(phi, GLOBE_PITCH_MIN, GLOBE_PITCH_MAX);
}

/**
 * Exponential, frame-rate-independent ease toward a target. A zero/negative
 * delta leaves the value untouched, and a non-finite target is ignored.
 */
export function dampValue(
  current: number,
  target: number,
  lambda: number,
  dtSeconds: number,
): number {
  if (!Number.isFinite(current)) return target;
  if (!Number.isFinite(target)) return current;
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return current;
  const rate = Number.isFinite(lambda) && lambda > 0 ? lambda : GLOBE_DAMPING_LAMBDA;
  return current + (target - current) * (1 - Math.exp(-rate * dtSeconds));
}

/** Advances the rendered orbit toward its target, re-clamping pitch and zoom. */
export function stepOrbit(
  current: GlobeOrbitState,
  target: GlobeOrbitState,
  dtSeconds: number,
): GlobeOrbitState {
  return {
    theta: dampValue(current.theta, target.theta, GLOBE_DAMPING_LAMBDA, dtSeconds),
    phi: clampPitch(dampValue(current.phi, target.phi, GLOBE_DAMPING_LAMBDA, dtSeconds)),
    distance: clampZoom(dampValue(current.distance, target.distance, GLOBE_ZOOM_LAMBDA, dtSeconds)),
  };
}

/**
 * Converts a pointer drag into a new orbit target.
 *
 * Dragging right spins the visible surface right (`theta` down); dragging down
 * tips the north pole away (`phi` down, i.e. the camera rises). Both are frozen
 * inside the pitch window, so a fast drag can never flip the camera.
 */
export function applyOrbitDrag(
  target: GlobeOrbitState,
  dxPixels: number,
  dyPixels: number,
): GlobeOrbitState {
  const dx = Number.isFinite(dxPixels) ? dxPixels : 0;
  const dy = Number.isFinite(dyPixels) ? dyPixels : 0;
  return {
    theta: target.theta - dx * GLOBE_ROTATE_SPEED,
    phi: clampPitch(target.phi - dy * GLOBE_ROTATE_SPEED),
    distance: clampZoom(target.distance),
  };
}

/**
 * Projects an orbit state onto the same Y-up axes as `latLngToVector3`.
 * This is a pure projection: callers clamp pitch/zoom before calling it.
 */
export function orbitToPosition(orbit: GlobeOrbitState): GlobeVector3 {
  const distance = Number.isFinite(orbit.distance) ? orbit.distance : GLOBE_DEFAULT_DISTANCE;
  const phi = Number.isFinite(orbit.phi) ? orbit.phi : Math.PI / 2;
  const theta = Number.isFinite(orbit.theta) ? orbit.theta : 0;
  const ring = distance * Math.sin(phi);

  return {
    x: ring * Math.sin(theta),
    y: distance * Math.cos(phi),
    z: ring * Math.cos(theta),
  };
}

/**
 * Chooses the opening camera framing for a set of markers.
 *
 * The average marker direction becomes the camera azimuth, then the view is
 * tilted `GLOBE_VIEW_TILT` above it so the cluster is seen in three-quarter
 * perspective. An empty (or degenerate) cluster falls back to a global view.
 */
export function initialOrbitForMarkers(
  markers: readonly GlobeLatLng[],
  distance: number = GLOBE_DEFAULT_DISTANCE,
): GlobeOrbitState {
  const safeDistance = clampZoom(distance);
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;

  for (const marker of markers) {
    const point = latLngToVector3(marker.lat, marker.lng, 1);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
      continue;
    }
    x += point.x;
    y += point.y;
    z += point.z;
    count += 1;
  }

  const length = Math.hypot(x, y, z);
  if (count === 0 || !Number.isFinite(length) || length < 1e-9) {
    return {
      theta: GLOBE_FALLBACK_VIEW.theta,
      phi: GLOBE_FALLBACK_VIEW.phi,
      distance: safeDistance,
    };
  }

  return {
    theta: Math.atan2(x, z),
    phi: clampPitch(Math.acos(clamp(y / length, -1, 1)) - GLOBE_VIEW_TILT),
    distance: safeDistance,
  };
}

/** Distance the fly-to selection camera settles at (a gentle zoom-in). */
export const GLOBE_FLY_TO_DISTANCE = 190;
/** Tilt above the marker's horizon the fly-to camera settles at. */
export const GLOBE_FLY_TO_TILT = 0.14;

/**
 * Shortest signed path from `currentTheta` to `targetTheta` on the azimuth
 * circle, returned as an absolute theta the damped orbit can chase without
 * ever taking the long way around (or multi-turn spinning after drags).
 */
export function shortestOrbitTheta(currentTheta: number, targetTheta: number): number {
  if (!Number.isFinite(currentTheta) || !Number.isFinite(targetTheta)) return targetTheta;
  let delta = (targetTheta - currentTheta) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return currentTheta + delta;
}

/**
 * Orbit the camera should glide to so the selected ambassador sits centred
 * with a natural three-quarter viewing angle: azimuth/polar aim straight at
 * the marker, tilted slightly above its horizon, at a gently zoomed-in
 * distance. Pure maths — the scene damps toward the returned state.
 */
export function flyToMarker(
  marker: GlobeLatLng,
  currentDistance: number = GLOBE_DEFAULT_DISTANCE,
): GlobeOrbitState {
  const point = latLngToVector3(marker.lat, marker.lng, 1);
  const phi = Math.acos(clamp(point.y, -1, 1)) - GLOBE_FLY_TO_TILT;
  // Zoom in for focus, but never zoom out if the user is already closer.
  const distance = clampZoom(Math.min(clampZoom(currentDistance), GLOBE_FLY_TO_DISTANCE));
  return {
    theta: Math.atan2(point.x, point.z),
    phi: clampPitch(phi),
    distance,
  };
}

/**
 * Compensates a billboard marker for the camera distance: sprites already
 * shrink with perspective, so this keeps them legible when the camera pulls
 * back and stops them swamping the globe when it pushes in. Exactly 1 at the
 * default framing, `MARKER_SCALE_NEAR` at the closest zoom and
 * `MARKER_SCALE_FAR` at the furthest.
 */
export function markerScaleForDistance(distance: number): number {
  const safeDistance = clampZoom(distance);
  if (safeDistance <= GLOBE_DEFAULT_DISTANCE) {
    const t = (GLOBE_DEFAULT_DISTANCE - safeDistance) / (GLOBE_DEFAULT_DISTANCE - GLOBE_ZOOM_MIN);
    return 1 - t * (1 - MARKER_SCALE_NEAR);
  }
  const t = (safeDistance - GLOBE_DEFAULT_DISTANCE) / (GLOBE_ZOOM_MAX - GLOBE_DEFAULT_DISTANCE);
  return 1 + t * (MARKER_SCALE_FAR - 1);
}

/** Fades a marker out as it rotates around the horizon instead of popping. */
export function markerHorizonOpacity(facing: number): number {
  if (!Number.isFinite(facing)) return 1;
  const eased = clamp(facing / 0.35, 0, 1);
  return MARKER_HORIZON_FLOOR + (1 - MARKER_HORIZON_FLOOR) * eased;
}

/** Horizontal pixel overlap (CSS px) above which two name pills collide. */
export const BADGE_CULL_OVERLAP_PX = 4;
/** Vertical gap (CSS px) under which two name pills count as sharing a row. */
export const BADGE_CULL_VERTICAL_PX = 20;

/** A projected name-pill bounding box, in CSS pixels. */
export interface ScreenBadgeBox {
  /** Pill centre X, CSS pixels from the viewport's left edge. */
  x: number;
  /** Pill anchor Y, CSS pixels from the viewport's top edge. */
  y: number;
  /** Half the pill's projected width, CSS pixels. */
  halfWidthPx: number;
}

/**
 * True when two projected name pills would share screen pixels.
 *
 * A collision is an overlap of more than `BADGE_CULL_OVERLAP_PX` between the
 * pills' horizontal bounding boxes (centre ± half projected width) while their
 * vertical gap is under `BADGE_CULL_VERTICAL_PX`. Callers resolve a `true`
 * result by hiding the unselected pill, so no two name tags ever render on top
 * of one another. Non-finite input never reports a collision (nothing is
 * hidden on degenerate projections).
 */
export function badgeBoxesCollide(a: ScreenBadgeBox, b: ScreenBadgeBox): boolean {
  const horizontalOverlapPx = a.halfWidthPx + b.halfWidthPx - Math.abs(a.x - b.x);
  const verticalGapPx = Math.abs(a.y - b.y);
  return horizontalOverlapPx > BADGE_CULL_OVERLAP_PX
    && verticalGapPx < BADGE_CULL_VERTICAL_PX;
}

/** Applies a wheel event to the camera distance (positive delta pulls back). */
export function applyWheelZoom(distance: number, deltaY: number): number {
  const delta = Number.isFinite(deltaY) ? deltaY : 0;
  const bounded = clamp(delta, -GLOBE_WHEEL_MAX_DELTA, GLOBE_WHEEL_MAX_DELTA);
  return clampZoom(distance * Math.exp(bounded * GLOBE_WHEEL_SENSITIVITY));
}

/** Applies a pinch ratio (> 1 spreads the fingers) to the camera distance. */
export function applyPinchZoom(distance: number, ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return clampZoom(distance);
  return clampZoom(distance / ratio);
}

/** True when a pointer gesture travelled far enough to be an orbit, not a tap. */
export function pointerTravelExceeded(dxPixels: number, dyPixels: number): boolean {
  const dx = Number.isFinite(dxPixels) ? dxPixels : 0;
  const dy = Number.isFinite(dyPixels) ? dyPixels : 0;
  return Math.hypot(dx, dy) > CLICK_SLOP_PX;
}

/** Width of a marker's name pill, bounded so long names stay on the globe. */
export function labelWidthForText(text: string): number {
  const length = typeof text === 'string' ? text.length : 0;
  return clamp(length * MARKER_LABEL_CHAR_WIDTH, MARKER_LABEL_MIN_WIDTH, MARKER_LABEL_MAX_WIDTH);
}

/** Angles within +/- PI, used to keep idle-drift accumulation well conditioned. */
export function wrapAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  return ((((angle + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
}

// ---------------------------------------------------------------------------
// Multi-ambassador de-stacking (deterministic geographic jitter)
// ---------------------------------------------------------------------------

/** Ground distance (degrees) each fan-out ring step adds around a cluster. */
export const MARKER_JITTER_STEP_DEGREES = 2.2;
/** Radius (degrees) of the equilateral ring used to fan clusters of 3+ members. */
export const MARKER_CLUSTER_FAN_RADIUS_DEGREES = 3.8;
/** Two ambassadors within this ground distance are treated as sharing one spot. */
export const MARKER_JITTER_CLUSTER_DEGREES = 0.75;
/** Golden angle: successive spiral members never line up on a single ray. */
export const MARKER_JITTER_GOLDEN_ANGLE = 2.399963229728653;

/**
 * Formation radius (degrees) of a 2-member cluster: the two ambassadors stand
 * at opposite ends of a straight line through the centroid, so the pair reads
 * as a deliberate formation instead of one figure hiding the other. The end
 * points sit at half this distance, keeping the pair's separation exactly
 * `MARKER_JITTER_STEP_DEGREES` apart.
 */
export const MARKER_PAIR_LINE_DEGREES = MARKER_JITTER_STEP_DEGREES;
/**
 * Smallest ground chord allowed between neighbouring members of a cluster, so
 * a growing cluster widens its ring instead of crowding characters together.
 * Equal to the chord of the 3-member triangle at `MARKER_CLUSTER_FAN_RADIUS_DEGREES`.
 */
export const MARKER_CLUSTER_MIN_CHORD_DEGREES =
  2 * MARKER_CLUSTER_FAN_RADIUS_DEGREES * Math.sin(Math.PI / 3);
/** Ceiling on the adaptive fan radius: a huge cluster stays over its own city. */
export const MARKER_CLUSTER_MAX_FAN_RADIUS_DEGREES = 9;

/**
 * Distance ramp for cluster aggregation (camera distance in world units).
 * At/below `CLUSTER_AGGREGATE_NEAR_DISTANCE` every member is fully fanned out;
 * at/above `CLUSTER_AGGREGATE_FAR_DISTANCE` the cluster is fully collapsed into
 * its summary pill. Between the two the formation animates continuously.
 *
 * The window deliberately brackets the default framing (`GLOBE_DEFAULT_DISTANCE`
 * = 260 sits above `FAR`) so the opening view shows one crisp summary pill per
 * city with no half-faded cross-fade, while the selection fly-to
 * (`GLOBE_FLY_TO_DISTANCE` = 190 sits below `NEAR`) always lands on fully fanned
 * individuals wearing their name tags.
 */
export const CLUSTER_AGGREGATE_NEAR_DISTANCE = 205;
export const CLUSTER_AGGREGATE_FAR_DISTANCE = 255;

/** Per-layer opacity of the aggregation blend (all in [0, 1]). */
export interface ClusterLayerOpacities {
  /** Name-tag pills — fade out first, since they collide as members converge. */
  badge: number;
  /** Individual ambassadors — slide to the centroid and dissolve into the pill. */
  avatar: number;
  /** Aggregated summary pill — fades in as the members collapse. */
  summary: number;
}

/** Smooth 0 → 1 ramp of `value` across `[start, end]` (smoothstep-eased). */
export function smoothRamp(value: number, start: number, end: number): number {
  const span = end - start;
  if (!(span > 0)) return value >= end ? 1 : 0;
  const t = clamp((value - start) / span, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Splits the aggregation blend into per-layer opacities so exactly one layer is
 * legible at each end of the ramp and the handover happens as a dissolve rather
 * than two overlapping labels: name tags fade out first, the converging avatars
 * follow, and the summary pill fades in last. A standalone marker never
 * aggregates, so callers pass `0` for it and keep every layer fully visible.
 */
export function clusterLayerOpacities(aggregation: number): ClusterLayerOpacities {
  const value = Number.isFinite(aggregation) ? clamp(aggregation, 0, 1) : 0;
  return {
    badge: 1 - smoothRamp(value, 0.02, 0.35),
    avatar: 1 - smoothRamp(value, 0.4, 0.85),
    summary: smoothRamp(value, 0.5, 0.92),
  };
}

/** Label metrics for the aggregated summary pill (wider than a name tag). */
export const CLUSTER_LABEL_CHAR_WIDTH = 1.5;
export const CLUSTER_LABEL_MIN_WIDTH = 16;
export const CLUSTER_LABEL_MAX_WIDTH = 34;
/**
 * Screen-space clamp (CSS px) for the aggregated summary pill. It is a wider
 * and taller layer than a name tag, so it gets its own readability floor and
 * ceiling while sharing the same boost/cap mechanism.
 */
export const CLUSTER_PILL_SCREEN_MIN_PX = 18;
export const CLUSTER_PILL_SCREEN_MAX_PX = 30;

/** One de-stacking cluster: its running centroid and member payload indexes. */
interface Cluster { lat: number; lng: number; members: number[] }

/**
 * Approximate ground distance in degrees between two coordinates on the
 * sphere: latitude in degrees, longitude compressed by the cosine of the mean
 * latitude. Cheap, monotonic in true angular distance, and dependency-free —
 * the right primitive for proximity grouping at city scale.
 */
export function markerGroundDistance(a: GlobeLatLng, b: GlobeLatLng): number {
  const latMid = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  return Math.hypot(a.lat - b.lat, (a.lng - b.lng) * Math.max(0.1, Math.cos(latMid)));
}

/**
 * Groups markers whose ground distance to an existing cluster centroid stays
 * within the merge radius. Cluster order follows the stable server payload.
 */
function buildClusters(markers: readonly GlobeMarker[]): Cluster[] {
  const clusters: Cluster[] = [];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const cluster = clusters.find((candidate) => (
      markerGroundDistance(candidate, marker) <= MARKER_JITTER_CLUSTER_DEGREES
    ));
    if (cluster) {
      const size = cluster.members.length;
      cluster.lat = (cluster.lat * size + marker.lat) / (size + 1);
      cluster.lng = (cluster.lng * size + marker.lng) / (size + 1);
      cluster.members.push(index);
    } else {
      clusters.push({ lat: marker.lat, lng: marker.lng, members: [index] });
    }
  }
  return clusters;
}

/**
 * Rank a cluster's members by hashed id so payload order can never change who
 * stands where; the tiebreak keeps the sort totally deterministic.
 */
function orderedClusterMembers(markers: readonly GlobeMarker[], cluster: Cluster): number[] {
  return [...cluster.members].sort((a, b) => {
    const byHash = markerHashForId(markers[a].id) - markerHashForId(markers[b].id);
    return byHash !== 0 ? byHash : markers[a].id.localeCompare(markers[b].id);
  });
}

/** FNV-1a 32-bit hash of a marker id — stable across sessions and processes. */
export function markerHashForId(id: string): number {
  let hash = 0x811c9dc5;
  const text = typeof id === 'string' ? id : '';
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministically assigns a marker to one of the four sprite sheets. */
export function avatarSpriteVariantForId(id: string): 0 | 1 | 2 | 3 {
  return (markerHashForId(id) % 4) as 0 | 1 | 2 | 3;
}

/** Lower-case substrings in a marker role/title that pin the pastor sheet. */
const PASTOR_ROLE_KEYWORDS = ['pastor', 'father', 'priest'] as const;
/** Lower-case substrings in a marker role/title that pin the kid sheet. */
const KID_ROLE_KEYWORDS = ['kid', 'child', 'youth'] as const;

/**
 * Known female first names that pin the female sprite sheet. Matched exactly
 * against the normalised first name (never substring-matched, so "Sandra" can
 * never collide with "Sarah").
 */
const FEMALE_NAME_CUES = new Set([
  'sarah', 'mary', 'ruth', 'esther', 'deborah', 'hannah', 'abigail', 'naomi',
  'grace', 'faith', 'joy', 'mercy', 'lydia', 'priscilla', 'phoebe', 'tabitha',
  'anna', 'elizabeth', 'miriam', 'rachel', 'rebecca', 'leah', 'martha',
  'joanna', 'susanna', 'eunice', 'emma', 'olivia', 'sophia', 'isabella',
  'charlotte', 'amelia', 'zuri', 'adaeze', 'chidinma', 'ana',
]);

/**
 * Known male first names that pin the male sprite sheet (exact match, see
 * `FEMALE_NAME_CUES`).
 */
const MALE_NAME_CUES = new Set([
  'marcus', 'david', 'john', 'james', 'joseph', 'peter', 'paul', 'andrew',
  'philip', 'thomas', 'matthew', 'simon', 'stephen', 'nathaniel', 'samuel',
  'elijah', 'elias', 'isaiah', 'jeremiah', 'joshua', 'caleb', 'gideon',
  'moses', 'aaron', 'abraham', 'isaac', 'jacob', 'daniel', 'micah', 'jonah',
  'noah', 'ethan', 'lucas', 'luke', 'timothy', 'titus', 'silas', 'felix',
  'cornelius', 'victor', 'gabriel', 'michael', 'elisha', 'amos', 'joel',
  'malachi', 'ezra', 'nehemiah', 'mordecai',
]);

/** Normalises a first name for gender-cue lookup: trimmed, lower-cased. */
function normalizeNameCue(firstName: string | null | undefined): string {
  return typeof firstName === 'string' ? firstName.trim().toLowerCase() : '';
}

/**
 * Deterministic sheet selection for a marker, most explicit cue wins:
 *
 * 1. a clergy role/title pins the pastor sheet — unless the first name is a
 *    known female name, because the pastor sheet is male-coded (a female
 *    pastor wears the female sheet instead); clergy also outranks youth when
 *    both keyword groups appear in one title;
 * 2. a children / youth role/title pins the gender-ambiguous kid sheet;
 * 3. a known female first name pins the female sheet;
 * 4. a known male first name pins the male sheet;
 * 5. otherwise the stable FNV-1a id hash spreads anonymous markers across all
 *    four sheets (0 male, 1 female, 2 pastor, 3 kid).
 */
export function avatarVariantForMarker(
  id: string,
  role: string | null | undefined,
  firstName?: string | null,
): 0 | 1 | 2 | 3 {
  const text = typeof role === 'string' ? role.toLowerCase() : '';
  const nameCue = normalizeNameCue(firstName);
  const isKnownFemale = FEMALE_NAME_CUES.has(nameCue);
  const isKnownMale = MALE_NAME_CUES.has(nameCue);
  if (
    !isKnownFemale &&
    PASTOR_ROLE_KEYWORDS.some((keyword) => text.includes(keyword))
  ) {
    // Clergy outranks youth when both keyword groups appear in one title.
    return 2;
  }
  if (KID_ROLE_KEYWORDS.some((keyword) => text.includes(keyword))) return 3;
  if (isKnownFemale) return 1;
  if (isKnownMale) return 0;
  return avatarSpriteVariantForId(id);
}

/**
 * One geographic cluster with its formation geometry resolved. Everything the
 * renderer (and the tests) need in order to draw an aggregated summary pill and
 * fan the members out is derived here, so no trigonometry lives in the three.js
 * module.
 */
export interface GlobeMarkerCluster {
  /** Position of the cluster in the stable server payload order. */
  index: number;
  /** Geographic mean of the members' coordinates (degrees). */
  centroid: GlobeLatLng;
  /** Payload indexes of the members, ranked deterministically (slot order). */
  members: number[];
  /** Member marker ids in formation-slot order. */
  memberIds: string[];
  /** Member count (1 for a standalone ambassador). */
  count: number;
  /** Angular step between adjacent members on the formation ring (radians). */
  ringStep: number;
  /** Deterministic formation rotation (radians), derived from the lead id. */
  ringPhase: number;
  /** Formation radius (degrees); 0 for a standalone marker. */
  fanRadiusDegrees: number;
  /** Summary-pill copy: `{City} • {N} Gatherings` (accessible single line). */
  label: string;
  /** Summary-pill copy split into its two drawn lines. */
  lines: ClusterPillLines;
  /** Summary-pill width in world units (fits the widest line). */
  width: number;
  /** City shared by the members (the summary pill's headline). */
  city: string;
  /** True when the cluster holds exactly one marker. */
  standalone: boolean;
}

/**
 * Angular step between adjacent members of an N-member formation: exactly
 * `2π / N`, so a cluster always fans into a regular spherical polygon — a line
 * for 2, a triangle for 3, a square for 4, and so on. Non-finite input degrades
 * to a single step of 0 rather than producing NaNs.
 */
export function clusterAngleForSlot(
  count: number,
  slot: number,
  phaseRadians = 0,
): number {
  const total = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1));
  const phase = Number.isFinite(phaseRadians) ? phaseRadians : 0;
  const safeSlot = Number.isFinite(slot) ? slot : 0;
  return phase + (safeSlot * Math.PI * 2) / total;
}

/** Every slot angle of an N-member formation, uniformly spaced by `2π / N`. */
export function clusterDistributionAngles(count: number, phaseRadians = 0): number[] {
  const total = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1));
  return Array.from(
    { length: total },
    (_, slot) => clusterAngleForSlot(total, slot, phaseRadians),
  );
}

/**
 * Adaptive formation radius (degrees) for an N-member cluster: the smallest
 * radius that still gives neighbouring members `MARKER_CLUSTER_MIN_CHORD_DEGREES`
 * of elbow room (`chord = 2R·sin(π/N)`), floored at the 3-member triangle
 * radius so small clusters stay tight and capped so a very large cluster still
 * reads as one city. Counts below 2 have no formation (radius 0).
 */
export function clusterFanRadiusDegrees(count: number): number {
  if (!Number.isFinite(count) || count < 2) return 0;
  if (count === 2) return MARKER_PAIR_LINE_DEGREES / 2;
  const needed = MARKER_CLUSTER_MIN_CHORD_DEGREES / (2 * Math.sin(Math.PI / count));
  return Math.min(
    Math.max(needed, MARKER_CLUSTER_FAN_RADIUS_DEGREES),
    MARKER_CLUSTER_MAX_FAN_RADIUS_DEGREES,
  );
}

/**
 * Projects one formation slot onto the sphere around a centroid: angle
 * `phase + slot·2π/N` at the cluster's fan radius, with longitude compressed by
 * the centroid's latitude so the polygon stays regular in *ground* distance
 * rather than in raw degrees.
 */
export function polygonSlotLatLng(
  centroid: GlobeLatLng,
  slot: number,
  count: number,
  phaseRadians: number,
  radiusDegrees: number,
): GlobeLatLng {
  const angle = clusterAngleForSlot(count, slot, phaseRadians);
  const radius = Number.isFinite(radiusDegrees) ? radiusDegrees : 0;
  const latRadians = (centroid.lat * Math.PI) / 180;
  const lngScale = Math.max(0.1, Math.cos(latRadians));
  return {
    lat: clamp(centroid.lat + radius * Math.cos(angle), -85, 85),
    lng: centroid.lng + (radius * Math.sin(angle)) / lngScale,
  };
}

/** Normalises a marker's city into a non-empty pill headline. */
function cityLabel(city: string | null | undefined): string {
  return typeof city === 'string' && city.trim() !== '' ? city.trim() : 'This city';
}

/** Total a count resolves to for display purposes (never below one). */
function countableTotal(count: number): number {
  return Math.max(1, Math.floor(Number.isFinite(count) ? count : 1));
}

/**
 * Summary-pill copy for an aggregated cluster: `{City} • {N} Gatherings`
 * (singular for a lone gathering). A missing city falls back to a neutral
 * phrase so the pill is never blank. Used as the single-line accessible name.
 */
export function clusterSummaryLabel(city: string | null | undefined, count: number): string {
  const total = countableTotal(count);
  return cityLabel(city) + ' • ' + total + ' Gathering' + (total === 1 ? '' : 's');
}

/** The two lines of an aggregated summary pill (headline + count). */
export interface ClusterPillLines {
  /** City name, drawn bold — matches the name tag's headline slot. */
  headline: string;
  /** `N Gatherings`, drawn muted — matches the name tag's subline slot. */
  subline: string;
}

/**
 * Splits the summary copy into the two short lines the pill actually draws, so
 * the pill keeps the name tag's two-line design language (bold headline over a
 * muted subline) instead of one very wide banner that would swamp the globe.
 */
export function clusterPillLines(
  city: string | null | undefined,
  count: number,
): ClusterPillLines {
  const total = countableTotal(count);
  return {
    headline: cityLabel(city),
    subline: total + ' Gathering' + (total === 1 ? '' : 's'),
  };
}

/** Pill width (world units) for a summary label, bounded like the name tags. */
export function clusterLabelWidthForText(text: string): number {
  const length = typeof text === 'string' ? text.length : 0;
  return clamp(length * CLUSTER_LABEL_CHAR_WIDTH, CLUSTER_LABEL_MIN_WIDTH, CLUSTER_LABEL_MAX_WIDTH);
}

/**
 * Pill width (world units) for a two-line summary: measured from its *widest*
 * line, so a long city name and a long count both fit without the canvas
 * squeezing either line horizontally.
 */
export function clusterPillWidth(lines: ClusterPillLines): number {
  const headline = typeof lines?.headline === 'string' ? lines.headline : '';
  const subline = typeof lines?.subline === 'string' ? lines.subline : '';
  return clusterLabelWidthForText(
    headline.length >= subline.length ? headline : subline,
  );
}

/**
 * How far a cluster has collapsed into its summary pill, as a smooth 0 → 1 ramp
 * over the camera-distance window: 0 when the camera is close enough for the fan
 * to be fully open (individual ambassadors and their name tags), 1 when it is
 * far enough that the cluster is a single summary pill. Smoothstep easing means
 * the transition has no visible start or stop.
 */
export function clusterAggregationForDistance(distance: number): number {
  const safeDistance = clampZoom(distance);
  const span = CLUSTER_AGGREGATE_FAR_DISTANCE - CLUSTER_AGGREGATE_NEAR_DISTANCE;
  if (!(span > 0)) return safeDistance >= CLUSTER_AGGREGATE_FAR_DISTANCE ? 1 : 0;
  const t = clamp((safeDistance - CLUSTER_AGGREGATE_NEAR_DISTANCE) / span, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Dynamic N-marker geographic clustering: partitions markers by angular
 * proximity (`MARKER_JITTER_CLUSTER_DEGREES` around a running centroid) and
 * resolves each group's centroid, formation geometry and summary copy.
 *
 * - Singleton clusters are standalone ambassadors (`standalone: true`).
 * - Clusters of N > 1 get a regular polygon: a line for 2, a triangle for 3,
 *   and a uniform circle for 4+ whose radius adapts to keep members apart.
 *
 * Deterministic: cluster membership follows the stable server payload order and
 * slots are ranked by hashed marker id, so a payload reshuffle can never change
 * who stands where.
 */
export function groupMarkerClusters(
  markers: readonly GlobeMarker[],
): GlobeMarkerCluster[] {
  return buildClusters(markers).map((cluster, index) => {
    const ordered = orderedClusterMembers(markers, cluster);
    const count = ordered.length;
    const leader = markers[ordered[0]];
    const lines = clusterPillLines(leader.city, count);
    return {
      index,
      // Geographic mean of the members' coordinates.
      centroid: { lat: cluster.lat, lng: cluster.lng },
      members: ordered,
      memberIds: ordered.map((memberIndex) => markers[memberIndex].id),
      count,
      ringStep: (Math.PI * 2) / Math.max(1, count),
      ringPhase: ((markerHashForId(leader.id) % 360) * Math.PI) / 180,
      fanRadiusDegrees: clusterFanRadiusDegrees(count),
      city: leader.city,
      label: clusterSummaryLabel(leader.city, count),
      lines,
      width: clusterPillWidth(lines),
      standalone: count === 1,
    };
  });
}


/**
 * Fans out ambassadors that share (or nearly share) a location so storybook
 * characters in the same city stand alongside each other instead of stacking on
 * the exact same vector (which z-fights the sprites and strobes their name tags
 * while the globe rotates).
 *
 * Every member is placed on its cluster's regular spherical polygon — angle
 * `ringPhase + slot·2π/N` at that cluster's adaptive radius (see
 * `groupMarkerClusters`) — so a pair forms a line, a trio a triangle and larger
 * groups a uniform circle. Standalone markers keep their exact coordinates, so
 * this is a pure de-stacking pass that never moves a lone ambassador.
 */
export function distributeMarkerPositions(
  markers: readonly GlobeMarker[],
): GlobeLatLng[] {
  const positions: GlobeLatLng[] = markers.map((marker) => ({
    lat: marker.lat,
    lng: marker.lng,
  }));

  for (const cluster of groupMarkerClusters(markers)) {
    if (cluster.standalone) continue;
    cluster.members.forEach((memberIndex, slot) => {
      positions[memberIndex] = polygonSlotLatLng(
        cluster.centroid,
        slot,
        cluster.count,
        cluster.ringPhase,
        cluster.fanRadiusDegrees,
      );
    });
  }

  return positions;
}
