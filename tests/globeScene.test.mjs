import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

/**
 * Phase 2 — Task 3.2 verification suite for the pure interaction maths behind
 * the WebGL mission globe:
 *   - `src/lib/globeCamera.ts` (orbit damping, pitch/zoom clamping, marker scale)
 *   - `src/lib/globeAvatars.ts` (storybook avatar catalog + deterministic assignment)
 *
 * Same sandbox strategy as tests/globe.test.mjs (node:test + ts.transpileModule
 * + node:vm), so the numbers that drive the renderer are verified without a GPU.
 */
const require = createRequire(import.meta.url);
const ts = require('typescript');

function compile(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

function runModule(relativePath, requireImpl) {
  const exports = {};
  vm.runInNewContext(compile(relativePath), { exports, require: requireImpl, console });
  return exports;
}

/** Copies a value across the vm realm boundary so strict deep-equality applies. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

let globeCache;
function globeCore() {
  if (!globeCache) {
    globeCache = runModule('../src/lib/globe.ts', (name) => {
      throw new Error(`Unexpected import in globe.ts: ${name}`);
    });
  }
  return globeCache;
}

let cameraCache;
function camera() {
  if (!cameraCache) {
    cameraCache = runModule('../src/lib/globeCamera.ts', (name) => {
      if (name === '@/lib/globe') return globeCore();
      throw new Error(`Unexpected import in globeCamera.ts: ${name}`);
    });
  }
  return cameraCache;
}

let avatarCache;
function avatars() {
  if (!avatarCache) {
    avatarCache = runModule('../src/lib/globeAvatars.ts', (name) => {
      if (name === '@/lib/globe') return globeCore();
      throw new Error(`Unexpected import in globeAvatars.ts: ${name}`);
    });
  }
  return avatarCache;
}

const AUSTIN_MARKERS = [
  { lat: 30.2672, lng: -97.7431 },
  { lat: 30.3175, lng: -97.7126 },
  { lat: 30.2312, lng: -97.8631 },
];

test('zoom is bounded to the supported camera range', () => {
  const { clampZoom, GLOBE_ZOOM_MIN, GLOBE_ZOOM_MAX, GLOBE_DEFAULT_DISTANCE } = camera();
  assert.equal(GLOBE_ZOOM_MIN, 130);
  assert.equal(GLOBE_ZOOM_MAX, 400);
  assert.equal(clampZoom(10), GLOBE_ZOOM_MIN);
  assert.equal(clampZoom(130), GLOBE_ZOOM_MIN);
  assert.equal(clampZoom(400), GLOBE_ZOOM_MAX);
  assert.equal(clampZoom(9_999), GLOBE_ZOOM_MAX);
  assert.equal(clampZoom(GLOBE_DEFAULT_DISTANCE), GLOBE_DEFAULT_DISTANCE);
  assert.equal(clampZoom(Number.NaN), GLOBE_DEFAULT_DISTANCE);
  assert.equal(clampZoom(Number.POSITIVE_INFINITY), GLOBE_DEFAULT_DISTANCE);
});

test('pitch is clamped so the camera can never flip upside down', () => {
  const { clampPitch, GLOBE_PITCH_MIN, GLOBE_PITCH_MAX } = camera();
  assert.ok(GLOBE_PITCH_MIN > 0);
  assert.ok(GLOBE_PITCH_MAX < Math.PI);
  assert.equal(clampPitch(-4), GLOBE_PITCH_MIN);
  assert.equal(clampPitch(0), GLOBE_PITCH_MIN);
  assert.equal(clampPitch(Math.PI), GLOBE_PITCH_MAX);
  assert.equal(clampPitch(99), GLOBE_PITCH_MAX);
  assert.equal(clampPitch(1.1), 1.1);
  assert.equal(clampPitch(Number.NaN), GLOBE_PITCH_MIN);
});

test('damped values ease toward the target without overshoot', () => {
  const { dampValue, GLOBE_DAMPING_LAMBDA } = camera();
  assert.equal(dampValue(0, 10, GLOBE_DAMPING_LAMBDA, 0), 0);

  const tinyStep = dampValue(0, 10, GLOBE_DAMPING_LAMBDA, 0.016);
  const shortStep = dampValue(0, 10, GLOBE_DAMPING_LAMBDA, 0.1);
  const longStep = dampValue(0, 10, GLOBE_DAMPING_LAMBDA, 1);

  assert.ok(tinyStep > 0 && tinyStep < shortStep, 'easing must be monotonic');
  assert.ok(shortStep < longStep && longStep < 10, 'easing must never overshoot');
  assert.ok(Math.abs(longStep - 10) < 0.002, 'a full second must almost settle');
  assert.equal(dampValue(5, 5, GLOBE_DAMPING_LAMBDA, 0.5), 5);
});

test('stepping the orbit keeps pitch and distance inside their bounds', () => {
  const { stepOrbit, GLOBE_PITCH_MIN, GLOBE_PITCH_MAX, GLOBE_ZOOM_MIN, GLOBE_ZOOM_MAX } =
    camera();
  const current = { theta: 0, phi: Math.PI / 2, distance: 260 };

  const below = stepOrbit(current, { theta: 0, phi: -10, distance: 5 }, 5);
  assert.equal(below.phi, GLOBE_PITCH_MIN);
  assert.equal(below.distance, GLOBE_ZOOM_MIN);

  const above = stepOrbit(current, { theta: 0, phi: 99, distance: 5_000 }, 5);
  assert.equal(above.phi, GLOBE_PITCH_MAX);
  assert.equal(above.distance, GLOBE_ZOOM_MAX);

  const settled = stepOrbit(current, { theta: 1.2, phi: 1.1, distance: 300 }, 5);
  assert.ok(Math.abs(settled.theta - 1.2) < 0.001);
  assert.ok(Math.abs(settled.phi - 1.1) < 0.001);
  assert.ok(Math.abs(settled.distance - 300) < 0.001);
});

test('pointer drag rotates the globe without flipping or leaving the pitch window', () => {
  const { applyOrbitDrag, GLOBE_ROTATE_SPEED, GLOBE_PITCH_MIN, GLOBE_PITCH_MAX } = camera();
  const start = { theta: 0, phi: Math.PI / 2, distance: 260 };

  const dragged = applyOrbitDrag(start, 100, 0);
  assert.ok(Math.abs(dragged.theta + 100 * GLOBE_ROTATE_SPEED) < 1e-9, 'drag right spins theta down');
  assert.equal(dragged.phi, start.phi);
  assert.equal(dragged.distance, start.distance);

  assert.equal(applyOrbitDrag(start, 0, 10_000).phi, GLOBE_PITCH_MIN);
  assert.equal(applyOrbitDrag(start, 0, -10_000).phi, GLOBE_PITCH_MAX);

  const down = applyOrbitDrag(start, 0, 40);
  assert.ok(down.phi < start.phi, 'drag down tips the north pole away');
});

test('orbit state projects onto the same axes as the marker maths', () => {
  const { orbitToPosition, GLOBE_DEFAULT_DISTANCE } = camera();
  const distance = GLOBE_DEFAULT_DISTANCE;

  const front = orbitToPosition({ theta: 0, phi: Math.PI / 2, distance });
  assert.ok(Math.abs(front.x) < 1e-9);
  assert.ok(Math.abs(front.y) < 1e-9);
  assert.ok(Math.abs(front.z - distance) < 1e-9);

  const east = orbitToPosition({ theta: Math.PI / 2, phi: Math.PI / 2, distance });
  assert.ok(Math.abs(east.x - distance) < 1e-9);
  assert.ok(Math.abs(east.z) < 1e-9);

  const pole = orbitToPosition({ theta: 0, phi: 0, distance });
  assert.ok(Math.abs(pole.y - distance) < 1e-9);

  const any = orbitToPosition({ theta: -1.7, phi: 0.9, distance: 333 });
  assert.ok(Math.abs(Math.hypot(any.x, any.y, any.z) - 333) < 1e-9);
});

test('the opening view frames the markers and falls back to a global view', () => {
  const {
    initialOrbitForMarkers,
    GLOBE_FALLBACK_VIEW,
    GLOBE_VIEW_TILT,
    GLOBE_PITCH_MIN,
    GLOBE_PITCH_MAX,
    GLOBE_ZOOM_MAX,
  } = camera();

  assert.deepEqual(plain(initialOrbitForMarkers([])), plain(GLOBE_FALLBACK_VIEW));
  assert.equal(initialOrbitForMarkers([]).distance, GLOBE_FALLBACK_VIEW.distance);

  const prime = initialOrbitForMarkers([{ lat: 0, lng: 0 }]);
  assert.ok(Math.abs(prime.theta) < 1e-9);
  assert.ok(Math.abs(prime.phi - (Math.PI / 2 - GLOBE_VIEW_TILT)) < 1e-9);

  const austin = initialOrbitForMarkers(AUSTIN_MARKERS);
  const expectedTheta = (-97.7431 * Math.PI) / 180;
  assert.ok(Math.abs(austin.theta - expectedTheta) < 0.01, 'theta must face the marker cluster');
  assert.ok(austin.phi > GLOBE_PITCH_MIN && austin.phi < GLOBE_PITCH_MAX);
  assert.ok(austin.phi < Math.PI / 2, 'the opening view looks down on the cluster');
  assert.ok(Number.isFinite(austin.distance));

  const clamped = initialOrbitForMarkers(AUSTIN_MARKERS, 10_000);
  assert.equal(clamped.distance, GLOBE_ZOOM_MAX);
});

test('marker scale compensates for camera distance within tight clamps', () => {
  const { markerScaleForDistance, GLOBE_DEFAULT_DISTANCE, GLOBE_ZOOM_MIN, GLOBE_ZOOM_MAX } =
    camera();
  assert.equal(markerScaleForDistance(GLOBE_DEFAULT_DISTANCE), 1);
  assert.equal(markerScaleForDistance(GLOBE_ZOOM_MIN), 0.88);
  assert.equal(markerScaleForDistance(GLOBE_ZOOM_MAX), 1.55);
  assert.equal(markerScaleForDistance(GLOBE_ZOOM_MAX * 10), 1.55);
  assert.equal(markerScaleForDistance(Number.NaN), 1);

  const near = markerScaleForDistance(200);
  const far = markerScaleForDistance(340);
  assert.ok(near < 1 && 1 < far, 'zoom maths must stay monotonic');
});

test('markers fade toward the horizon instead of popping out', () => {
  const { markerHorizonOpacity, MARKER_HORIZON_FLOOR } = camera();
  assert.equal(markerHorizonOpacity(1), 1);
  assert.equal(markerHorizonOpacity(0.35), 1);
  assert.equal(markerHorizonOpacity(-1), MARKER_HORIZON_FLOOR);
  assert.equal(markerHorizonOpacity(-5), MARKER_HORIZON_FLOOR);

  const rim = markerHorizonOpacity(0.15);
  assert.ok(rim > MARKER_HORIZON_FLOOR && rim < 1, 'the rim must be partially faded');
  assert.ok(markerHorizonOpacity(0.05) < markerHorizonOpacity(0.25));
});

test('wheel and pinch zoom stay inside the bounded camera range', () => {
  const { applyWheelZoom, applyPinchZoom, clampZoom, GLOBE_ZOOM_MIN, GLOBE_ZOOM_MAX } = camera();
  assert.equal(applyWheelZoom(260, 0), 260);
  assert.ok(applyWheelZoom(260, 500) > 260, 'scrolling down pulls the camera back');
  assert.ok(applyWheelZoom(260, -500) < 260, 'scrolling up pushes the camera in');
  assert.equal(applyWheelZoom(390, 100_000), GLOBE_ZOOM_MAX);
  assert.equal(applyWheelZoom(140, -100_000), GLOBE_ZOOM_MIN);

  assert.equal(applyPinchZoom(260, 1), 260);
  assert.equal(applyPinchZoom(260, 2), GLOBE_ZOOM_MIN);
  assert.equal(applyPinchZoom(260, 0.5), GLOBE_ZOOM_MAX);
  assert.equal(applyPinchZoom(260, Number.NaN), 260);
  assert.equal(clampZoom(applyPinchZoom(150, 1.2)), 130);
});

test('a tap is distinguished from an orbit drag, and labels stay inside their pill', () => {
  const { pointerTravelExceeded, CLICK_SLOP_PX, labelWidthForText } = camera();
  assert.equal(CLICK_SLOP_PX, 6);
  assert.equal(pointerTravelExceeded(0, 0), false);
  assert.equal(pointerTravelExceeded(CLICK_SLOP_PX, 0), false);
  assert.equal(pointerTravelExceeded(CLICK_SLOP_PX + 0.5, 0), true);
  assert.equal(pointerTravelExceeded(4, 4), false);
  assert.equal(pointerTravelExceeded(5, 5), true);

  const {
    MARKER_LABEL_MIN_WIDTH,
    MARKER_LABEL_MAX_WIDTH,
    MARKER_LABEL_CHAR_WIDTH,
  } = camera();
  assert.equal(labelWidthForText(''), MARKER_LABEL_MIN_WIDTH);
  assert.equal(labelWidthForText('A'), MARKER_LABEL_MIN_WIDTH);
  assert.ok(
    Math.abs(labelWidthForText('Jonathan') - 8 * MARKER_LABEL_CHAR_WIDTH) < 1e-9,
  );
  assert.equal(labelWidthForText('BartholomewChukwuemekaNwosu'), MARKER_LABEL_MAX_WIDTH);
  assert.ok(labelWidthForText('Grace') < labelWidthForText('Jonathan'));
});

// ---------------------------------------------------------------------------
// Avatar sprite catalog (requirement: at least 4 storybook styles, no broken refs)
// ---------------------------------------------------------------------------

test('the avatar catalog ships at least four distinct storybook styles', () => {
  const { AVATAR_STYLES } = avatars();
  assert.ok(AVATAR_STYLES.length >= 4, 'at least four character styles are required');

  const ids = new Set(AVATAR_STYLES.map((style) => style.id));
  const names = new Set(AVATAR_STYLES.map((style) => style.name));
  const files = new Set(AVATAR_STYLES.map((style) => style.file));
  assert.equal(ids.size, AVATAR_STYLES.length, 'style ids must be unique');
  assert.equal(names.size, AVATAR_STYLES.length, 'character names must be unique');
  assert.equal(files.size, AVATAR_STYLES.length, 'asset files must be unique');

  for (const style of AVATAR_STYLES) {
    assert.ok(style.file.startsWith('/assets/avatars/'), `${style.file} must live in the gallery`);
    assert.ok(style.file.endsWith('.svg'), `${style.file} must be an svg sprite`);
    for (const key of ['accent', 'skin', 'hair', 'garment', 'backdrop']) {
      assert.match(style[key], /^#[0-9a-f]{6}$/i, `${style.id}.${key} must be a hex color`);
    }
  }
});

test('every catalogued avatar file exists on disk and is a renderable svg', () => {
  const { AVATAR_STYLES } = avatars();
  for (const style of AVATAR_STYLES) {
    const filePath = new URL(`../public${style.file}`, import.meta.url);
    const markup = readFileSync(filePath, 'utf8');
    assert.ok(markup.length > 400, `${style.file} is suspiciously small`);
    assert.match(markup, /<svg[^>]*width="\d+"[^>]*height="\d+"/, `${style.file} needs fixed size`);
    assert.match(markup, /viewBox="0 0 \d+ \d+"/, `${style.file} needs a viewBox`);
    assert.equal(/<image\b|xlink:href/.test(markup), false, `${style.file} must be self-contained`);
    const withoutNamespace = markup.replace(/xmlns="[^"]*"/g, '');
    assert.equal(
      /https?:\/\//.test(withoutNamespace),
      false,
      `${style.file} must not reference anything remote`,
    );
    assert.match(markup, /<\/svg>\s*$/, `${style.file} must be a complete document`);
  }
});

test('avatar assignment is deterministic, in range, and well distributed', () => {
  const { AVATAR_STYLES, avatarStyleForSeed, avatarStyleIndex } = avatars();

  assert.deepEqual(avatarStyleForSeed('gathering-abc'), avatarStyleForSeed('gathering-abc'));
  assert.notEqual(avatarStyleIndex('gathering-abc') < 0, true);

  const seen = new Set();
  for (let seed = 0; seed < 240; seed += 1) {
    const index = avatarStyleIndex(`gathering-${seed}`);
    assert.ok(Number.isInteger(index) && index >= 0 && index < AVATAR_STYLES.length);
    seen.add(index);
    assert.equal(avatarStyleForSeed(`gathering-${seed}`), AVATAR_STYLES[index]);
  }
  assert.equal(seen.size, AVATAR_STYLES.length, 'every style must be reachable');

  // A stable, spread-out assignment for the same set of ids across renders.
  const first = AVATAR_STYLES.map((_, index) => avatarStyleIndex(`id-${index}`));
  const again = AVATAR_STYLES.map((_, index) => avatarStyleIndex(`id-${index}`));
  assert.deepEqual(first, again);
});

test('public names are normalised before they reach a label sprite', () => {
  const { normalizeMarkerName, MARKER_NAME_MAX_CHARS } = avatars();
  assert.equal(MARKER_NAME_MAX_CHARS, 14);
  assert.equal(normalizeMarkerName(''), 'Believer');
  assert.equal(normalizeMarkerName('   '), 'Believer');
  assert.equal(normalizeMarkerName('  Grace  '), 'Grace');
  assert.equal(normalizeMarkerName('Mary   Grace'), 'Mary Grace');
  assert.equal(normalizeMarkerName('Bartholomew'), 'Bartholomew');
  assert.equal(normalizeMarkerName('BartholomewChukwuemeka').length, MARKER_NAME_MAX_CHARS);
  assert.equal(normalizeMarkerName(null), 'Believer');
  assert.equal(normalizeMarkerName(undefined), 'Believer');
});

