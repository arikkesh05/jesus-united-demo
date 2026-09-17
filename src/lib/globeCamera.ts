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

/** A camera/orbit snapshot: azimuth, polar angle and radial distance. */
export interface GlobeOrbitState {
  theta: number;
  phi: number;
  distance: number;
}

/** Closest the camera may approach the globe surface (radius 100). */
export const GLOBE_ZOOM_MIN = 130;
/** Furthest the camera may pull back while keeping the globe readable. */
export const GLOBE_ZOOM_MAX = 400;
/** Comfortable framing used on first paint and for unusable zoom values. */
export const GLOBE_DEFAULT_DISTANCE = 260;
/** Camera field of view in degrees. */
export const GLOBE_FOV = 42;

/** Pitch window: never quite the poles, so the horizon can never flip. */
export const GLOBE_PITCH_MIN = 0.22;
export const GLOBE_PITCH_MAX = Math.PI - GLOBE_PITCH_MIN;

/** Frame-rate-independent easing rates (higher eases faster). */
export const GLOBE_DAMPING_LAMBDA = 9;
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