/**
 * 3D Globe Math Foundation (Phase 2 — Task 3.1).
 *
 * Pure, dependency-free spherical math shared by the WebGL globe renderer and
 * the privacy-preserving gathering marker layer. Nothing here touches `window`,
 * `document` or `THREE` at module-evaluation time, so it is safe on the server
 * (RSC/Turbopack), in the browser bundle, and inside the `node:test` sandbox.
 *
 * Coordinate convention (right-handed, Y-up Three.js scene):
 * - `+Y` is the North Pole; latitude is degrees, positive north.
 * - The Equator lies in the X/Z plane.
 * - The Prime Meridian (lat 0, lng 0) points along `+Z`.
 * - Longitude grows eastward: 90°E points along `+X`, 180° along `-Z`.
 *
 * A textured `THREE.SphereGeometry` must therefore be rotated by -90° about Y
 * (or its equirectangular texture laid out with the 0° column on `+Z`) before
 * its imagery lines up with these marker coordinates.
 */

/** Default globe render radius in Three.js world units. */
export const GLOBE_BASE_RADIUS = 100;

/**
 * Maximum deterministic drift applied to a protected location, in degrees per
 * axis. 0.015° is ~1.7km, so a jittered centroid always stays within ~2.4km of
 * the true address while never revealing it.
 */
export const MAX_CENTROID_JITTER_DEGREES = 0.015;

const DEG2RAD = Math.PI / 180;
const EPSILON = 1e-6;
const COORDINATE_PRECISION = 6;

export interface GlobeVector3 {
  x: number;
  y: number;
  z: number;
}

export interface GlobeLatLng {
  lat: number;
  lng: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toFiniteNumber(value: number, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Normalises a longitude into [-180, 180]. */
function wrapLongitude(longitude: number): number {
  if (longitude <= 180 && longitude >= -180) return longitude;
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

/**
 * Converts spherical coordinates in degrees into 3D Cartesian coordinates on a
 * sphere of `radius` centred at the origin (see the module header for the
 * orientation). Out-of-range / non-finite values are clamped and never throw.
 */
export function latLngToVector3(
  lat: number,
  lng: number,
  radius: number = GLOBE_BASE_RADIUS,
): GlobeVector3 {
  const safeRadius = Number.isFinite(radius) ? radius : GLOBE_BASE_RADIUS;
  const latitude = clamp(toFiniteNumber(lat), -90, 90) * DEG2RAD;
  const longitude = toFiniteNumber(lng) * DEG2RAD;
  const ringRadius = safeRadius * Math.cos(latitude);

  return {
    x: ringRadius * Math.sin(longitude),
    y: safeRadius * Math.sin(latitude),
    z: ringRadius * Math.cos(longitude),
  };
}

function normalize(vector: GlobeVector3): GlobeVector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length === 0 || !Number.isFinite(length)) return { x: 0, y: 0, z: 0 };
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function cross(left: GlobeVector3, right: GlobeVector3): GlobeVector3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

/** Rodrigues rotation of a vector around a unit axis (used for antipodes). */
function rotateAroundAxis(vector: GlobeVector3, axis: GlobeVector3, angle: number): GlobeVector3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = vector.x * axis.x + vector.y * axis.y + vector.z * axis.z;
  const axisCrossVector = cross(axis, vector);

  return normalize({
    x: vector.x * cos + axisCrossVector.x * sin + axis.x * dot * (1 - cos),
    y: vector.y * cos + axisCrossVector.y * sin + axis.y * dot * (1 - cos),
    z: vector.z * cos + axisCrossVector.z * sin + axis.z * dot * (1 - cos),
  });
}

/**
 * Builds the control points of an elevated great-circle arc between two
 * locations — the path an intercession light beam travels above the sphere.
 *
 * Points are spherical-linear-interpolated along the shortest great circle and
 * lifted by a sine arch: exactly `GLOBE_BASE_RADIUS` at both endpoints, peaking
 * at `GLOBE_BASE_RADIUS * altitude` at the midpoint. Coincident and antipodal
 * pairs are handled without producing NaN geometry.
 */
export function calculateGreatCircleSpline(
  p1: GlobeLatLng,
  p2: GlobeLatLng,
  altitude = 1.25,
  pointsCount = 30,
): GlobeVector3[] {
  const count = Math.max(2, Math.floor(toFiniteNumber(pointsCount, 30)));
  const archAltitude = Math.max(1, toFiniteNumber(altitude, 1.25));

  const start = latLngToVector3(p1.lat, p1.lng, 1);
  const end = latLngToVector3(p2.lat, p2.lng, 1);
  const dot = clamp(start.x * end.x + start.y * end.y + start.z * end.z, -1, 1);
  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);
  const antipodal = dot < 0 && sinOmega < EPSILON;
  const spinAxis = antipodal
    ? normalize(
        cross(start, Math.abs(start.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }),
      )
    : null;

  const points: GlobeVector3[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    let direction: GlobeVector3;

    if (spinAxis) {
      direction = rotateAroundAxis(start, spinAxis, Math.PI * t);
    } else if (sinOmega < EPSILON) {
      direction = { x: start.x, y: start.y, z: start.z };
    } else {
      const startWeight = Math.sin((1 - t) * omega) / sinOmega;
      const endWeight = Math.sin(t * omega) / sinOmega;
      direction = normalize({
        x: start.x * startWeight + end.x * endWeight,
        y: start.y * startWeight + end.y * endWeight,
        z: start.z * startWeight + end.z * endWeight,
      });
    }

    const elevation = 1 + (archAltitude - 1) * Math.sin(Math.PI * t);
    const radius = GLOBE_BASE_RADIUS * elevation;
    points.push({
      x: direction.x * radius,
      y: direction.y * radius,
      z: direction.z * radius,
    });
  }

  return points;
}

/** FNV-1a 32-bit hash: stable across renders, sessions and processes. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Maps a 16-bit hash slice onto the [-1, 1] range. */
function signedUnit(value: number): number {
  return (value / 0xffff) * 2 - 1;
}

/**
 * Replaces an exact (private) location with a deterministic centroid.
 *
 * The seed is the row id, so every re-render of the same gathering lands on the
 * exact same spot, while the true street address is never recoverable from the
 * payload. Each axis drifts by at most `MAX_CENTROID_JITTER_DEGREES`, which
 * keeps the marker within ~2.4km of the original point.
 */
export function sanitizeToCentroidWithJitter(
  lat: number,
  lng: number,
  seedString: string,
): GlobeLatLng {
  const latitude = clamp(toFiniteNumber(lat), -90, 90);
  const longitude = toFiniteNumber(lng);
  const seed = typeof seedString === 'string' ? seedString : String(seedString ?? '');
  const hash = hashSeed(seed);

  const latitudeOffset = signedUnit(hash & 0xffff) * MAX_CENTROID_JITTER_DEGREES;
  const longitudeOffset = signedUnit((hash >>> 16) & 0xffff) * MAX_CENTROID_JITTER_DEGREES;

  return {
    lat: round(clamp(latitude + latitudeOffset, -90, 90), COORDINATE_PRECISION),
    lng: round(wrapLongitude(longitude + longitudeOffset), COORDINATE_PRECISION),
  };
}