/**
 * Mission Globe — three.js scene engine (Phase 2 — Task 3.2).
 *
 * Imported ONLY through a dynamic `import()` from inside a client effect (see
 * `MissionGlobe.tsx`), so `three` is never evaluated during SSR or static
 * prerender and the WebGL canvas can never break the server-rendered HTML.
 *
 * Owns the renderer, earth sphere, Fresnel atmosphere, billboard avatar sprites,
 * raycasting, the damped orbit controls and every GPU resource it creates.
 * `dispose()` releases all geometries, materials, textures, canvas textures,
 * event listeners, the ResizeObserver and the animation frame.
 *
 * Coordinate contract: markers are placed with `latLngToVector3` (+Y is the North
 * Pole), so an equirectangular texture must be rotated -90° about Y to line up.
 * Billboards are `THREE.Sprite`s, which face the camera by construction, while
 * each marker's pedestal ring and stem are oriented along the surface normal.
 */

import * as THREE from 'three';

import { GLOBE_BASE_RADIUS, latLngToVector3 } from '@/lib/globe';
import { avatarStyleForSeed, normalizeMarkerName, type AvatarStyle } from '@/lib/globeAvatars';
import {
  applyOrbitDrag,
  applyPinchZoom,
  applyWheelZoom,
  clampPitch,
  clampZoom,
  GLOBE_FOV,
  GLOBE_IDLE_SPIN_SPEED,
  initialOrbitForMarkers,
  labelWidthForText,
  MARKER_BASE_SIZE,
  MARKER_LABEL_HEIGHT,
  markerHorizonOpacity,
  markerScaleForDistance,
  orbitToPosition,
  pointerTravelExceeded,
  stepOrbit,
  wrapAngle,
  type GlobeOrbitState,
} from '@/lib/globeCamera';
import type { GlobeMarker } from '@/lib/types';

/** Brand palette (mirrors the CSS custom properties in `globals.css`). */
const BRAND = {
  canvas: '#FAF7EE',
  espresso: '#2D261E',
  sand: '#EDE7D9',
  gold: '#D4A359',
  pill: '#F6EFE2',
  pillInk: '#8C6221',
  land: '#E7EDE2',
  landEdge: '#DBE4D3',
} as const;

const GOLD = 0xd4a359;
const ESPRESSO = 0x2d261e;

/** Tile sizes / mesh densities. */
const EARTH_TEXTURE_WIDTH = 2048;
const EARTH_TEXTURE_HEIGHT = 1024;
const EARTH_WIDTH_SEGMENTS = 64;
const EARTH_HEIGHT_SEGMENTS = 48;
const ATMOSPHERE_SCALE = 1.05;
const AVATAR_TEXTURE_SIZE = 128;
const LABEL_CANVAS_HEIGHT = 128;

/** Marker rig geometry: how far avatars float, and how wide their pedestal is. */
const MARKER_LIFT = 4.2;
const STEM_RADIUS = 0.16;
const PEDESTAL_INNER_RADIUS = 2.4;
const PEDESTAL_OUTER_RADIUS = 5.2;
const SELECTION_INNER_RADIUS = 6.4;
const SELECTION_OUTER_RADIUS = 7.6;
const STAR_COUNT = 190;
const STAR_MIN_RADIUS = 420;
const STAR_MAX_RADIUS = 900;

/** Idle drift resumes this long after the last interaction. */
const IDLE_RESUME_MS = 2600;
/** Largest animation step honoured per frame (tab switches can be huge). */
const MAX_FRAME_DELTA = 0.05;

const FORWARD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
const TEXTURE_MAP_KEYS = [
  'map',
  'alphaMap',
  'emissiveMap',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'envMap',
] as const;

export interface GlobeSceneOptions {
  markers: readonly GlobeMarker[];
  /** Disables the idle drift and the selection pulse. */
  reducedMotion?: boolean;
  onSelectMarker?: (marker: GlobeMarker | null) => void;
  onHoverMarker?: (markerId: string | null) => void;
}

/** Imperative surface used by the React boundary (keyboard, list, buttons). */
export interface GlobeSceneHandle {
  /** Highlights a marker without re-notifying the caller (`null` clears it). */
  selectMarker(markerId: string | null): void;
  /** Adds to the orbit target: positive theta behaves like a leftward drag. */
  nudgeOrbit(deltaTheta: number, deltaPhi: number): void;
  /** Multiplies the zoom target (`> 1` pulls the camera back). */
  nudgeZoom(factor: number): void;
  /** Returns to the opening framing of the current marker set. */
  resetView(): void;
  dispose(): void;
}

/** Rounded-rectangle path, avoiding a dependency on `ctx.roundRect`. */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Coarse, stylised landmasses as flat `[lng, lat, ...]` rings.
 *
 * This is decorative parchment artwork rather than a navigational map: it makes
 * the sphere read as Earth behind the storybook markers while staying on-brand.
 * Replace `paintEarthTexture` with a real equirectangular image if cartographic
 * accuracy is ever needed.
 */
const LANDMASSES: readonly (readonly number[])[] = [
  // Greenland
  [-45, 60, -20, 70, -18, 78, -40, 84, -60, 80, -55, 68],
  // North America
  [-168, 66, -150, 60, -140, 60, -130, 54, -124, 48, -120, 36, -110, 23, -97, 16, -83, 9, -77, 7,
    -82, 18, -90, 21, -97, 26, -93, 30, -82, 25, -80, 32, -70, 42, -56, 50, -64, 58, -78, 62,
    -95, 70, -125, 70, -140, 70],
  // South America
  [-81, 7, -78, 1, -80, -5, -71, -18, -70, -30, -73, -45, -75, -54, -68, -55, -62, -40, -56, -35,
    -48, -25, -35, -8, -44, -2, -52, 5, -62, 10, -72, 12],
  // Africa
  [-17, 15, -16, 21, -10, 28, 0, 33, 11, 37, 25, 32, 34, 31, 43, 12, 51, 11, 42, -2, 40, -15, 35,
    -24, 25, -34, 18, -35, 12, -18, 9, -1, 9, 4, -5, 5, -8, 8],
  // Europe
  [-10, 36, -9, 43, -2, 48, 5, 53, 11, 59, 18, 66, 30, 70, 40, 66, 38, 58, 30, 52, 28, 45, 20, 40,
    15, 38, 12, 45, 3, 42],
  // Asia
  [40, 66, 60, 70, 80, 75, 100, 77, 130, 72, 160, 70, 170, 66, 160, 60, 140, 50, 130, 42, 122, 31,
    110, 21, 100, 10, 95, 5, 90, 22, 80, 15, 72, 20, 62, 25, 55, 38, 45, 40, 40, 45, 38, 58],
  // Australia
  [114, -22, 122, -18, 130, -12, 142, -11, 146, -19, 153, -27, 150, -37, 141, -38, 130, -32, 118,
    -35],
  // Antarctica (spans the texture seam)
  [-180, -70, -120, -74, -60, -70, 0, -72, 60, -70, 120, -74, 180, -70, 180, -90, -180, -90],
];

/** Paints the warm-linen parchment globe onto an equirectangular canvas. */
function paintEarthTexture(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const lngToX = (lng: number) => ((lng + 180) / 360) * width;
  const latToY = (lat: number) => ((90 - lat) / 180) * height;

  ctx.fillStyle = BRAND.canvas;
  ctx.fillRect(0, 0, width, height);

  // Warmth banding: cooler ivory at the poles, warmer across the equator.
  const band = ctx.createLinearGradient(0, 0, 0, height);
  band.addColorStop(0, 'rgba(255,255,255,0.85)');
  band.addColorStop(0.5, 'rgba(244,232,210,0.75)');
  band.addColorStop(1, 'rgba(255,255,255,0.85)');
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, width, height);

  // Graticule every 15°, with the equator and prime meridian picked out in gold.
  ctx.lineWidth = 2;
  ctx.strokeStyle = BRAND.sand;
  ctx.beginPath();
  for (let lng = -180 + 15; lng < 180; lng += 15) {
    const x = lngToX(lng);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const y = latToY(lat);
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(212,163,89,0.32)';
  ctx.beginPath();
  ctx.moveTo(0, latToY(0));
  ctx.lineTo(width, latToY(0));
  ctx.moveTo(lngToX(0), 0);
  ctx.lineTo(lngToX(0), height);
  ctx.stroke();

  // Stylised landmasses, softened so they read as inked parchment.
  ctx.save();
  ctx.fillStyle = BRAND.land;
  ctx.strokeStyle = BRAND.landEdge;
  ctx.lineWidth = 3;
  ctx.shadowColor = 'rgba(140,98,33,0.16)';
  ctx.shadowBlur = 14;
  for (const ring of LANDMASSES) {
    ctx.beginPath();
    for (let index = 0; index < ring.length; index += 2) {
      const x = lngToX(ring[index]);
      const y = latToY(ring[index + 1]);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** Builds the earth's texture once, at the renderer's maximum anisotropy. */
function createEarthTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = EARTH_TEXTURE_WIDTH;
  canvas.height = EARTH_TEXTURE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (ctx) paintEarthTexture(ctx, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

/**
 * Draws the procedural storybook badge used as the guaranteed fallback for an
 * avatar (and as the instant placeholder before the SVG finishes decoding).
 * Mirrors the artwork grid in `public/assets/avatars/*.svg`.
 */
function createProceduralAvatarCanvas(style: AvatarStyle, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const scale = size / 128;
  const centre = size / 2;
  const radius = size * 0.47;

  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, Math.PI * 2);
  ctx.fillStyle = style.backdrop;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, Math.PI * 2);
  ctx.clip();

  // Shoulders
  ctx.fillStyle = style.garment;
  ctx.beginPath();
  ctx.moveTo(centre - 46 * scale, size);
  ctx.quadraticCurveTo(centre, 86 * scale, centre + 46 * scale, size);
  ctx.closePath();
  ctx.fill();

  // Head, hair, face
  ctx.fillStyle = style.skin;
  ctx.beginPath();
  ctx.arc(centre, 54 * scale, 25 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = style.hair;
  ctx.beginPath();
  ctx.arc(centre, 40 * scale, 26 * scale, Math.PI, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = BRAND.espresso;
  ctx.beginPath();
  ctx.arc(centre - 9 * scale, 56 * scale, 2.8 * scale, 0, Math.PI * 2);
  ctx.arc(centre + 9 * scale, 56 * scale, 2.8 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = BRAND.espresso;
  ctx.lineWidth = 2.4 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(centre, 60 * scale, 9 * scale, 0.4, Math.PI - 0.4);
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, Math.PI * 2);
  ctx.strokeStyle = style.accent;
  ctx.lineWidth = 3 * scale;
  ctx.stroke();

  return canvas;
}

/**
 * Builds the avatar texture. The procedural badge is uploaded immediately, then
 * the artwork SVG is rasterised over it when (and only if) it decodes: a 404, a
 * blocked asset or a decode failure simply keeps the badge, so the globe can
 * never render a broken image reference.
 */
function createAvatarTexture(
  style: AvatarStyle,
  maxAnisotropy: number,
  isDisposed: () => boolean,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(createProceduralAvatarCanvas(style, AVATAR_TEXTURE_SIZE));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;

  const image = new Image();
  image.decoding = 'async';
  image.onload = () => {
    if (isDisposed()) return;
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_TEXTURE_SIZE;
    canvas.height = AVATAR_TEXTURE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    try {
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      texture.image = canvas;
      texture.needsUpdate = true;
    } catch {
      // Tainted / undecodable artwork: keep the procedural badge.
    }
  };
  image.src = style.file;

  return texture;
}

/** Paints a first-name pill matching the app's `bg-pill` / `text-pill-ink` badge. */
function drawLabelPill(canvas: HTMLCanvasElement, text: string, fontFamily: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const inset = height * 0.08;
  ctx.clearRect(0, 0, width, height);

  roundRectPath(ctx, inset, inset, width - inset * 2, height - inset * 2, (height - inset * 2) / 2);
  ctx.fillStyle = BRAND.pill;
  ctx.fill();
  ctx.lineWidth = height * 0.055;
  ctx.strokeStyle = BRAND.sand;
  ctx.stroke();

  ctx.fillStyle = BRAND.pillInk;
  ctx.font = `700 ${Math.round(height * 0.5)}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2 + height * 0.02);
}

/** Builds a label texture whose aspect ratio matches its world-space sprite. */
function createLabelTexture(
  text: string,
  widthUnits: number,
  fontFamily: string,
): { texture: THREE.CanvasTexture; canvas: HTMLCanvasElement } {
  const height = LABEL_CANVAS_HEIGHT;
  const width = Math.max(height, Math.round((widthUnits / MARKER_LABEL_HEIGHT) * height));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  drawLabelPill(canvas, text, fontFamily);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, canvas };
}

/** Deterministic starfield (an LCG instead of `Math.random`, so mounts match). */
function createStarGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(STAR_COUNT * 3);
  let state = 0x9e3779b9;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };

  for (let index = 0; index < STAR_COUNT; index += 1) {
    const radius = STAR_MIN_RADIUS + next() * (STAR_MAX_RADIUS - STAR_MIN_RADIUS);
    const cosPhi = next() * 2 - 1;
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
    const theta = next() * Math.PI * 2;
    positions[index * 3] = radius * sinPhi * Math.cos(theta);
    positions[index * 3 + 1] = radius * cosPhi;
    positions[index * 3 + 2] = radius * sinPhi * Math.sin(theta);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

/** Soft round point sprite so the starfield never renders as raw squares. */
function createSoftDotTexture(): THREE.Texture {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(0.45, 'rgba(212,163,89,0.75)');
    glow.addColorStop(1, 'rgba(212,163,89,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Fresnel rim glow for the atmospheric shell (additive, unlit). */
const ATMOSPHERE_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormalView;
  varying vec3 vViewDirection;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDirection = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const ATMOSPHERE_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uPower;
  uniform float uIntensity;

  varying vec3 vNormalView;
  varying vec3 vViewDirection;

  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vNormalView), normalize(vViewDirection))), uPower);
    gl_FragColor = vec4(uColor, rim * uIntensity);
  }
`;

/** Reads the live brand font stack so canvas labels match the page typography. */
function resolveFontFamily(container: HTMLElement): string {
  const computed = window.getComputedStyle(container).fontFamily;
  return computed && computed.trim() !== '' ? computed : 'ui-sans-serif, system-ui, sans-serif';
}

function measureContainer(container: HTMLElement): { width: number; height: number } {
  const rect = container.getBoundingClientRect();
  return {
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

interface MarkerNode {
  marker: GlobeMarker;
  name: string;
  normal: THREE.Vector3;
  avatar: THREE.Sprite;
  avatarMaterial: THREE.SpriteMaterial;
  label: THREE.Sprite;
  labelMaterial: THREE.SpriteMaterial;
  labelWidth: number;
  pedestal: THREE.Mesh;
  stem: THREE.Mesh;
}

/**
 * Creates the interactive globe inside `container`.
 *
 * Throws if a WebGL context cannot be created (the caller then renders its
 * accessible fallback). Every GPU resource is registered with a disposal
 * registry, so `dispose()` releases the whole scene deterministically.
 */
export function createGlobeScene(
  container: HTMLElement,
  options: GlobeSceneOptions,
): GlobeSceneHandle {
  const reducedMotion = options.reducedMotion === true;
  const markerList = options.markers ?? [];
  const fontFamily = resolveFontFamily(container);

  // --- Disposal registries ------------------------------------------------
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const avatarTextures = new Map<string, THREE.CanvasTexture>();
  const labelRedraws: Array<() => void> = [];
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
    powerPreference: 'high-performance',
  });
  // three.js skill rule: never let the device pixel ratio exceed 2.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const initialSize = measureContainer(container);
  renderer.setSize(initialSize.width, initialSize.height, false);

  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.outline = 'none';
  canvas.style.cursor = 'grab';
  // Drag + pinch must drive the camera, never the page scroll.
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);

  const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // --- Scene, camera, lighting -------------------------------------------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    GLOBE_FOV,
    initialSize.width / initialSize.height,
    1,
    2400,
  );

  const target: GlobeOrbitState = initialOrbitForMarkers(markerList);
  const current: GlobeOrbitState = { ...target };

  const ambient = new THREE.AmbientLight(0xfff6e8, 0.5);
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x8c6221, 0.6);
  const keyLight = new THREE.DirectionalLight(0xfff2dd, 1.15);
  keyLight.position.set(-170, 130, 230);
  const rimLight = new THREE.DirectionalLight(GOLD, 0.4);
  rimLight.position.set(190, -70, -170);
  scene.add(ambient, hemisphere, keyLight, rimLight);

  // --- Earth --------------------------------------------------------------
  const earthTexture = trackTexture(createEarthTexture(maxAnisotropy));
  const earthGeometry = trackGeometry(
    new THREE.SphereGeometry(GLOBE_BASE_RADIUS, EARTH_WIDTH_SEGMENTS, EARTH_HEIGHT_SEGMENTS),
  );
  const earthMaterial = trackMaterial(
    new THREE.MeshStandardMaterial({ map: earthTexture, roughness: 0.94, metalness: 0.02 }),
  );
  const earth = new THREE.Mesh(earthGeometry, earthMaterial);
  // Rotates the equirectangular canvas so 0° longitude lands on +Z, matching
  // `latLngToVector3` (see the header note in src/lib/globe.ts).
  earth.rotation.y = -Math.PI / 2;
  scene.add(earth);

  // --- Atmosphere (Fresnel rim glow, additive) ---------------------------
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
        uColor: { value: new THREE.Color(GOLD) },
        uPower: { value: 2.6 },
        uIntensity: { value: 0.95 },
      },
      vertexShader: ATMOSPHERE_VERTEX_SHADER,
      fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
  scene.add(atmosphere);

  // --- Starfield ----------------------------------------------------------
  const starGeometry = trackGeometry(createStarGeometry());
  const starTexture = trackTexture(createSoftDotTexture());
  const starMaterial = trackMaterial(
    new THREE.PointsMaterial({
      color: GOLD,
      size: 5,
      map: starTexture,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }),
  );
  const stars = new THREE.Points(starGeometry, starMaterial);
  scene.add(stars);

  // --- Billboard avatars -------------------------------------------------
  // Shared rig buffers: one geometry/material for every pedestal and stem.
  const pedestalGeometry = trackGeometry(
    new THREE.RingGeometry(PEDESTAL_INNER_RADIUS, PEDESTAL_OUTER_RADIUS, 32),
  );
  const pedestalMaterial = trackMaterial(
    new THREE.MeshBasicMaterial({
      color: ESPRESSO,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  const stemGeometry = trackGeometry(
    new THREE.CylinderGeometry(STEM_RADIUS, STEM_RADIUS, MARKER_LIFT, 6),
  );
  const stemMaterial = trackMaterial(
    new THREE.MeshBasicMaterial({
      color: GOLD,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    }),
  );

  const nodes: MarkerNode[] = [];
  const nodeById = new Map<string, MarkerNode>();
  const pickables: THREE.Object3D[] = [];

  for (const marker of markerList) {
    const style = avatarStyleForSeed(marker.id);
    const name = normalizeMarkerName(marker.first_name);

    // One texture per avatar style, shared by every gathering wearing it.
    let avatarTexture = avatarTextures.get(style.id);
    if (!avatarTexture) {
      avatarTexture = trackTexture(createAvatarTexture(style, maxAnisotropy, () => disposed));
      avatarTextures.set(style.id, avatarTexture);
    }

    const point = latLngToVector3(marker.lat, marker.lng, GLOBE_BASE_RADIUS);
    const normal = new THREE.Vector3(point.x, point.y, point.z).normalize();

    // Avatar billboard: floats above the surface along its normal and always
    // faces the camera (the defining property of a THREE.Sprite).
    const avatarMaterial = trackMaterial(
      new THREE.SpriteMaterial({
        map: avatarTexture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const avatar = new THREE.Sprite(avatarMaterial);
    avatar.position.copy(normal).multiplyScalar(GLOBE_BASE_RADIUS + MARKER_LIFT);
    avatar.scale.setScalar(MARKER_BASE_SIZE);
    avatar.userData.markerId = marker.id;
    scene.add(avatar);

    // First-name pill, tucked just above the avatar.
    const labelWidth = labelWidthForText(name);
    const { texture: labelTexture, canvas: labelCanvas } = createLabelTexture(
      name,
      labelWidth,
      fontFamily,
    );
    trackTexture(labelTexture);
    const labelMaterial = trackMaterial(
      new THREE.SpriteMaterial({
        map: labelTexture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const label = new THREE.Sprite(labelMaterial);
    label.position
      .copy(normal)
      .multiplyScalar(GLOBE_BASE_RADIUS + MARKER_LIFT + MARKER_LABEL_HEIGHT * 0.95);
    label.scale.set(labelWidth, MARKER_LABEL_HEIGHT, 1);
    label.userData.markerId = marker.id;
    scene.add(label);

    labelRedraws.push(() => {
      drawLabelPill(labelCanvas, name, fontFamily);
      labelTexture.needsUpdate = true;
    });

    // Shadow pedestal: sits on the sphere surface, tangent to it.
    const pedestal = new THREE.Mesh(pedestalGeometry, pedestalMaterial);
    pedestal.position.copy(normal).multiplyScalar(GLOBE_BASE_RADIUS + 0.35);
    pedestal.quaternion.setFromUnitVectors(FORWARD, normal);
    scene.add(pedestal);

    // Stem: links the surface point to the floating avatar.
    const stem = new THREE.Mesh(stemGeometry, stemMaterial);
    stem.position.copy(normal).multiplyScalar(GLOBE_BASE_RADIUS + MARKER_LIFT / 2);
    stem.quaternion.setFromUnitVectors(UP, normal);
    scene.add(stem);

    const node: MarkerNode = {
      marker,
      name,
      normal,
      avatar,
      avatarMaterial,
      label,
      labelMaterial,
      labelWidth,
      pedestal,
      stem,
    };
    nodes.push(node);
    nodeById.set(marker.id, node);
    pickables.push(avatar, label);
  }

  // --- Selection ring (one shared mesh that jumps to the chosen marker) ----
  const selectionGeometry = trackGeometry(
    new THREE.RingGeometry(SELECTION_INNER_RADIUS, SELECTION_OUTER_RADIUS, 48),
  );
  const selectionMaterial = trackMaterial(
    new THREE.MeshBasicMaterial({
      color: GOLD,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  const selectionRing = new THREE.Mesh(selectionGeometry, selectionMaterial);
  selectionRing.visible = false;
  scene.add(selectionRing);

  // --- Interaction state --------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const pointers = new Map<number, { x: number; y: number }>();
  const drag = { pointerId: -1, x: 0, y: 0, travelX: 0, travelY: 0 };
  let pinchSpan = 0;
  let selectedId: string | null = null;
  let selectedNode: MarkerNode | null = null;
  let hoveredId: string | null = null;
  let lastInteractionAt = performance.now();
  let frameId = 0;
  let lastTimestamp = 0;
  let elapsed = 0;

  function markInteraction(): void {
    lastInteractionAt = performance.now();
  }

  function applySelection(nextId: string | null, notify: boolean): void {
    const resolved = nextId !== null && nodeById.has(nextId) ? nextId : null;
    selectedId = resolved;
    selectedNode = resolved === null ? null : nodeById.get(resolved) ?? null;
    selectionRing.visible = selectedNode !== null;
    if (!selectedNode) selectionMaterial.opacity = 0;
    markInteraction();
    if (notify) options.onSelectMarker?.(selectedNode ? selectedNode.marker : null);
  }

  /** Raycasts a client-space point against every billboard hit target. */
  function pickMarker(clientX: number, clientY: number): MarkerNode | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointerNdc, camera);

    for (const hit of raycaster.intersectObjects(pickables, false)) {
      const markerId = hit.object.userData.markerId;
      if (typeof markerId === 'string') {
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
    canvas.style.cursor = nextId ? 'pointer' : 'grab';
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
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // The pointer may already be released (fast taps) — harmless.
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
      canvas.style.cursor = 'grabbing';
    }
    markInteraction();
  }

  function onPointerMove(event: PointerEvent): void {
    if (pointers.has(event.pointerId)) {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    // Two fingers: pinch-zoom instead of orbiting.
    if (pointers.size >= 2) {
      const span = pointerSpan();
      if (pinchSpan > 0 && span > 0) {
        target.distance = applyPinchZoom(target.distance, span / pinchSpan);
      }
      pinchSpan = span;
      markInteraction();
      return;
    }

    // One pointer down: damped orbit drag.
    if (drag.pointerId === event.pointerId) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      drag.travelX += dx;
      drag.travelY += dy;

      const dragged = applyOrbitDrag(target, dx, dy);
      target.theta = dragged.theta;
      target.phi = dragged.phi;
      target.distance = dragged.distance;
      markInteraction();
      return;
    }

    if (event.pointerType === 'mouse') updateHover(event.clientX, event.clientY);
  }

  function onPointerUp(event: PointerEvent): void {
    const tracked = pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchSpan = 0;

    if (drag.pointerId === event.pointerId) {
      drag.pointerId = -1;
      // A gesture that never travelled is a tap: raycast and select.
      const tapped = tracked && !pointerTravelExceeded(drag.travelX, drag.travelY);
      drag.travelX = 0;
      drag.travelY = 0;
      canvas.style.cursor = hoveredId ? 'pointer' : 'grab';
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

  /** Prevents the default so three.js can restore the context after a loss. */
  function onContextLost(event: Event): void {
    event.preventDefault();
  }

  function resize(): void {
    if (disposed) return;
    const size = measureContainer(container);
    // Re-clamp on every resize: the window may have moved to another display.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size.width, size.height, false);
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('webglcontextlost', onContextLost);

  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(container);

  // --- Per-frame updates --------------------------------------------------
  function applyCamera(): void {
    const position = orbitToPosition(current);
    camera.position.set(position.x, position.y, position.z);
    camera.lookAt(0, 0, 0);
  }

  function updateMarkers(): void {
    const cameraLength = camera.position.length() || 1;
    const scaleFactor = markerScaleForDistance(current.distance);

    for (const node of nodes) {
      // Depth testing hides the far hemisphere; this only softens the horizon.
      const facing = node.normal.dot(camera.position) / cameraLength;
      const opacity = markerHorizonOpacity(facing);
      const emphasised = node.marker.id === selectedId || node.marker.id === hoveredId;
      const scale = scaleFactor * (emphasised ? 1.14 : 1);

      node.avatar.scale.setScalar(MARKER_BASE_SIZE * scale);
      node.label.scale.set(node.labelWidth * scale, MARKER_LABEL_HEIGHT * scale, 1);
      node.avatarMaterial.opacity = opacity;
      node.labelMaterial.opacity = opacity * (emphasised ? 1 : 0.92);
      node.pedestal.visible = facing > -0.05;
      node.stem.visible = facing > -0.05;
    }
  }

  function updateSelectionRing(): void {
    if (!selectedNode) {
      selectionMaterial.opacity = 0;
      return;
    }
    const pulse = reducedMotion ? 1 : 1 + Math.sin(elapsed * 3.4) * 0.08;
    selectionRing.position.copy(selectedNode.normal).multiplyScalar(GLOBE_BASE_RADIUS + 0.9);
    selectionRing.quaternion.setFromUnitVectors(FORWARD, selectedNode.normal);
    selectionRing.scale.setScalar(pulse);
    selectionMaterial.opacity = 0.62;
  }

  function renderFrame(timestamp: number): void {
    if (disposed) return;
    frameId = requestAnimationFrame(renderFrame);

    const rawDelta = lastTimestamp === 0 ? 0 : (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;
    const delta = Math.min(Math.max(rawDelta, 0), MAX_FRAME_DELTA);
    elapsed += delta;

    // Slow eastward drift whenever nobody has touched the globe recently.
    if (
      !reducedMotion &&
      pointers.size === 0 &&
      performance.now() - lastInteractionAt > IDLE_RESUME_MS
    ) {
      target.theta += GLOBE_IDLE_SPIN_SPEED * delta;
    }

    // Keep both ends of the easing well conditioned without a visual jump.
    if (Math.abs(target.theta) > Math.PI) {
      const shift = wrapAngle(target.theta) - target.theta;
      target.theta += shift;
      current.theta += shift;
    }

    const next = stepOrbit(current, target, delta);
    current.theta = next.theta;
    current.phi = next.phi;
    current.distance = next.distance;

    applyCamera();
    updateMarkers();
    updateSelectionRing();
    renderer.render(scene, camera);
  }

  // Paint the first frame immediately so the globe is never blank.
  applyCamera();
  updateMarkers();
  renderer.render(scene, camera);

  frameId = requestAnimationFrame(renderFrame);

  // Repaint the label pills once the self-hosted brand font has loaded.
  const fonts = document.fonts;
  if (fonts) {
    void fonts.ready
      .then(() => {
        if (disposed) return;
        for (const redraw of labelRedraws) redraw();
      })
      .catch(() => undefined);
  }

  // --- Teardown -----------------------------------------------------------
  function dispose(): void {
    if (disposed) return;
    disposed = true;

    cancelAnimationFrame(frameId);
    resizeObserver.disconnect();

    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('webglcontextlost', onContextLost);

    // Belt-and-braces: adopt anything the registries did not already track.
    scene.traverse((object) => {
      const candidate = object as THREE.Mesh;
      if (candidate.geometry) geometries.add(candidate.geometry);
      const material = candidate.material;
      if (Array.isArray(material)) {
        for (const entry of material) materials.add(entry);
      } else if (material) {
        materials.add(material);
      }
    });

    for (const material of materials) {
      const record = material as unknown as Record<string, unknown>;
      for (const key of TEXTURE_MAP_KEYS) {
        const value = record[key];
        if (value instanceof THREE.Texture) textures.add(value);
      }
      material.dispose();
    }
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();

    avatarTextures.clear();
    labelRedraws.length = 0;
    pickables.length = 0;
    nodes.length = 0;
    nodeById.clear();
    scene.clear();

    renderer.dispose();
    try {
      renderer.forceContextLoss();
    } catch {
      // An already-lost context needs no further cleanup.
    }
    if (canvas.parentNode === container) container.removeChild(canvas);
  }

  return {
    selectMarker(markerId: string | null): void {
      applySelection(typeof markerId === 'string' ? markerId : null, false);
    },
    nudgeOrbit(deltaTheta: number, deltaPhi: number): void {
      target.theta += Number.isFinite(deltaTheta) ? deltaTheta : 0;
      target.phi = clampPitch(target.phi + (Number.isFinite(deltaPhi) ? deltaPhi : 0));
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
    dispose,
  };
}