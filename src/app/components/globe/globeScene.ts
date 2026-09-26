/**
 * Mission Globe — three.js scene engine (Phase 2 — Task 3.3: Refero cinematic).
 *
 * Imported ONLY through a dynamic import() from inside a client effect (see
 * MissionGlobe.tsx), so three is never evaluated during SSR or static
 * prerender and the WebGL canvas can never break the server-rendered HTML.
 *
 * Cinematic Refero design (docs/design/REFERO_MOTION_SPEC.md):
 * - Deep-space black viewport (#000000) with a twinkling micro-starfield.
 * - Photorealistic Earth: blue-marble day albedo, emissive night lights,
 *   topology bump, warm sun + camera fill + ambient floor so no hemisphere
 *   ever renders pitch-black, plus an electric cyan Fresnel atmosphere shell
 *   (radius * 1.04, additive).
 * - Standing transparent PNG character sprites (male/female/pastor/kid, chosen
 *   by role keywords then a deterministic id hash, co-located ambassadors
 *   fanned out on equilateral rings), each crowned by its own white speech
 *   pill carrying First Name + City, pinned above the head at every latitude.
 *
 * Coordinate contract: markers use latLngToVector3 (+Y = North Pole,
 * Equator in X/Z, Prime Meridian on +Z). The earth sphere is rotated -90
 * degrees about Y to line up equirectangular textures with those coords.
 *
 * Every GPU resource is registered with a disposal registry so dispose()
 * releases all geometries, materials, textures, canvas textures, event
 * listeners, the ResizeObserver and the animation frame.
 */

import * as THREE from "three";

import { GLOBE_BASE_RADIUS, latLngToVector3 } from "@/lib/globe";
import { normalizeMarkerName } from "@/lib/globeAvatars";
import {
  applyOrbitDrag,
  applyPinchZoom,
  applyWheelZoom,
  avatarVariantForMarker,
  badgeBoxesCollide,
  CLUSTER_PILL_SCREEN_MAX_PX,
  CLUSTER_PILL_SCREEN_MIN_PX,
  clusterAggregationForDistance,
  clusterLayerOpacities,
  clampPitch,
  clampZoom,
  distributeMarkerPositions,
  flyToMarker,
  GLOBE_FOV,
  GLOBE_IDLE_SPIN_SPEED,
  groupMarkerClusters,
  initialOrbitForMarkers,
  labelWidthForText,
  MARKER_BASE_SIZE,
  MARKER_LABEL_HEIGHT,
  markerHorizonOpacity,
  markerScaleForDistance,
  orbitToPosition,
  pointerTravelExceeded,
  shortestOrbitTheta,
  stepOrbit,
  type ClusterPillLines,
  type GlobeMarkerCluster,
  type GlobeOrbitState,
} from "@/lib/globeCamera";
import type { GlobeMarker } from "@/lib/types";

// ---------------------------------------------------------------------------
// Refero cinematic tokens
// ---------------------------------------------------------------------------
const REFERO = {
  space: "#000000",
  sun: "#fff8e7",
  ambient: "#1e293b",
  ocean: "#163c58",
  atmosNear: "#38bdf8",
  atmosFar: "#60a5fa",
  starNear: "#ffffff",
  starFar: "#94a3b8",
  // JesusUnited map parity: high-contrast white speech pill, dark slate
  // typography (>= 4.5:1 on white), hairline border and one soft shadow.
  badge: "#ffffff",
  badgeText: "#0F172A",
  badgeMuted: "#475569",
  badgeBorder: "rgba(0, 0, 0, 0.08)",
  badgeShadow: "rgba(15, 23, 42, 0.18)",
  accent: "#38bdf8",
} as const;

const SUN_COLOR = 0xfff8e7;
const AMBIENT_COLOR = 0x1e293b;

// Geometry / rendering constants
const EARTH_WIDTH_SEGMENTS = 64;
const EARTH_HEIGHT_SEGMENTS = 48;
const ATMOSPHERE_SCALE = 1.04;
const BUMP_SCALE = 2.5;
/** Fallback width/height used until a sheet's true pixel size has decoded. */
const AVATAR_FALLBACK_ASPECT = 1.5;
/** On-screen height (world units) of a standing avatar at reference zoom. */
const AVATAR_BASE_HEIGHT = MARKER_BASE_SIZE;
const LABEL_CANVAS_HEIGHT = 112;

/** Transparent PNG character sheets served from /public. Indexed by variant:
 *  0 male, 1 female, 2 pastor, 3 kid. */
const AVATAR_SHEET_URLS: readonly [string, string, string, string] = [
  "/assets/avatars/avatar-male.png",
  "/assets/avatars/avatar-female.png",
  "/assets/avatars/avatar-pastor.png",
  "/assets/avatars/avatar-kid.png",
];

const TEXTURE_BASE = "/assets/globe/";
const DAY_MAP_URL = TEXTURE_BASE + "earth-blue-marble.jpg";
const NIGHT_MAP_URL = TEXTURE_BASE + "earth-night.jpg";
const BUMP_MAP_URL = TEXTURE_BASE + "earth-topology.png";

const AVATAR_LIFT = 4.2;
/** Uniform world-space clearance between the crown and the pill anchor. */
const BADGE_CROWN_GAP = 1.6;
/** Compact pill: 40% below the raw label metrics (JesusUnited map parity). */
const BADGE_COMPACT_SCALE = 0.6;
/** Screen-space badge clamp (CSS px): readability floor at far zoom... */
const BADGE_SCREEN_MIN_PX = 16;
/** ...compact ceiling of 26px so pills stay small and unobtrusive. */
const BADGE_SCREEN_MAX_PX = 26;
/** Hard cap on the far-zoom compensation multiplier. */
const BADGE_BOOST_MAX = 2.4;
/** Extra screen-space lift above the crown, in fractions of the pill height. */
const BADGE_CROWN_LIFT = 0.4;
/** Pre-computed tan of half the vertical FOV for px-per-world-unit maths. */
const TAN_HALF_FOV = Math.tan(((GLOBE_FOV / 2) * Math.PI) / 180);
/** Radius (world units) of the soft selection ground disc under the feet. */
const SELECTION_GROUND_DISC_RADIUS = 7.2;
/** Fraction of the disc radius where the warm halo yields to contact shadow. */
const SELECTION_DISC_SHADOW_STOP = 0.42;
/** Gentle scale lift applied to the selected marker's speech badge. */
const SELECTION_BADGE_LIFT = 1.08;
/** Transparent margin kept on each side of a badge canvas (fraction of its
 *  height). Shared with the collision guard so the guard measures the painted
 *  pill, never the invisible canvas margin. */
const BADGE_PILL_INSET_RATIO = 0.1;
/** Tiny lift (world units) keeping the ground disc just off the sphere. */
const SELECTION_DISC_LIFT = 0.08;
/** Height (world units) of the aggregated summary pill at reference zoom. */
const CLUSTER_PILL_HEIGHT = 5.4;
/** Screen-space lift of the summary pill above the centroid, in pill heights. */
const CLUSTER_PILL_LIFT = 1.5;
/** Below this opacity a layer is treated as gone: not drawn, not pickable, and
 *  not a collision candidate. */
const LAYER_VISIBLE_EPSILON = 0.01;

const STAR_COUNT = 1200;
const STAR_MIN_RADIUS = 500;
const STAR_MAX_RADIUS = 950;
const STAR_BASE_SIZE = 0.8;

const IDLE_RESUME_MS = 2600;
const MAX_FRAME_DELTA = 0.05;

const FORWARD = new THREE.Vector3(0, 0, 1);
const TEXTURE_MAP_KEYS = [
  "map",
  "alphaMap",
  "emissiveMap",
  "normalMap",
  "displacementMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "envMap",
] as const;

const SUN_INTENSITY = 2.2;
/** Lifted so the night hemisphere keeps its continents readable, never pitch-black. */
const AMBIENT_INTENSITY = 0.7;
/** Cyan Fresnel rim strength against deep space. */
const ATMOSPHERE_INTENSITY = 1.15;
/**
 * The sun is placed on the camera's opening orbit ring, rotated this far in
 * azimuth: the first framing is lit from front-of-shoulder so the visible
 * continents read crisply and only the far hemisphere falls into night.
 */
const SUN_AZIMUTH_OFFSET = 0.42;
const SUN_DISTANCE = 1500;

// ---------------------------------------------------------------------------
// GlobeScene interfaces
export interface GlobeSceneOptions {
  markers: readonly GlobeMarker[];
  reducedMotion?: boolean;
  onSelectMarker?: (marker: GlobeMarker | null) => void;
  onHoverMarker?: (markerId: string | null) => void;
}

export interface GlobeSceneHandle {
  selectMarker(markerId: string | null): void;
  nudgeOrbit(deltaTheta: number, deltaPhi: number): void;
  nudgeZoom(factor: number): void;
  resetView(): void;
  /** Live-syncs the user's reduced-motion preference without rebuilding the scene. */
  setReducedMotion(enabled: boolean): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// GLSL — Earth day/night shader
const EARTH_VERTEX_SHADER = /* glsl */ `
  uniform sampler2D bumpMap;
  uniform float bumpScale;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  void main() {
    vUv = uv;
    float height = texture2D(bumpMap, uv).r;
    vec3 displaced = position + normal * height * bumpScale;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vWorldPosition = (modelMatrix * vec4(displaced, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;
const EARTH_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform vec3 sunDirection;
  uniform float ambientIntensity;
  uniform float sunIntensity;
  uniform vec3 sunColor;
  uniform float nightGlow;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  void main() {
    vec3 normal = normalize(vNormal);
    float dayFactor = dot(normal, sunDirection);
    vec3 dayColor = texture2D(dayMap, vUv).rgb;
    vec3 nightColor = texture2D(nightMap, vUv).rgb;
    float sunLight = max(dayFactor, 0.0) * sunIntensity;
    float nightFactor = 1.0 - smoothstep(-0.15, 0.0, dayFactor);
    // Camera-direction fill: rotated regions never dip into total darkness.
    float fillLight = max(dot(normal, normalize(cameraPosition - vWorldPosition)), 0.0) * 0.35;
    // Ambient floor keeps the dark hemisphere readable while the sun term
    // stays dominant on the day side, carving a crisp terminator.
    vec3 shade = max(vec3(ambientIntensity) * 0.62 + vec3(fillLight), sunColor * sunLight);
    vec3 color = dayColor * shade + nightColor * nightGlow * nightFactor;
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;
// Atmosphere + Star shaders
const ATMOSPHERE_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  void main() {
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ATMOSPHERE_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 cameraPos;
  uniform vec3 colorMin;
  uniform vec3 colorMax;
  uniform float intensity;
  uniform float time;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  void main() {
    vec3 viewDir = normalize(cameraPos - vWorldPosition);
    float fresnel = 1.0 - abs(dot(normalize(vWorldNormal), viewDir));
    fresnel = pow(fresnel, 1.5);
    vec3 color = mix(colorMin, colorMax, fresnel * fresnel);
    float fade = fresnel * (0.6 + 0.4 * sin(time * 0.3));
    gl_FragColor = vec4(color, fade * intensity);
    #include <colorspace_fragment>
  }
`;

const STAR_VERTEX_SHADER = /* glsl */ `
  attribute float size;
  attribute float phase;
  attribute float twinkle;
  varying float vTwinkle;
  void main() {
    vTwinkle = twinkle;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(size * (800.0 / max(1.0, -mvPosition.z)), 1.0, 2.5);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const STAR_FRAGMENT_SHADER = /* glsl */ `
  uniform float time;
  uniform vec3 colorNear;
  uniform vec3 colorFar;
  varying float vTwinkle;
  void main() {
    float radius = length(gl_PointCoord - vec2(0.5));
    float alpha = (1.0 - smoothstep(0.1, 0.5, radius))
      * (0.4 + 0.15 * sin(time * 0.6 + vTwinkle));
    gl_FragColor = vec4(mix(colorFar, colorNear, 0.5), alpha);
    #include <colorspace_fragment>
  }
`;

// ---------------------------------------------------------------------------
// Canvas texture helpers
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Minimal standing silhouette drawn into a small canvas, uploaded only if a
 * PNG sprite sheet fails to decode so markers never vanish entirely.
 * Feet land on the canvas bottom edge to match the sprite's foot anchor.
 */
function createSilhouetteCanvas(color: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(32, 16, 9, 0, Math.PI * 2);
    ctx.fill();
    roundRectPath(ctx, 24, 28, 16, 68, 7);
    ctx.fill();
  }
  return canvas;
}

/**
 * Loads a transparent PNG character sheet (male / female / pastor / kid).
 *
 * The texture object is handed to the sprite materials immediately and
 * three.js fills its buffer from the decoded bitmap when it arrives — the
 * buffer is never pre-seeded with a canvas, which is the
 * `glTexSubImage2DRobustANGLE: Offset overflows texture dimensions` trap.
 * `onLoad` fires once the real bitmap is ready so the caller can read the
 * native `texture.image` dimensions and restore each character's true aspect
 * ratio. Only on a genuine decode failure is the silhouette canvas uploaded
 * instead, so a missing asset degrades to a visible marker rather than nothing.
 */
function loadAvatarSprite(
  loader: THREE.TextureLoader,
  url: string,
  maxAnisotropy: number,
  fallbackCanvas: HTMLCanvasElement,
  isDisposed: () => boolean,
  onLoad: (texture: THREE.Texture) => void,
): THREE.Texture {
  const texture = loader.load(
    url,
    () => {
      if (!isDisposed()) onLoad(texture);
    },
    undefined,
    () => {
      if (isDisposed()) return;
      // three types Texture.image as HTMLImageElement, but a canvas is a valid
      // upload source at runtime (same path WebGLTexImage uses for <canvas>).
      texture.image = fallbackCanvas as unknown as HTMLImageElement;
      texture.needsUpdate = true;
    },
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

/** Gold stroke used only for the selected marker's badge (active state). */
const BADGE_BORDER_SELECTED = "rgba(212, 163, 89, 0.95)";

/**
 * Paints the shared white rounded-pill chrome — fill, hairline/active border and
 * one soft ambient drop shadow — so name tags and aggregated summary pills are
 * pixel-identical in elevation (ui-ux-pro-max: elevation-consistent). Returns
 * the canvas margin so callers can size their text runs identically.
 */
function paintPillChrome(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  border: string,
  borderWidth: number,
): number {
  const w = canvas.width;
  const h = canvas.height;
  const inset = h * BADGE_PILL_INSET_RATIO;

  // JesusUnited map parity: pure white rounded pill, hairline border and a
  // single soft ambient drop shadow (one consistent elevation scale).
  ctx.save();
  ctx.shadowColor = REFERO.badgeShadow;
  ctx.shadowBlur = h * 0.22;
  ctx.shadowOffsetY = h * 0.06;
  roundRectPath(
    ctx,
    inset,
    inset,
    w - inset * 2,
    h - inset * 2,
    (h - inset * 2) / 2,
  );
  ctx.fillStyle = REFERO.badge;
  ctx.fill();
  ctx.restore();

  roundRectPath(
    ctx,
    inset,
    inset,
    w - inset * 2,
    h - inset * 2,
    (h - inset * 2) / 2,
  );
  ctx.strokeStyle = border;
  ctx.lineWidth = borderWidth;
  ctx.stroke();
  return inset;
}

/** Draws a high-contrast white speech pill with dark slate typography. */
function drawSpeechBadge(
  canvas: HTMLCanvasElement,
  text: string,
  subtext: string,
  fontFamily: string,
  selected = false,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  // Active highlight state: the selected marker's badge wears a Honey Gold
  // stroke (and a gentle scale lift applied on the sprite), so selection is
  // communicated without any intrusive 3D ring.
  const inset = paintPillChrome(
    ctx,
    canvas,
    selected ? BADGE_BORDER_SELECTED : REFERO.badgeBorder,
    selected ? h * 0.09 : h * 0.05,
  );

  // First name — dark slate, bold (weight hierarchy: 700 headings). Compact
  // type so the pill reads crisp and unobtrusive at globe scale.
  ctx.fillStyle = REFERO.badgeText;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 " + Math.round(h * 0.3) + "px " + fontFamily;
  ctx.fillText(text, w / 2, h * 0.36, w - inset * 4);

  // City — slate-600 secondary accent (>= 4.5:1 on white)
  ctx.fillStyle = REFERO.badgeMuted;
  ctx.font = "500 " + Math.round(h * 0.2) + "px " + fontFamily;
  ctx.fillText(subtext || "", w / 2, h * 0.68, w - inset * 4);
}

/**
 * Draws the aggregated cluster summary pill: the same white rounded chrome as a
 * name tag (so aggregated and fanned states read as one design language), with
 * the city as the bold headline over a muted `{N} Gatherings` count. Wears the
 * Honey Gold active stroke when the cluster is the selection.
 */
function drawClusterSummaryPill(
  canvas: HTMLCanvasElement,
  lines: ClusterPillLines,
  fontFamily: string,
  selected = false,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const inset = paintPillChrome(
    ctx,
    canvas,
    selected ? BADGE_BORDER_SELECTED : REFERO.badgeBorder,
    selected ? h * 0.09 : h * 0.05,
  );

  ctx.fillStyle = REFERO.badgeText;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 " + Math.round(h * 0.3) + "px " + fontFamily;
  ctx.fillText(lines.headline, w / 2, h * 0.36, w - inset * 4);

  ctx.fillStyle = REFERO.badgeMuted;
  ctx.font = "500 " + Math.round(h * 0.2) + "px " + fontFamily;
  ctx.fillText(lines.subline, w / 2, h * 0.68, w - inset * 4);
}

/**
 * Fraction of a badge sprite's width that the painted pill actually occupies.
 *
 * The badge canvas keeps a transparent margin of `BADGE_PILL_INSET_RATIO` of
 * its height on every side, so the visible rounded rect is narrower than the
 * sprite. The screen-space collision guard must measure the painted pill —
 * measuring the raw sprite (or any factor of it) reports a false clearance and
 * lets neighbouring name tags intersect.
 */
function pillWidthFractionFor(badgeWidth: number): number {
  const width = Math.max(badgeWidth, MARKER_LABEL_HEIGHT);
  const fraction =
    1 - 2 * BADGE_PILL_INSET_RATIO * (MARKER_LABEL_HEIGHT / width);
  return Math.min(1, Math.max(0.6, fraction));
}

/** Builds a speech-bubble badge texture for a marker. */
function createSpeechBadge(
  name: string,
  city: string,
  widthUnits: number,
  fontFamily: string,
): { texture: THREE.CanvasTexture; canvas: HTMLCanvasElement } {
  const height = LABEL_CANVAS_HEIGHT;
  const width = Math.max(
    height,
    Math.round((widthUnits / MARKER_LABEL_HEIGHT) * height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  drawSpeechBadge(canvas, name, city, fontFamily);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, canvas };
}

/**
 * Builds the aggregated cluster summary pill's texture at the same canvas
 * resolution as a name tag, but sized from the pill's own world height so its
 * type scales identically on screen.
 */
function createClusterSummaryPill(
  lines: ClusterPillLines,
  widthUnits: number,
  fontFamily: string,
): { texture: THREE.CanvasTexture; canvas: HTMLCanvasElement } {
  const height = LABEL_CANVAS_HEIGHT;
  const width = Math.max(
    height,
    Math.round((widthUnits / CLUSTER_PILL_HEIGHT) * height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  drawClusterSummaryPill(canvas, lines, fontFamily);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, canvas };
}

/**
 * Screen-space clamp shared by name tags and summary pills: sprites already
 * shrink with perspective, so this boosts a layer toward its readability floor
 * at far zoom (capped at `BADGE_BOOST_MAX`) and pulls it back under its pixel
 * ceiling near the camera. Returns the total scale factor to apply.
 */
function badgeScreenScaleFor(
  naturalHeightWorld: number,
  markerScale: number,
  pxPerWorldUnit: number,
  minPx: number,
  maxPx: number,
): number {
  const naturalPx = naturalHeightWorld * markerScale * pxPerWorldUnit;
  const boost =
    naturalPx < minPx
      ? Math.min(minPx / Math.max(naturalPx, 1e-6), BADGE_BOOST_MAX)
      : 1;
  const cap = naturalPx > maxPx ? maxPx / Math.max(naturalPx, 1e-6) : 1;
  return markerScale * boost * cap;
}

/**
 * Deterministic starfield with per-vertex twinkle phase (LCG, not Math.random,
 * so every mount renders the same constellation).
 */
function createStarGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  const phases = new Float32Array(STAR_COUNT);
  const twinkles = new Float32Array(STAR_COUNT);

  let state = 0x9e3779b9;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };

  for (let i = 0; i < STAR_COUNT; i++) {
    const radius =
      STAR_MIN_RADIUS + next() * (STAR_MAX_RADIUS - STAR_MIN_RADIUS);
    const cosPhi = next() * 2 - 1;
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
    const theta = next() * Math.PI * 2;
    positions[i * 3] = radius * sinPhi * Math.cos(theta);
    positions[i * 3 + 1] = radius * cosPhi;
    positions[i * 3 + 2] = radius * sinPhi * Math.sin(theta);
    sizes[i] = STAR_BASE_SIZE + next() * 0.4;
    phases[i] = next() * Math.PI * 2;
    twinkles[i] = next() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("phase", new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute("twinkle", new THREE.BufferAttribute(twinkles, 1));
  return geometry;
}

/** Reads the live brand font stack so canvas labels match the page typography. */
function resolveFontFamily(container: HTMLElement): string {
  const computed = window.getComputedStyle(container).fontFamily;
  return computed && computed.trim() !== ""
    ? computed
    : "ui-sans-serif, system-ui, sans-serif";
}

function measureContainer(container: HTMLElement): {
  width: number;
  height: number;
} {
  const rect = container.getBoundingClientRect();
  return {
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

// ---------------------------------------------------------------------------
// Marker node (avatar sprite + speech badge — no pedestal/stem in Refero)
interface MarkerNode {
  marker: GlobeMarker;
  name: string;
  city: string;
  normal: THREE.Vector3;
  avatar: THREE.Sprite;
  avatarMaterial: THREE.SpriteMaterial;
  badge: THREE.Sprite;
  badgeMaterial: THREE.SpriteMaterial;
  badgeCanvas: HTMLCanvasElement;
  badgeWidth: number;
  /** Avatar sheet variant; keys the live native-aspect lookup. */
  variant: number;
  /** Geographic cluster this marker belongs to (standalone when count === 1). */
  cluster: GlobeMarkerCluster;
  /** World position when fully fanned out: the marker's slot on the polygon. */
  fannedPosition: THREE.Vector3;
  /** World position when fully aggregated: the cluster's centroid. */
  clusterPosition: THREE.Vector3;
  /** Aggregated summary pill — owned by the cluster lead only, else null. */
  summary: THREE.Sprite | null;
  summaryMaterial: THREE.SpriteMaterial | null;
  summaryCanvas: HTMLCanvasElement | null;
  /** Live aggregation blend for this marker, refreshed every frame. */
  aggregation: number;
}

// ---------------------------------------------------------------------------
// Texture helpers
/** Flat 2x2 placeholder shown only until (or instead of) a photographic map. */
function createFlatTexture(
  color: string,
  colorSpace: THREE.ColorSpace,
): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 2;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 2, 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  return texture;
}

/**
 * Soft-feathered radial gradient for the selection ground disc: a dark slate
 * contact shadow under the feet dissolving into a warm Honey Gold halo
 * (JesusUnited brand accent) that feathers out to nothing at the rim. Replaces
 * the old cyan wireframe selection ring entirely.
 */
function createSelectionDiscTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, "rgba(15, 23, 42, 0.55)");
    gradient.addColorStop(
      SELECTION_DISC_SHADOW_STOP * 0.75,
      "rgba(15, 23, 42, 0.26)",
    );
    gradient.addColorStop(SELECTION_DISC_SHADOW_STOP, "rgba(15, 23, 42, 0)");
    gradient.addColorStop(
      SELECTION_DISC_SHADOW_STOP + 0.1,
      "rgba(212, 163, 89, 0)",
    );
    gradient.addColorStop(0.68, "rgba(212, 163, 89, 0.72)");
    gradient.addColorStop(0.82, "rgba(196, 147, 72, 0.3)");
    gradient.addColorStop(1, "rgba(196, 147, 72, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Loads a photographic map and lets three.js allocate the GL buffer straight
 * from the decoded bitmap when it arrives.
 *
 * It deliberately does NOT attach a 1x1 canvas to `texture.image` before the
 * load completes: that uploads a 1x1 level first and then trips
 * `glTexSubImage2DRobustANGLE: Offset overflows texture dimensions` when the
 * real image (4096x2048 albedo, 2048x1024 topology) is uploaded over it.
 *
 * `onError` restores the caller's placeholder so a 404 can never leave the
 * globe sampling an unsized texture.
 */
function loadTexture(
  loader: THREE.TextureLoader,
  url: string,
  colorSpace: THREE.ColorSpace,
  anisotropy: number,
  onError: () => void,
): THREE.Texture {
  const texture = loader.load(url, undefined, undefined, () => onError());
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  return texture;
}

// ---------------------------------------------------------------------------
// Globe scene factory
/**
 * Creates the cinematic interactive globe inside `container`.
 *
 * Throws if a WebGL context cannot be created (the caller then renders its
 * accessible fallback). Every GPU resource is registered with a disposal
 * registry, so `dispose()` releases the whole scene deterministically.
 *
 * SSR isolation: this entire module is only imported through a dynamic
 * import() from a client effect, so three.js never touches the server.
 */
export function createGlobeScene(
  container: HTMLElement,
  options: GlobeSceneOptions,
): GlobeSceneHandle {
  let reducedMotion = options.reducedMotion === true;
  const markerList = options.markers ?? [];
  const fontFamily = resolveFontFamily(container);

  // --- Disposal registries ------------------------------------------------
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const spriteTextures = new Map<number, THREE.Texture>();
  const badgeRedraws: Array<() => void> = [];
  const textureLoader = new THREE.TextureLoader();
  let disposed = false;

  function trackGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    geometries.add(geometry);
    return geometry;
  }
  function trackMaterial<T extends THREE.Material>(material: T): T {
    materials.add(material);
    return material;
  }
  function trackTexture<T extends THREE.Texture>(texture: T): T {
    textures.add(texture);
    return texture;
  }

  // --- Renderer -----------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  // three.js skill rule: never let DPR exceed 2.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(new THREE.Color(REFERO.space));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const initialSize = measureContainer(container);
  renderer.setSize(initialSize.width, initialSize.height, false);
  // Cached CSS-pixel viewport (updated in resize) used by the badge
  // screen-space clamp maths; reading it per-frame would thrash layout.
  const viewport = { width: initialSize.width, height: initialSize.height };

  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.outline = "none";
  canvas.style.cursor = "grab";
  canvas.style.touchAction = "none";
  canvas.style.borderRadius = "1.5rem";
  container.appendChild(canvas);

  const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // --- Scene, camera -------------------------------------------------------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(REFERO.space);

  const camera = new THREE.PerspectiveCamera(
    GLOBE_FOV,
    initialSize.width / initialSize.height,
    1,
    2400,
  );

  const target: GlobeOrbitState = initialOrbitForMarkers(markerList);
  const current: GlobeOrbitState = { ...target };

  // --- Lighting (front-lit sun on the opening orbit, cool ambient) --------
  const ambientLight = new THREE.AmbientLight(AMBIENT_COLOR, AMBIENT_INTENSITY);
  const keyLight = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  // The sun sits on the camera's opening orbit ring, rotated in azimuth, so the
  // visible hemisphere is crisply lit and the terminator (with city lights)
  // stays in frame instead of opening on a night-side globe.
  const sunAzimuth = target.theta + SUN_AZIMUTH_OFFSET;
  const sunRing = Math.sin(target.phi);
  keyLight.position
    .set(
      Math.sin(sunAzimuth) * sunRing,
      Math.cos(target.phi),
      Math.cos(sunAzimuth) * sunRing,
    )
    .normalize()
    .multiplyScalar(SUN_DISTANCE);
  scene.add(ambientLight, keyLight);

  // --- Earth mesh (ShaderMaterial with day/night/bump) --------------------
  const earthGeometry = trackGeometry(
    new THREE.SphereGeometry(
      GLOBE_BASE_RADIUS,
      EARTH_WIDTH_SEGMENTS,
      EARTH_HEIGHT_SEGMENTS,
    ),
  );
  const earthMaterial = trackMaterial(
    new THREE.ShaderMaterial({
      uniforms: {
        dayMap: {
          value: trackTexture(
            createFlatTexture(REFERO.ocean, THREE.SRGBColorSpace),
          ),
        },
        nightMap: {
          value: trackTexture(
            createFlatTexture(REFERO.space, THREE.SRGBColorSpace),
          ),
        },
        bumpMap: {
          value: trackTexture(
            createFlatTexture(REFERO.space, THREE.NoColorSpace),
          ),
        },
        bumpScale: { value: BUMP_SCALE },
        sunDirection: { value: keyLight.position.clone().normalize() },
        sunIntensity: { value: keyLight.intensity },
        sunColor: { value: keyLight.color },
        ambientIntensity: { value: ambientLight.intensity },
        nightGlow: { value: 0.4 },
      },
      vertexShader: EARTH_VERTEX_SHADER,
      fragmentShader: EARTH_FRAGMENT_SHADER,
      toneMapped: false,
    }),
  );

  // --- Photorealistic Earth maps (day albedo + night lights + topology) ---
  // Flat placeholders keep the globe alive before — and in place of — imagery;
  // each photographic map is uploaded straight from its decoded bitmap with no
  // pre-seeded 1x1 level, which is what tripped glTexSubImage2DRobustANGLE.
  const earthUniforms = earthMaterial.uniforms;
  const restoreDay = earthUniforms.dayMap.value;
  const restoreNight = earthUniforms.nightMap.value;
  const restoreBump = earthUniforms.bumpMap.value;

  const dayTexture = loadTexture(
    textureLoader,
    DAY_MAP_URL,
    THREE.SRGBColorSpace,
    maxAnisotropy,
    () => {
      earthUniforms.dayMap.value = restoreDay;
    },
  );
  earthUniforms.dayMap.value = trackTexture(dayTexture);

  const nightTexture = loadTexture(
    textureLoader,
    NIGHT_MAP_URL,
    THREE.SRGBColorSpace,
    maxAnisotropy,
    () => {
      earthUniforms.nightMap.value = restoreNight;
    },
  );
  earthUniforms.nightMap.value = trackTexture(nightTexture);

  const bumpTexture = loadTexture(
    textureLoader,
    BUMP_MAP_URL,
    THREE.NoColorSpace,
    maxAnisotropy,
    () => {
      earthUniforms.bumpMap.value = restoreBump;
    },
  );
  earthUniforms.bumpMap.value = trackTexture(bumpTexture);

  const earth = new THREE.Mesh(earthGeometry, earthMaterial);
  earth.rotation.y = -Math.PI / 2;
  scene.add(earth);

  // --- Atmosphere (Fresnel rim, additive, depthWrite false) ---------------
  const atmosphereGeometry = trackGeometry(
    new THREE.SphereGeometry(
      GLOBE_BASE_RADIUS * ATMOSPHERE_SCALE,
      EARTH_WIDTH_SEGMENTS,
      EARTH_HEIGHT_SEGMENTS,
    ),
  );
  const atmosphereMaterial = trackMaterial(
    new THREE.ShaderMaterial({
      uniforms: {
        cameraPos: { value: camera.position },
        colorMin: { value: new THREE.Color(0x38bdf8) },
        colorMax: { value: new THREE.Color(0x60a5fa) },
        intensity: { value: ATMOSPHERE_INTENSITY },
        time: { value: 0 },
      },
      vertexShader: ATMOSPHERE_VERTEX_SHADER,
      fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
    }),
  );
  const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
  scene.add(atmosphere);

  // --- Starfield (twinkling, ShaderMaterial on THREE.Points) --------------
  const starGeometry = trackGeometry(createStarGeometry());
  const starMaterial = trackMaterial(
    new THREE.ShaderMaterial({
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        time: { value: 0 },
        colorNear: { value: new THREE.Color(REFERO.starNear) },
        colorFar: { value: new THREE.Color(REFERO.starFar) },
      },
      vertexShader: STAR_VERTEX_SHADER,
      fragmentShader: STAR_FRAGMENT_SHADER,
    }),
  );
  const stars = new THREE.Points(starGeometry, starMaterial);
  scene.add(stars);

  // --- Standing avatar billboards + speech badges ------------------------
  const nodes: MarkerNode[] = [];
  const nodeById = new Map<string, MarkerNode>();
  const pickables: THREE.Object3D[] = [];

  // Ambassadors sharing a city fan out deterministically (equilateral ring for
  // clusters of 3+, golden-angle step for pairs) so they stand alongside each
  // other instead of stacking on the same vector.
  const positions = distributeMarkerPositions(markerList);
  const silhouetteCanvas = createSilhouetteCanvas(REFERO.badgeMuted);

  // Native width/height of each sheet, read from texture.image once decoded.
  // Characters keep their true proportions instead of forced dimensions.
  const spriteAspects = new Map<number, number>();

  // Bind all four transparent PNG character sheets through the shared
  // TextureLoader up-front. Every marker of the same variant shares one texture
  // (four textures total, never one per marker); a missing asset degrades to
  // the silhouette canvas inside `loadAvatarSprite` so nothing ever vanishes.
  for (const variant of [0, 1, 2, 3] as const) {
    spriteAspects.set(variant, AVATAR_FALLBACK_ASPECT);
    spriteTextures.set(
      variant,
      trackTexture(
        loadAvatarSprite(
          textureLoader,
          AVATAR_SHEET_URLS[variant],
          maxAnisotropy,
          silhouetteCanvas,
          () => disposed,
          (texture) => {
            const image = texture.image as
              { width?: number; height?: number } | undefined;
            if (image?.width && image?.height) {
              spriteAspects.set(variant, image.width / image.height);
            }
          },
        ),
      ),
    );
  }

  // --- Dynamic geographic clustering ---------------------------------------
  // Group the payload by angular proximity, then give every marker its two
  // world anchors: its slot on the cluster's formation polygon (fanned) and the
  // cluster centroid (aggregated). `updateMarkers()` interpolates between them
  // with the camera-distance blend, so a city opens and closes continuously.
  const clusters = groupMarkerClusters(markerList);
  const clusterByMarkerId = new Map<string, GlobeMarkerCluster>();
  for (const cluster of clusters) {
    for (const memberId of cluster.memberIds)
      clusterByMarkerId.set(memberId, cluster);
  }

  for (let index = 0; index < markerList.length; index += 1) {
    const marker = markerList[index];
    const position = positions[index];
    const name = normalizeMarkerName(marker.first_name);
    const city = marker.city;
    const cluster = clusterByMarkerId.get(marker.id);
    if (!cluster) {
      throw new Error(
        `Marker ${marker.id} was lost during cluster aggregation.`,
      );
    }

    // Sheet selection is deterministic: a clergy role pins the pastor sheet, a
    // children/youth role pins the kid sheet, and everything else spreads
    // across all four sheets by a stable id hash. Textures are shared per
    // variant, so no per-marker allocation happens here.
    const variant = avatarVariantForMarker(
      marker.id,
      marker.role,
      marker.first_name,
    );
    const avatarTexture = spriteTextures.get(variant);
    if (!avatarTexture) {
      throw new Error(
        `Avatar sheet for variant ${variant} failed to initialise.`,
      );
    }

    const point = latLngToVector3(
      position.lat,
      position.lng,
      GLOBE_BASE_RADIUS,
    );
    const normal = new THREE.Vector3(point.x, point.y, point.z).normalize();
    // Fanned anchor: this marker's own slot on the formation polygon.
    const fannedPosition = normal
      .clone()
      .multiplyScalar(GLOBE_BASE_RADIUS + AVATAR_LIFT);
    // Aggregated anchor: the cluster centroid. A standalone marker's centroid IS
    // its own coordinate, so both anchors coincide and the blend is a no-op.
    const centroidPoint = latLngToVector3(
      cluster.centroid.lat,
      cluster.centroid.lng,
      GLOBE_BASE_RADIUS,
    );
    const clusterPosition = new THREE.Vector3(
      centroidPoint.x,
      centroidPoint.y,
      centroidPoint.z,
    )
      .normalize()
      .multiplyScalar(GLOBE_BASE_RADIUS + AVATAR_LIFT);

    // Avatar sprite: standing upright on the surface normal
    const avatarMaterial = trackMaterial(
      new THREE.SpriteMaterial({
        map: avatarTexture,
        transparent: true,
        // A firm alpha cut (plus depth writing) keeps the transparent PNG
        // margins from haloing and lets depth sort figures correctly where
        // co-located cluster members overlap.
        alphaTest: 0.5,
        depthWrite: true,
        toneMapped: false,
      }),
    );
    const avatar = new THREE.Sprite(avatarMaterial);
    avatar.renderOrder = 1; // avatars draw after the earth, badges after avatars
    // Feet planted on the surface: center.y = 0 pins the sprite's bottom edge
    // (the shoes, drawn on y = 192 of the canvas) to the marker point, so the
    // figure stands upright out of the globe.
    avatar.position.copy(fannedPosition);
    avatar.center.set(0.5, 0.0);
    // Height is the fixed reference; width follows the sheet's native aspect
    // ratio (refined again per-frame once texture.image dimensions decode).
    const initialAspect = spriteAspects.get(variant) ?? AVATAR_FALLBACK_ASPECT;
    avatar.scale.set(AVATAR_BASE_HEIGHT * initialAspect, AVATAR_BASE_HEIGHT, 1);
    avatar.userData.markerId = marker.id;
    scene.add(avatar);

    // Speech badge: crisp white pill pinned to this avatar's world position.
    // There is deliberately NO shared vertical stack — each badge billboards
    // independently above its own character's head. The bottom anchor sits
    // above the crown via a negative center.y (screen-space lift, so the pill
    // clears the head at every latitude and zoom level).
    const badgeWidth = labelWidthForText(name);
    const { texture: badgeTexture, canvas: badgeCanvas } = createSpeechBadge(
      name,
      city,
      badgeWidth,
      fontFamily,
    );
    trackTexture(badgeTexture);
    const badgeMaterial = trackMaterial(
      new THREE.SpriteMaterial({
        map: badgeTexture,
        transparent: true,
        alphaTest: 0.1,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const badge = new THREE.Sprite(badgeMaterial);
    badge.renderOrder = 2; // name tags always composite above their characters
    // Strictly above the head, never occluding it: the pill's bottom edge
    // floats 0.4 pill-heights above its anchor point in screen space (center.y
    // = -0.4), and updateMarkers() places that anchor at the character's crown
    // plus BADGE_CROWN_GAP along the camera's up vector. One consistent rule
    // for every marker at every zoom level.
    badge.center.set(0.5, -BADGE_CROWN_LIFT);
    badge.position.copy(avatar.position);
    badge.scale.set(badgeWidth, MARKER_LABEL_HEIGHT, 1);
    badge.userData.markerId = marker.id;
    scene.add(badge);

    const node: MarkerNode = {
      marker,
      name,
      city,
      normal,
      avatar,
      avatarMaterial,
      badge,
      badgeMaterial,
      badgeCanvas,
      badgeWidth,
      variant,
      cluster,
      fannedPosition,
      clusterPosition,
      summary: null,
      summaryMaterial: null,
      summaryCanvas: null,
      aggregation: 0,
    };

    // Aggregated summary pill: exactly ONE per cluster of 2+, owned by the
    // cluster's lead member (so a collapsed city renders a single pill instead
    // of N stacked copies) and anchored at the centroid. Clicking it selects the
    // lead member, which flies the camera in and opens the formation — the same
    // selection path as tapping an individual character.
    if (!cluster.standalone && cluster.memberIds[0] === marker.id) {
      const pill = createClusterSummaryPill(
        cluster.lines,
        cluster.width,
        fontFamily,
      );
      trackTexture(pill.texture);
      node.summaryCanvas = pill.canvas;
      node.summaryMaterial = trackMaterial(
        new THREE.SpriteMaterial({
          map: pill.texture,
          transparent: true,
          alphaTest: 0.1,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      node.summary = new THREE.Sprite(node.summaryMaterial);
      node.summary.renderOrder = 2;
      node.summary.center.set(0.5, 0.0);
      node.summary.scale.set(cluster.width, CLUSTER_PILL_HEIGHT, 1);
      node.summary.position.copy(clusterPosition);
      node.summary.visible = false; // the ramp decides; hidden in the fanned view
      node.summary.userData.markerId = marker.id;
      scene.add(node.summary);
      pickables.push(node.summary);
    }
    nodes.push(node);
    nodeById.set(marker.id, node);
    pickables.push(avatar, badge);
    // Badge repaints (font load + selection changes) read the live active
    // state off the node, so the gold stroke always follows the selection.
    badgeRedraws.push(() => redrawBadge(node));
  }

  // --- Selection ground disc (soft gold halo + contact shadow) -------------
  // Replaces the old cyan wireframe ring: a feathered canvas-gradient disc
  // lying flush on the terrain under the active avatar's feet. polygonOffset
  // pulls the coplanar surface toward the camera so it can never z-fight with
  // the earth mesh; depth testing keeps it hidden behind the globe horizon.
  const selectionGeometry = trackGeometry(
    new THREE.CircleGeometry(SELECTION_GROUND_DISC_RADIUS, 48),
  );
  const selectionMaterial = trackMaterial(
    new THREE.MeshBasicMaterial({
      map: trackTexture(createSelectionDiscTexture()),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    }),
  );
  const selectionDisc = new THREE.Mesh(selectionGeometry, selectionMaterial);
  selectionDisc.visible = false;
  selectionDisc.renderOrder = 1; // above the earth, below the badges (2)
  scene.add(selectionDisc);

  // --- Interaction state --------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const pointers = new Map<number, { x: number; y: number }>();
  const drag = { pointerId: -1, x: 0, y: 0, travelX: 0, travelY: 0 };
  let pinchSpan = 0;
  let selectedNode: MarkerNode | null = null;
  let hoveredId: string | null = null;
  let lastInteractionAt = performance.now();
  let frameId = 0;
  let lastTimestamp = 0;
  let elapsed = 0;
  const resizeObserver = new ResizeObserver(() => resize());

  function markInteraction(): void {
    lastInteractionAt = performance.now();
  }

  /** Redraws a badge canvas, adding the gold active stroke when selected. */
  function redrawBadge(node: MarkerNode): void {
    drawSpeechBadge(
      node.badgeCanvas,
      node.name,
      node.city,
      fontFamily,
      node === selectedNode,
    );
    const texture = node.badgeMaterial.map;
    if (texture) texture.needsUpdate = true;
  }

  function applySelection(nextId: string | null, notify: boolean): void {
    const resolved = nextId !== null && nodeById.has(nextId) ? nextId : null;
    const next = resolved === null ? null : (nodeById.get(resolved) ?? null);
    if (next !== selectedNode) {
      const previous = selectedNode;
      selectedNode = next;
      if (selectedNode) {
        // Smooth fly-to: glide the orbit target onto the chosen ambassador —
        // azimuth/polar aim straight at them (tilted slightly above their
        // horizon) with a gentle zoom-in. The existing orbit damping turns the
        // jump into a cinematic arc; markInteraction() below keeps idle spin
        // from fighting the flight.
        //
        // A cluster member is framed by its CLUSTER's centroid rather than its
        // own formation slot (at most a couple of degrees away): the whole
        // formation lands on screen, which is what tapping an aggregated
        // summary pill — or any member of a fanned group — is asking for. The
        // zoom target is inside the fan-out window, so the arrival is always a
        // fully opened formation wearing name tags.
        const focus = selectedNode.cluster.standalone
          ? selectedNode.marker
          : selectedNode.cluster.centroid;
        const flight = flyToMarker(focus, target.distance);
        target.theta = shortestOrbitTheta(current.theta, flight.theta);
        target.phi = flight.phi;
        target.distance = flight.distance;
      }
      selectionDisc.visible = selectedNode !== null;
      if (!selectedNode) selectionMaterial.opacity = 0;
      // Active badge state: gold stroke moves to the newly selected marker
      // and returns to the quiet hairline on the previous one.
      if (previous) redrawBadge(previous);
      if (selectedNode) redrawBadge(selectedNode);
    }
    markInteraction();
    if (notify)
      options.onSelectMarker?.(selectedNode ? selectedNode.marker : null);
  }

  function pickMarker(clientX: number, clientY: number): MarkerNode | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointerNdc, camera);
    for (const hit of raycaster.intersectObjects(pickables, false)) {
      if (!hit.object.visible) continue;
      const markerId = hit.object.userData.markerId;
      if (typeof markerId === "string") {
        const node = nodeById.get(markerId);
        if (node) return node;
      }
    }
    return null;
  }

  function updateHover(clientX: number, clientY: number): void {
    const node = pickMarker(clientX, clientY);
    const nextId = node ? node.marker.id : null;
    if (nextId === hoveredId) return;
    hoveredId = nextId;
    canvas.style.cursor = nextId ? "pointer" : "grab";
    options.onHoverMarker?.(nextId);
  }

  function pointerSpan(): number {
    const values = Array.from(pointers.values());
    const first = values[0];
    const second = values[1];
    if (first === undefined || second === undefined) return 0;
    return Math.hypot(second.x - first.x, second.y - first.y);
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* fast taps */
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) {
      pinchSpan = pointerSpan();
      drag.pointerId = -1;
    } else {
      drag.pointerId = event.pointerId;
      drag.x = event.clientX;
      drag.y = event.clientY;
      drag.travelX = 0;
      drag.travelY = 0;
      canvas.style.cursor = "grabbing";
    }
    markInteraction();
  }

  function onPointerMove(event: PointerEvent): void {
    if (pointers.has(event.pointerId)) {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (pointers.size >= 2) {
      const span = pointerSpan();
      if (pinchSpan > 0 && span > 0) {
        target.distance = applyPinchZoom(target.distance, span / pinchSpan);
      }
      pinchSpan = span;
      markInteraction();
      return;
    }

    if (drag.pointerId === event.pointerId) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      drag.travelX += dx;
      drag.travelY += dy;
      Object.assign(target, applyOrbitDrag(target, dx, dy));
      markInteraction();
      return;
    }

    if (event.pointerType === "mouse")
      updateHover(event.clientX, event.clientY);
  }

  function onPointerUp(event: PointerEvent): void {
    const tracked = pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchSpan = 0;

    if (drag.pointerId === event.pointerId) {
      drag.pointerId = -1;
      const tapped =
        tracked && !pointerTravelExceeded(drag.travelX, drag.travelY);
      drag.travelX = 0;
      drag.travelY = 0;
      canvas.style.cursor = hoveredId ? "pointer" : "grab";
      if (tapped) {
        const node = pickMarker(event.clientX, event.clientY);
        applySelection(node ? node.marker.id : null, true);
      }
    }
    markInteraction();
  }

  function onPointerCancel(event: PointerEvent): void {
    pointers.delete(event.pointerId);
    if (drag.pointerId === event.pointerId) drag.pointerId = -1;
    pinchSpan = 0;
    markInteraction();
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    target.distance = applyWheelZoom(target.distance, event.deltaY);
    markInteraction();
  }

  function onContextLost(event: Event): void {
    event.preventDefault();
  }

  // --- Camera application & marker updates --------------------------------
  function applyCamera(): void {
    const { x, y, z } = orbitToPosition(current);
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    atmosphereMaterial.uniforms.cameraPos.value.copy(camera.position);
  }

  const facingVector = new THREE.Vector3();
  // Camera local +Y in world space — the exact screen-up direction that
  // screen-aligned sprites grow along. Reading it from matrixWorld lets the
  // badge anchor ride the true visual crown of each character.
  const cameraUp = new THREE.Vector3();
  // Scratch normal for a cluster's centroid, used for the summary pill's
  // horizon test and for re-projecting the selection disc onto the surface.
  const clusterNormal = new THREE.Vector3();
  // Scratch normal for the selection disc (kept out of the frame loop's GC path).
  const discNormal = new THREE.Vector3();
  const screenPoint = new THREE.Vector3();
  interface ProjectedBadge {
    node: MarkerNode;
    x: number;
    y: number;
    halfWidthPx: number;
    hidden: boolean;
  }
  const projectedBadges: ProjectedBadge[] = [];

  function updateMarkers(): void {
    const scale = markerScaleForDistance(current.distance);
    const avatarHeight = AVATAR_BASE_HEIGHT * scale;
    // Uniform crown clearance: head height + fixed gap, both scaled by the
    // shared marker scale — identical maths for every character, so no badge
    // can ever float higher than its neighbour's.
    const headClearance = avatarHeight + BADGE_CROWN_GAP * scale;
    // Screen-up in world space (camera local +Y): the direction the avatar's
    // body visually extends along, and therefore the direction the badge must
    // rise along to clear the head on screen at any latitude.
    cameraUp
      .set(
        camera.matrixWorld.elements[4],
        camera.matrixWorld.elements[5],
        camera.matrixWorld.elements[6],
      )
      .normalize();

    // px per world unit at the focus depth (viewport height / projected frustum).
    const pxPerWorldUnit =
      viewport.height / (2 * current.distance * TAN_HALF_FOV);
    // Compact pill baseline (~40% below the raw label metrics) keeps badges
    // crisp and unobtrusive; the px clamp then guarantees a readability floor
    // at far zoom (≤ BADGE_BOOST_MAX) and a 26px ceiling near the camera.
    const compactHeight = MARKER_LABEL_HEIGHT * BADGE_COMPACT_SCALE;
    const naturalBadgePx = compactHeight * scale * pxPerWorldUnit;
    const boost =
      naturalBadgePx < BADGE_SCREEN_MIN_PX
        ? Math.min(
            BADGE_SCREEN_MIN_PX / Math.max(naturalBadgePx, 1e-6),
            BADGE_BOOST_MAX,
          )
        : 1;
    const cap =
      naturalBadgePx > BADGE_SCREEN_MAX_PX
        ? BADGE_SCREEN_MAX_PX / Math.max(naturalBadgePx, 1e-6)
        : 1;
    const badgeScale = scale * boost * cap;

    // --- Aggregation blend ---------------------------------------------------
    // How far the camera is from the clustered view: 0 = every member fanned
    // out on its formation polygon (default framing and closer), 1 = each
    // cluster collapsed to a single summary pill at its centroid (far zoom).
    const aggregation = clusterAggregationForDistance(current.distance);

    for (const node of nodes) {
      // A standalone ambassador never aggregates, so its blend is pinned at 0
      // and every layer stays fully visible no matter where the camera is.
      const layers = clusterLayerOpacities(
        node.cluster.standalone ? 0 : aggregation,
      );
      // Members slide toward the centroid as they dissolve into the pill, so
      // the formation visibly gathers rather than popping out of existence.
      const collapse = 1 - layers.avatar;
      node.avatar.position
        .copy(node.fannedPosition)
        .lerp(node.clusterPosition, collapse);

      facingVector.copy(camera.position).sub(node.avatar.position).normalize();
      const facing = node.normal.dot(facingVector);
      const facingCamera = facing > 0;
      const avatarVisible =
        facingCamera && layers.avatar > LAYER_VISIBLE_EPSILON;
      const badgeVisible = facingCamera && layers.badge > LAYER_VISIBLE_EPSILON;
      node.avatar.visible = avatarVisible;
      node.badge.visible = badgeVisible;
      // Upright screen-aligned billboards (material.rotation stays 0, so the
      // canvas up-axis — head to shoes — always maps to screen up and the
      // figure can never appear inverted). Width follows the sheet's native
      // pixel aspect ratio so characters are never squashed or stretched;
      // height stays the fixed reference.
      const aspect = spriteAspects.get(node.variant) ?? AVATAR_FALLBACK_ASPECT;
      node.avatar.scale.set(avatarHeight * aspect, avatarHeight, 1);
      // The requested crown anchor: avatar position + camera-up × (full
      // avatar height + explicit gap). Combined with the center.y = -0.4
      // screen lift, the pill's bottom edge sits strictly above the crown —
      // it can never cover the head, face or torso.
      node.badge.position
        .copy(node.avatar.position)
        .addScaledVector(cameraUp, headClearance);
      const selectedLift = node === selectedNode ? SELECTION_BADGE_LIFT : 1;
      node.badge.scale.set(
        node.badgeWidth * badgeScale * selectedLift,
        compactHeight * badgeScale * selectedLift,
        1,
      );
      const alpha = markerHorizonOpacity(facing);
      node.avatarMaterial.opacity = alpha * layers.avatar;
      node.badgeMaterial.opacity = alpha * layers.badge;

      // Aggregated summary pill (one per cluster of 2+, owned by the lead).
      // Hidden while the formation is open, so the fanned view never shows a
      // summary and a name tag at the same time.
      const summary = node.summary;
      const summaryMaterial = node.summaryMaterial;
      if (summary && summaryMaterial) {
        // Horizon test against the CENTROID, not the lead's fanned slot: the
        // pill must vanish as its city rotates past the limb.
        clusterNormal.copy(node.clusterPosition).normalize();
        const clusterFacing = clusterNormal.dot(facingVector);
        const summaryVisible =
          clusterFacing > 0 && layers.summary > LAYER_VISIBLE_EPSILON;
        summary.visible = summaryVisible;
        summaryMaterial.opacity =
          markerHorizonOpacity(clusterFacing) * layers.summary;
        // Floats above the assembly along the screen-up axis, so it clears the
        // converging avatars exactly like a name tag clears its own head.
        summary.position
          .copy(node.clusterPosition)
          .addScaledVector(
            cameraUp,
            CLUSTER_PILL_LIFT * CLUSTER_PILL_HEIGHT * scale,
          );
        const summaryScale = badgeScreenScaleFor(
          CLUSTER_PILL_HEIGHT,
          scale,
          pxPerWorldUnit,
          CLUSTER_PILL_SCREEN_MIN_PX,
          CLUSTER_PILL_SCREEN_MAX_PX,
        );
        summary.scale.set(
          node.cluster.width * summaryScale,
          CLUSTER_PILL_HEIGHT * summaryScale,
          1,
        );
      }
    }

    // --- Screen-space neighbour cull ----------------------------------------
    // No two name pills may ever share overlapping screen pixels. Each pill's
    // horizontal bounding box (projected X centre ± half projected width) is
    // compared against every neighbour through `badgeBoxesCollide`; when two
    // pills would overlap, the unselected one is hidden outright — the selected
    // badge always wins the pixel space.
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    projectedBadges.length = 0;
    for (const node of nodes) {
      if (!node.badge.visible) continue;
      screenPoint.copy(node.badge.position).project(camera);
      projectedBadges.push({
        node,
        x: (screenPoint.x * 0.5 + 0.5) * viewport.width,
        y: (-screenPoint.y * 0.5 + 0.5) * viewport.height,
        // Half the *painted* pill's projected width: badgeWidth world units of
        // sprite width, narrowed by the canvas' transparent margin, then
        // projected. Measuring the true silhouette is what makes the cull bite.
        halfWidthPx:
          (node.badgeWidth *
            pillWidthFractionFor(node.badgeWidth) *
            badgeScale *
            pxPerWorldUnit) /
          2,
        hidden: false,
      });
    }
    for (const item of projectedBadges) {
      if (item.node === selectedNode) continue; // the selected badge always wins
      for (const other of projectedBadges) {
        if (other === item || other.hidden) continue;
        if (badgeBoxesCollide(item, other)) {
          // The unselected colliding pill yields the pixel space instantly —
          // fully hidden, so it cannot be drawn or picked either. The selected
          // badge (skipped above) always keeps its full opacity.
          item.hidden = true;
          item.node.badgeMaterial.opacity = 0;
          item.node.badge.visible = false;
          break;
        }
      }
    }
  }

  function updateSelectionGroundDisc(): void {
    if (!selectedNode) {
      selectionDisc.visible = false;
      return;
    }
    selectionDisc.visible = true;
    // Gentle breathing of the halo (static under reduced motion).
    selectionMaterial.opacity = reducedMotion
      ? 0.9
      : 0.78 + 0.12 * Math.sin(elapsed * 2.4);
    // Flush with the terrain, directly under the character's feet. The disc
    // rides the selected avatar's own (already aggregation-blended) position and
    // is re-projected onto the surface, so it stays planted while a cluster
    // gathers toward its centroid — never stranded at the fanned slot. The
    // explicit normal lift plus polygonOffset absorbs the remaining sphere
    // curvature and depth precision.
    discNormal.copy(selectedNode.avatar.position).normalize();
    if (discNormal.lengthSq() < 1e-8) discNormal.copy(selectedNode.normal);
    selectionDisc.position
      .copy(discNormal)
      .multiplyScalar(GLOBE_BASE_RADIUS + SELECTION_DISC_LIFT);
    selectionDisc.quaternion.setFromUnitVectors(FORWARD, discNormal);
  }

  function resize(): void {
    if (disposed) return;
    const size = measureContainer(container);
    viewport.width = size.width;
    viewport.height = size.height;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size.width, size.height, false);
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
  }

  // --- Render loop --------------------------------------------------------
  function renderFrame(timestamp: number): void {
    if (disposed) return;
    const dt = Math.min(MAX_FRAME_DELTA, (timestamp - lastTimestamp) / 1000);
    lastTimestamp = timestamp;
    elapsed += dt;

    if (
      !reducedMotion &&
      performance.now() - lastInteractionAt > IDLE_RESUME_MS
    ) {
      target.theta += GLOBE_IDLE_SPIN_SPEED * dt;
    }

    if (reducedMotion) {
      // Reduced motion: no cinematic camera lerp — settle instantly on the
      // target pose. Every write site (nudgeOrbit/nudgeZoom/flyToMarker/
      // initialOrbitForMarkers) already clamps phi and zoom, so the direct
      // assignment cannot escape the legal orbit envelope.
      current.theta = target.theta;
      current.phi = target.phi;
      current.distance = target.distance;
    } else {
      Object.assign(current, stepOrbit(current, target, dt));
    }

    applyCamera();
    updateMarkers();
    updateSelectionGroundDisc();

    const t = reducedMotion ? 0 : elapsed;
    atmosphereMaterial.uniforms.time.value = t;
    starMaterial.uniforms.time.value = t;

    renderer.render(scene, camera);
    frameId = requestAnimationFrame(renderFrame);
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("webglcontextlost", onContextLost);
  resizeObserver.observe(container);

  // Paint first frame immediately
  lastTimestamp = performance.now();
  applyCamera();
  updateMarkers();
  updateSelectionGroundDisc();
  renderer.render(scene, camera);
  frameId = requestAnimationFrame(renderFrame);

  // Repaint badge canvases once the brand font has loaded
  const fonts = document.fonts;
  if (fonts) {
    void fonts.ready
      .then(() => {
        if (disposed) return;
        for (const redraw of badgeRedraws) redraw();
      })
      .catch(() => undefined);
  }

  // --- Teardown -----------------------------------------------------------
  function dispose(): void {
    if (disposed) return;
    disposed = true;

    cancelAnimationFrame(frameId);
    resizeObserver.disconnect();

    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerCancel);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("webglcontextlost", onContextLost);

    // Sweep all geometries
    for (const geometry of geometries) geometry.dispose();

    // Sweep all materials + their textures
    for (const material of materials) {
      const record = material as unknown as Record<string, unknown>;
      for (const key of TEXTURE_MAP_KEYS) {
        const value = record[key];
        if (value instanceof THREE.Texture) textures.add(value);
      }
      material.dispose();
    }
    for (const texture of textures) texture.dispose();

    spriteTextures.clear();
    badgeRedraws.length = 0;
    pickables.length = 0;
    nodes.length = 0;
    nodeById.clear();
    scene.clear();

    renderer.dispose();
    try {
      renderer.forceContextLoss();
    } catch {
      /* already lost */
    }
    if (canvas.parentNode === container) container.removeChild(canvas);
  }

  return {
    selectMarker(markerId: string | null): void {
      applySelection(typeof markerId === "string" ? markerId : null, false);
    },
    nudgeOrbit(deltaTheta: number, deltaPhi: number): void {
      target.theta += Number.isFinite(deltaTheta) ? deltaTheta : 0;
      target.phi = clampPitch(
        target.phi + (Number.isFinite(deltaPhi) ? deltaPhi : 0),
      );
      markInteraction();
    },
    nudgeZoom(factor: number): void {
      const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
      target.distance = clampZoom(target.distance * safeFactor);
      markInteraction();
    },
    resetView(): void {
      const view = initialOrbitForMarkers(markerList);
      target.theta = view.theta;
      target.phi = view.phi;
      target.distance = view.distance;
      applySelection(null, false);
    },
    setReducedMotion(enabled: boolean): void {
      reducedMotion = enabled === true;
    },
    dispose,
  };
}
