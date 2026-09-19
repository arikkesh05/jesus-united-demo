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

let hudCache;
function hud() {
  if (!hudCache) {
    hudCache = runModule('../src/lib/globeHud.ts', (name) => {
      throw new Error(`Unexpected import in globeHud.ts: ${name}`);
    });
  }
  return hudCache;
}

test('Refero HUD shares glass tokens and formats empty, singular and plural counts', () => {
  const { HUD_GLASS_PANEL, HUD_PREVIEW_CARD, HUD_COUNTER_BADGE, formatGatheringCounter, formatAmbassadorName } = hud();
  assert.equal(HUD_PREVIEW_CARD, HUD_GLASS_PANEL);
  for (const panel of [HUD_GLASS_PANEL, HUD_COUNTER_BADGE]) {
    for (const token of ['backdrop-blur-xl', 'bg-slate-900/65', 'border-white/12']) {
      assert.ok(panel.includes(token));
    }
  }
  assert.equal(formatGatheringCounter(0, 0), '0 Gatherings · 0 Cities');
  assert.equal(formatGatheringCounter(1, 1), '1 Gathering · 1 City');
  assert.equal(formatGatheringCounter(8, 3), '8 Gatherings · 3 Cities');
  assert.equal(formatAmbassadorName('Grace'), 'Grace');
  assert.equal(formatAmbassadorName(''), 'Ambassador');
});

const AUSTIN_MARKERS = [
  { lat: 30.2672, lng: -97.7431 },
  { lat: 30.3175, lng: -97.7126 },
  { lat: 30.2312, lng: -97.8631 },
];

test('zoom is bounded to the supported camera range', () => {
  const { clampZoom, GLOBE_ZOOM_MIN, GLOBE_ZOOM_MAX, GLOBE_DEFAULT_DISTANCE } = camera();
  assert.equal(GLOBE_ZOOM_MIN, 130);
  assert.equal(GLOBE_ZOOM_MAX, 380);
  assert.equal(clampZoom(10), GLOBE_ZOOM_MIN);
  assert.equal(clampZoom(130), GLOBE_ZOOM_MIN);
  assert.equal(clampZoom(400), GLOBE_ZOOM_MAX);
  assert.equal(clampZoom(9_999), GLOBE_ZOOM_MAX);
  assert.equal(clampZoom(GLOBE_DEFAULT_DISTANCE), GLOBE_DEFAULT_DISTANCE);
  assert.equal(clampZoom(Number.NaN), GLOBE_DEFAULT_DISTANCE);
  assert.equal(clampZoom(Number.POSITIVE_INFINITY), GLOBE_DEFAULT_DISTANCE);
});

test('pitch is clamped to the Refero window so the camera can never flip', () => {
  const { clampPitch, GLOBE_PITCH_MIN, GLOBE_PITCH_MAX } = camera();
  assert.equal(GLOBE_PITCH_MIN, 0.25);
  assert.equal(GLOBE_PITCH_MAX, Math.PI - 0.25);
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
  assert.ok(Math.abs(dampValue(0, 1, GLOBE_DAMPING_LAMBDA, 1 / 60) - 0.05) < 1e-12);
  let sixtyFrames = 0;
  for (let frame = 0; frame < 60; frame++) {
    sixtyFrames = dampValue(sixtyFrames, 10, GLOBE_DAMPING_LAMBDA, 1 / 60);
  }
  assert.ok(Math.abs(sixtyFrames - longStep) < 1e-12, 'damping must be frame-rate independent');
  assert.ok(Math.abs(longStep - 10 * (1 - 0.95 ** 60)) < 1e-12);
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

test('co-located ambassadors fan out deterministically: polygons for pairs and groups', () => {
  const {
    distributeMarkerPositions, MARKER_JITTER_STEP_DEGREES,
    MARKER_CLUSTER_FAN_RADIUS_DEGREES, MARKER_PAIR_LINE_DEGREES,
  } = camera();

  const austin = [
    { id: 'gathering-1', lat: 30.2672, lng: -97.7431 },
    { id: 'gathering-2', lat: 30.2673, lng: -97.7432 },
    { id: 'gathering-3', lat: 30.2671, lng: -97.743 },
  ];
  const spread = distributeMarkerPositions(austin);

  assert.equal(spread.length, 3);
  for (let i = 0; i < spread.length; i++) {
    for (let j = i + 1; j < spread.length; j++) {
      const apart = Math.hypot(spread[i].lat - spread[j].lat, spread[i].lng - spread[j].lng);
      assert.ok(
        apart >= MARKER_JITTER_STEP_DEGREES * 0.4,
        `pair ${i}-${j} only ${apart.toFixed(3)} deg apart`,
      );
    }
  }

  // Clusters of 3+ form an equilateral ring: every member sits one fan radius
  // from the centroid and all chord distances match the ring geometry.
  const centroid = { lat: 30.2672, lng: -97.7431 };
  const latScale = Math.cos((centroid.lat * Math.PI) / 180);
  for (const member of spread) {
    const radial = Math.hypot(
      member.lat - centroid.lat,
      (member.lng - centroid.lng) * latScale,
    );
    assert.ok(
      Math.abs(radial - MARKER_CLUSTER_FAN_RADIUS_DEGREES) < 0.05,
      `member sits ${radial.toFixed(3)} deg from the centroid`,
    );
  }
  const chords = [];
  for (let i = 0; i < spread.length; i++) {
    for (let j = i + 1; j < spread.length; j++) {
      chords.push(Math.hypot(
        spread[i].lat - spread[j].lat,
        (spread[i].lng - spread[j].lng) * latScale,
      ));
    }
  }
  assert.ok(
    Math.max(...chords) - Math.min(...chords) < 0.1,
    'ring chords must be equidistant (equilateral formation)',
  );

  assert.deepEqual(plain(distributeMarkerPositions(austin)), plain(spread), 'fan-out must be deterministic');

  // Pairs form a line through the centroid: both members sit at opposite ends,
  // each MARKER_PAIR_LINE_DEGREES / 2 from the geographic mean, so neither
  // hides the other and the pair reads as a deliberate two-figure formation.
  const pair = distributeMarkerPositions([
    { id: 'p1', lat: 30, lng: -97 },
    { id: 'p2', lat: 30, lng: -97 },
  ]);
  const pairLatScale = Math.cos((30 * Math.PI) / 180);
  const pairCentroid = { lat: 30, lng: -97 };
  // Ground distance (longitude compressed by cos of the latitude), matching
  // the implementation's projection.
  const pairRadials = pair.map((member) => Math.hypot(
    member.lat - pairCentroid.lat,
    (member.lng - pairCentroid.lng) * pairLatScale,
  ));
  for (const radial of pairRadials) {
    assert.ok(
      Math.abs(radial - MARKER_PAIR_LINE_DEGREES / 2) < 0.02,
      `pair member sits ${radial.toFixed(3)} deg from the centroid`,
    );
  }
  const pairApart = Math.hypot(
    pair[0].lat - pair[1].lat,
    (pair[0].lng - pair[1].lng) * pairLatScale,
  );
  assert.ok(
    Math.abs(pairApart - MARKER_PAIR_LINE_DEGREES) < 0.05,
    `pair members ${pairApart.toFixed(3)} deg apart`,
  );
  // No pair member may occupy the centroid once a formation exists.
  assert.equal(
    pair.filter((member) => member.lat === 30 && member.lng === -97).length,
    0,
    'a fan-out pair leaves the centroid empty',
  );

  // Lone markers keep their exact coordinates untouched.
  assert.deepEqual(plain(distributeMarkerPositions([{ id: 'solo', lat: 10, lng: 20 }])), [
    { lat: 10, lng: 20 },
  ]);
  assert.deepEqual(
    plain(distributeMarkerPositions([{ id: 'a', lat: 5, lng: 5 }, { id: 'b', lat: 40, lng: 40 }])),
    [{ lat: 5, lng: 5 }, { lat: 40, lng: 40 }],
  );
});

test('name-pill collision cull measures real screen boxes within its margins', () => {
  const {
    badgeBoxesCollide, BADGE_CULL_OVERLAP_PX, BADGE_CULL_VERTICAL_PX,
  } = camera();

  // Same row, pills whose edges interpenetrate by well over the 4px margin and
  // sit inside the 20px vertical band: the unselected pill must yield.
  assert.equal(
    badgeBoxesCollide(
      { x: 100, y: 300, halfWidthPx: 40 },
      { x: 130, y: 305, halfWidthPx: 40 },
    ),
    true,
    '30px of shared pixels must collide',
  );

  // Exactly AT the 4px margin is not "more than" 4px: the pills just touch.
  assert.equal(
    badgeBoxesCollide(
      { x: 100, y: 300, halfWidthPx: 40 },
      { x: 100 + 2 * 40 - BADGE_CULL_OVERLAP_PX, y: 300, halfWidthPx: 40 },
    ),
    false,
    'the margin itself is not a collision',
  );

  // One pixel deeper and the same pair collides.
  assert.equal(
    badgeBoxesCollide(
      { x: 100, y: 300, halfWidthPx: 40 },
      { x: 100 + 2 * 40 - BADGE_CULL_OVERLAP_PX - 1, y: 300, halfWidthPx: 40 },
    ),
    true,
  );

  // Horizontally interpenetrating pills are safe once their rows are far apart:
  // stacked badges above and below each other never blur together.
  assert.equal(
    badgeBoxesCollide(
      { x: 100, y: 300, halfWidthPx: 40 },
      { x: 100, y: 300 + BADGE_CULL_VERTICAL_PX, halfWidthPx: 40 },
    ),
    false,
    'a vertical gap at the limit keeps both pills visible',
  );
  assert.equal(
    badgeBoxesCollide(
      { x: 100, y: 300, halfWidthPx: 40 },
      { x: 100, y: 300 + BADGE_CULL_VERTICAL_PX - 1, halfWidthPx: 40 },
    ),
    true,
    'one pixel inside the band collides',
  );

  // Clean separation on both axes never hides anything.
  assert.equal(
    badgeBoxesCollide(
      { x: 100, y: 300, halfWidthPx: 40 },
      { x: 220, y: 300, halfWidthPx: 40 },
    ),
    false,
  );

  // Symmetry: the predicate must not depend on argument order.
  const a = { x: 10, y: 10, halfWidthPx: 12 };
  const b = { x: 25, y: 15, halfWidthPx: 12 };
  assert.equal(badgeBoxesCollide(a, b), badgeBoxesCollide(b, a));

  // Degenerate projections never hide a pill.
  assert.equal(
    badgeBoxesCollide(
      { x: Number.NaN, y: 300, halfWidthPx: 40 },
      { x: 100, y: 300, halfWidthPx: 40 },
    ),
    false,
  );
});

test('sprite variant assignment is stable and reaches all four sheets', () => {
  const { avatarSpriteVariantForId, avatarVariantForMarker } = camera();

  assert.equal(avatarSpriteVariantForId('gathering-1'), avatarSpriteVariantForId('gathering-1'));
  assert.equal(avatarSpriteVariantForId(''), avatarSpriteVariantForId(''));

  const seen = new Set();
  for (let seed = 0; seed < 40; seed += 1) {
    const variant = avatarSpriteVariantForId(`gathering-${seed}`);
    assert.ok(Number.isInteger(variant) && variant >= 0 && variant <= 3);
    seen.add(variant);
  }
  assert.equal(seen.size, 4, 'all four sheets must be reachable by id hash');

  // Role keywords pin their sheet before the id hash is consulted.
  assert.equal(avatarVariantForMarker('gathering-1', 'Campus Pastor'), 2);
  assert.equal(avatarVariantForMarker('gathering-2', 'Father Michael'), 2);
  assert.equal(avatarVariantForMarker('gathering-3', 'Parish Priest'), 2);
  assert.equal(avatarVariantForMarker('gathering-4', 'Youth Minister'), 3);
  assert.equal(avatarVariantForMarker('gathering-5', 'Kids Club host'), 3);
  assert.equal(avatarVariantForMarker('gathering-6', 'CHILDREN ministry'), 3);
  // Clergy outranks youth when both keywords appear in one title.
  assert.equal(avatarVariantForMarker('gathering-7', 'Pastor of Youth Ministry'), 2);

  // Missing / non-string roles fall back to the stable id-hash assignment.
  assert.equal(avatarVariantForMarker('gathering-8', null), avatarSpriteVariantForId('gathering-8'));
  assert.equal(
    avatarVariantForMarker('gathering-9', undefined),
    avatarSpriteVariantForId('gathering-9'),
  );

  // Known first names pin a gender-aligned sheet ahead of the id hash.
  // gathering-1 hashes to 0 (male) and gathering-2 to 1 (female), so these
  // prove the name cue overrides a contradicting hash.
  assert.equal(avatarVariantForMarker('gathering-1', null, 'Sarah'), 1);
  assert.equal(avatarVariantForMarker('gathering-2', null, 'Marcus'), 0);
  assert.equal(avatarVariantForMarker('gathering-3', null, 'David'), 0);
  assert.equal(avatarVariantForMarker('gathering-5', null, 'Hannah'), 1);
  // Name matching normalises case and surrounding whitespace, and is exact —
  // "Sandra" must never match "Sarah".
  assert.equal(avatarVariantForMarker('gathering-1', null, '  sarah '), 1);
  assert.equal(
    avatarVariantForMarker('gathering-1', null, 'Sandra'),
    avatarSpriteVariantForId('gathering-1'),
  );
  // Female clergy wears the female sheet; male clergy keeps the pastor sheet.
  assert.equal(avatarVariantForMarker('gathering-1', 'Campus Pastor', 'Sarah'), 1);
  assert.equal(avatarVariantForMarker('gathering-1', 'Campus Pastor', 'Michael'), 2);
  // Children / youth roles stay on the gender-ambiguous kid sheet for any name.
  assert.equal(avatarVariantForMarker('gathering-1', 'Youth Minister', 'Sarah'), 3);
  // Unknown names still fall back to the stable id-hash assignment.
  assert.equal(
    avatarVariantForMarker('gathering-1', null, 'Zoraida'),
    avatarSpriteVariantForId('gathering-1'),
  );
});

test('fly-to selection orbits onto the marker with a gentle zoom and shortest path', () => {
  const {
    flyToMarker, shortestOrbitTheta, GLOBE_FLY_TO_DISTANCE,
    GLOBE_ZOOM_MIN, GLOBE_ZOOM_MAX, orbitToPosition,
  } = camera();

  const austin = { lat: 30.2672, lng: -97.7431 };
  const orbit = flyToMarker(austin, 260);

  // Deterministic, clamped, and gently zoomed in from the default framing.
  assert.deepEqual(flyToMarker(austin, 260), orbit, 'fly-to must be deterministic');
  assert.ok(orbit.distance >= GLOBE_ZOOM_MIN && orbit.distance <= GLOBE_ZOOM_MAX);
  assert.equal(orbit.distance, Math.min(260, GLOBE_FLY_TO_DISTANCE));
  // An already-closer camera is never zoomed out by a selection.
  assert.equal(flyToMarker(austin, 150).distance, 150);

  // The camera direction aligns with the marker direction (within the tilt).
  const markerPoint = globeCore().latLngToVector3(austin.lat, austin.lng, 1);
  const camPoint = orbitToPosition(orbit);
  const camLength = Math.hypot(camPoint.x, camPoint.y, camPoint.z);
  const alignment = (
    camPoint.x * markerPoint.x + camPoint.y * markerPoint.y + camPoint.z * markerPoint.z
  ) / camLength;
  assert.ok(alignment > 0.98, `camera alignment ${alignment.toFixed(3)}`);

  // Shortest-path theta: damping never takes the long way around the circle.
  assert.equal(shortestOrbitTheta(0.2, 0.5), 0.5);
  assert.equal(
    shortestOrbitTheta(6.0, 0.2),
    6.0 + (0.2 - 6.0 + Math.PI * 2),
    'wraps forward across the antimeridian',
  );
  assert.equal(
    shortestOrbitTheta(-6.0, 0.2),
    -6.0 + (0.2 + 6.0 - Math.PI * 2),
    'wraps forward across the antimeridian',
  );
});

test('geographic clustering partitions markers by angular radius', () => {
  const {
    groupMarkerClusters, MARKER_JITTER_CLUSTER_DEGREES, markerGroundDistance,
  } = camera();

  // Three co-located Austin markers plus two far-flung solo cities: proximity
  // grouping must yield exactly three clusters, one of them a trio.
  const clusters = groupMarkerClusters([
    { id: 'a1', lat: 30.2672, lng: -97.7431, city: 'Austin' },
    { id: 'a2', lat: 30.2673, lng: -97.7432, city: 'Austin' },
    { id: 'a3', lat: 30.2671, lng: -97.743, city: 'Austin' },
    { id: 'ny1', lat: 40.7128, lng: -74.006, city: 'New York' },
    { id: 'ldn', lat: 51.5074, lng: -0.1278, city: 'London' },
  ]);

  assert.equal(clusters.length, 3, 'three geographic clusters');

  const sizes = clusters.map((cluster) => cluster.count).sort((a, b) => b - a);
  assert.deepEqual(plain(sizes), [3, 1, 1], 'one trio plus two standalone ambassadors');

  const trio = clusters.find((cluster) => cluster.count === 3);
  assert.equal(trio.standalone, false);
  assert.equal(trio.city, 'Austin', 'the summary pill names the shared city');
  assert.deepEqual(
    plain(trio.memberIds.slice().sort()),
    ['a1', 'a2', 'a3'],
    'exactly the co-located members share the cluster',
  );

  for (const cluster of clusters.filter((c) => c.standalone)) {
    assert.equal(cluster.count, 1);
    assert.equal(cluster.fanRadiusDegrees, 0, 'standalone markers have no formation');
  }

  // The partition honours the merge radius on both sides of the boundary: two
  // markers just inside it merge, two just outside it stay separate.
  const inside = groupMarkerClusters([
    { id: 'x1', lat: 10, lng: 10 },
    { id: 'x2', lat: 10 + MARKER_JITTER_CLUSTER_DEGREES * 0.9, lng: 10 },
  ]);
  assert.equal(inside.length, 1, 'markers inside the merge radius cluster together');
  const outside = groupMarkerClusters([
    { id: 'y1', lat: 10, lng: 10 },
    { id: 'y2', lat: 10 + MARKER_JITTER_CLUSTER_DEGREES * 1.1, lng: 10 },
  ]);
  assert.equal(outside.length, 2, 'markers beyond the merge radius stay separate');

  // Longitude is compressed by latitude, so the same degree gap reads wider
  // near the equator than near the pole.
  assert.ok(
    markerGroundDistance({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })
      > markerGroundDistance({ lat: 70, lng: 0 }, { lat: 70, lng: 1 }),
    'ground distance compresses longitude by latitude',
  );
});

test('cluster centroid is the geographic mean of its members', () => {
  const { groupMarkerClusters } = camera();

  // Three co-located Austin markers: the centroid must be their exact
  // arithmetic mean in both axes (the geographic mean of lat/lng).
  const members = [
    { id: 'a1', lat: 30.2672, lng: -97.7431, city: 'Austin' },
    { id: 'a2', lat: 30.2673, lng: -97.7432, city: 'Austin' },
    { id: 'a3', lat: 30.2671, lng: -97.743, city: 'Austin' },
  ];
  const [cluster] = groupMarkerClusters(members);
  assert.equal(cluster.count, 3);

  const expectedLat = (30.2672 + 30.2673 + 30.2671) / 3;
  const expectedLng = (-97.7431 - 97.7432 - 97.743) / 3;
  assert.ok(
    Math.abs(cluster.centroid.lat - expectedLat) < 1e-12,
    `centroid lat ${cluster.centroid.lat} vs ${expectedLat}`,
  );
  assert.ok(
    Math.abs(cluster.centroid.lng - expectedLng) < 1e-12,
    `centroid lng ${cluster.centroid.lng} vs ${expectedLng}`,
  );

  // Order independence: the mean is symmetric, so reversing the payload yields
  // the same centroid (the payload order only chooses which city labels it).
  const [reversed] = groupMarkerClusters([...members].reverse());
  assert.ok(Math.abs(reversed.centroid.lat - expectedLat) < 1e-12);
  assert.ok(Math.abs(reversed.centroid.lng - expectedLng) < 1e-12);

  // A standalone marker's centroid is its own coordinate.
  const [solo] = groupMarkerClusters([{ id: 'solo', lat: 12.34, lng: 56.78 }]);
  assert.deepEqual(plain(solo.centroid), { lat: 12.34, lng: 56.78 });
});

test('formation slots are uniformly spaced by 2π/N', () => {
  const {
    clusterAngleForSlot, clusterDistributionAngles,
    clusterFanRadiusDegrees, MARKER_CLUSTER_FAN_RADIUS_DEGREES,
  } = camera();

  for (const count of [2, 3, 4, 5, 8, 12, 40]) {
    const step = (Math.PI * 2) / count;

    // Each consecutive slot advances by exactly 2π/N…
    for (let slot = 0; slot < count; slot++) {
      assert.ok(
        Math.abs(clusterAngleForSlot(count, slot) - slot * step) < 1e-12,
        `N=${count} slot ${slot} spacing`,
      );
    }

    // …exactly N slots cover the full circle with no gap and no double-count…
    const angles = clusterDistributionAngles(count);
    assert.equal(angles.length, count, `N=${count} slot count`);
    assert.ok(
      Math.abs(Math.abs(angles[count - 1] - angles[0] + step) - Math.PI * 2) < 1e-9,
      `N=${count} wraps the circle exactly once`,
    );

    // …and neighbour gaps are all identical, so the polygon is regular.
    const gaps = angles.map((angle, index) => {
      const next = angles[(index + 1) % count];
      return ((next - angle) + Math.PI * 2) % (Math.PI * 2);
    });
    const spread = Math.max(...gaps) - Math.min(...gaps);
    assert.ok(spread < 1e-9, `N=${count} neighbour gaps differ by ${spread}`);
    for (const gap of gaps) {
      assert.ok(Math.abs(gap - step) < 1e-9, `N=${count} gap ${gap} vs ${step}`);
    }
  }

  // A deterministic phase rotates the whole formation without changing spacing.
  const rotated = clusterDistributionAngles(4, 0.7);
  assert.ok(Math.abs(rotated[0] - 0.7) < 1e-12);
  assert.ok(Math.abs((rotated[1] - rotated[0]) - Math.PI / 2) < 1e-12);

  // Degenerate input never produces NaN angles.
  for (const count of [0, -3, NaN, Infinity]) {
    const angles = clusterDistributionAngles(count);
    assert.ok(angles.length >= 1);
    for (const angle of angles) assert.ok(Number.isFinite(angle));
  }

  // The adaptive radius floors at the 3-member fan radius, so a trio keeps its
  // established ring size.
  assert.ok(Math.abs(clusterFanRadiusDegrees(3) - MARKER_CLUSTER_FAN_RADIUS_DEGREES) < 1e-12);
});

test('adaptive fan radius keeps neighbours apart without drifting off-city', () => {
  const {
    clusterFanRadiusDegrees, MARKER_CLUSTER_MIN_CHORD_DEGREES,
    MARKER_PAIR_LINE_DEGREES, MARKER_CLUSTER_MAX_FAN_RADIUS_DEGREES,
  } = camera();

  // No formation for degenerate counts, a line for a pair.
  assert.equal(clusterFanRadiusDegrees(0), 0);
  assert.equal(clusterFanRadiusDegrees(1), 0);
  assert.equal(clusterFanRadiusDegrees(NaN), 0);
  assert.equal(clusterFanRadiusDegrees(2), MARKER_PAIR_LINE_DEGREES / 2);

  // The radius is exactly `clamp(max(minChordRadius, triangleRadius), 0, cap)`:
  // the min-chord spacing goal is honoured whenever it fits under the cap, and
  // beyond that the cap wins (a huge cluster must still read as one city).
  const triangleRadius = 3.8;
  const cap = MARKER_CLUSTER_MAX_FAN_RADIUS_DEGREES;
  for (const count of [3, 4, 5, 6, 10, 25, 100]) {
    const radius = clusterFanRadiusDegrees(count);
    const needed = MARKER_CLUSTER_MIN_CHORD_DEGREES / (2 * Math.sin(Math.PI / count));
    assert.ok(
      Math.abs(radius - Math.min(Math.max(needed, triangleRadius), cap)) < 1e-12,
      `N=${count} radius ${radius} is not the documented clamp`,
    );
    assert.ok(radius <= cap, `N=${count} radius ${radius} exceeds the cap`);

    const chord = 2 * radius * Math.sin(Math.PI / count);
    if (needed <= cap) {
      // Un-capped: neighbours keep the full minimum elbow room.
      assert.ok(
        chord >= MARKER_CLUSTER_MIN_CHORD_DEGREES - 1e-12,
        `N=${count} chord ${chord.toFixed(4)} below the minimum`,
      );
    } else {
      // Capped: the radius saturates at the ceiling, which is still the widest
      // formation allowed for a cluster this large.
      assert.equal(radius, cap, `N=${count} must saturate at the cap`);
      assert.ok(chord > 0, `N=${count} keeps neighbours apart`);
    }
  }

  // Every realistic cluster size (a handful of gatherings in one city) is
  // comfortably inside the cap, so the spacing guarantee always applies there.
  for (const count of [3, 4, 5, 6]) {
    const radius = clusterFanRadiusDegrees(count);
    assert.ok(
      2 * radius * Math.sin(Math.PI / count) >= MARKER_CLUSTER_MIN_CHORD_DEGREES - 1e-12,
      `N=${count} must hold the minimum chord`,
    );
  }

  // The radius grows monotonically with the member count.
  let previous = 0;
  for (const count of [3, 4, 5, 6, 8, 10, 12]) {
    const radius = clusterFanRadiusDegrees(count);
    assert.ok(radius >= previous, `radius must not shrink at N=${count}`);
    previous = radius;
  }
});

test('cluster aggregation ramps smoothly with camera distance', () => {
  const {
    clusterAggregationForDistance, clusterSummaryLabel, clusterLabelWidthForText,
    clusterPillLines, clusterPillWidth, clusterLayerOpacities, smoothRamp,
    CLUSTER_AGGREGATE_NEAR_DISTANCE, CLUSTER_AGGREGATE_FAR_DISTANCE,
    CLUSTER_LABEL_MIN_WIDTH, CLUSTER_LABEL_MAX_WIDTH,
    GLOBE_ZOOM_MIN, GLOBE_ZOOM_MAX, GLOBE_DEFAULT_DISTANCE, GLOBE_FLY_TO_DISTANCE,
  } = camera();

  // Fully fanned out when close, fully aggregated when far — monotonically
  // increasing in between, and never outside [0, 1].
  assert.equal(clusterAggregationForDistance(CLUSTER_AGGREGATE_NEAR_DISTANCE), 0);
  assert.equal(clusterAggregationForDistance(GLOBE_ZOOM_MIN), 0);
  assert.equal(clusterAggregationForDistance(CLUSTER_AGGREGATE_FAR_DISTANCE), 1);
  assert.equal(clusterAggregationForDistance(GLOBE_ZOOM_MAX), 1);
  // NaN falls back to the default framing (existing clampZoom contract), which
  // sits past the far end of the ramp: a degenerate distance reads as a fully
  // aggregated pill rather than a half-faded cross-fade.
  assert.equal(clusterAggregationForDistance(NaN), 1, 'NaN falls back to the default framing');

  // The framing invariants that make the ramp usable: the opening view is a
  // clean summary pill, and a selection (or pill click) lands fully fanned.
  assert.equal(
    clusterAggregationForDistance(GLOBE_DEFAULT_DISTANCE), 1,
    'the opening view shows aggregated summary pills',
  );
  assert.equal(
    clusterAggregationForDistance(GLOBE_FLY_TO_DISTANCE), 0,
    'a selection fly-to lands on fully fanned individuals',
  );
  assert.equal(clusterAggregationForDistance(GLOBE_FLY_TO_DISTANCE), 0);
  assert.ok(
    GLOBE_FLY_TO_DISTANCE < CLUSTER_AGGREGATE_NEAR_DISTANCE,
    'a pill click zooms inside the fan-out window',
  );

  let previous = -1;
  for (let distance = GLOBE_ZOOM_MIN; distance <= GLOBE_ZOOM_MAX; distance += 5) {
    const value = clusterAggregationForDistance(distance);
    assert.ok(value >= previous, `aggregation must not decrease at ${distance}`);
    assert.ok(value >= 0 && value <= 1, `aggregation ${value} out of range`);
    previous = value;
  }
  const midpoint = (CLUSTER_AGGREGATE_NEAR_DISTANCE + CLUSTER_AGGREGATE_FAR_DISTANCE) / 2;
  assert.ok(
    Math.abs(clusterAggregationForDistance(midpoint) - 0.5) < 1e-12,
    'smoothstep is symmetric about the midpoint',
  );

  // Summary copy: `{City} • {N} Gatherings`, singular for one.
  assert.equal(clusterSummaryLabel('Austin', 3), 'Austin • 3 Gatherings');
  assert.equal(clusterSummaryLabel('Austin', 1), 'Austin • 1 Gathering');
  assert.equal(clusterSummaryLabel('', 2), 'This city • 2 Gatherings');
  assert.equal(clusterSummaryLabel(null, 4), 'This city • 4 Gatherings');
  assert.equal(clusterSummaryLabel('Nashville', NaN), 'Nashville • 1 Gathering');

  // Pill width stays inside its bounds for every label the copy can produce.
  assert.equal(clusterLabelWidthForText(''), CLUSTER_LABEL_MIN_WIDTH);
  assert.equal(clusterLabelWidthForText('x'.repeat(200)), CLUSTER_LABEL_MAX_WIDTH);

  // The drawn pill is two short lines (bold city over a muted count), matching
  // the name tag's design language, and its width fits the WIDER of the two —
  // so even a long city plus a long count stays inside the bounds.
  const realisticLines = clusterPillLines('San Antonio', 12);
  assert.deepEqual(plain(realisticLines), {
    headline: 'San Antonio',
    subline: '12 Gatherings',
  });
  const realistic = clusterPillWidth(realisticLines);
  assert.ok(
    realistic > CLUSTER_LABEL_MIN_WIDTH && realistic < CLUSTER_LABEL_MAX_WIDTH,
    `realistic summary width ${realistic} must sit inside the bounds`,
  );
  // The width tracks the widest line, not the total copy length.
  assert.equal(
    clusterPillWidth({ headline: 'Austin', subline: '3 Gatherings' }),
    clusterLabelWidthForText('3 Gatherings'),
  );
  assert.equal(
    clusterPillWidth({ headline: 'A Very Long City Name', subline: '2 Gatherings' }),
    clusterLabelWidthForText('A Very Long City Name'),
  );
  assert.equal(clusterPillLines('', 2).headline, 'This city');
  assert.equal(clusterPillLines(null, 1).subline, '1 Gathering');

  // Layer handover: exactly one layer is legible at each end of the ramp, so a
  // name tag never dissolves into an overlapping summary pill.
  const fanned = clusterLayerOpacities(0);
  assert.equal(fanned.badge, 1, 'name tags are fully visible when fanned out');
  assert.equal(fanned.avatar, 1, 'avatars are fully visible when fanned out');
  assert.equal(fanned.summary, 0, 'no summary pill when fanned out');

  const aggregated = clusterLayerOpacities(1);
  assert.equal(aggregated.badge, 0, 'name tags are gone when aggregated');
  assert.equal(aggregated.avatar, 0, 'avatars are gone when aggregated');
  assert.equal(aggregated.summary, 1, 'the summary pill is fully visible when aggregated');

  // Opacities stay in range, and the badge always yields before the avatar so
  // the pill is never the last label standing.
  for (let value = 0; value <= 1.0001; value += 0.05) {
    const layers = clusterLayerOpacities(value);
    for (const opacity of [layers.badge, layers.avatar, layers.summary]) {
      assert.ok(opacity >= 0 && opacity <= 1, `opacity ${opacity} out of range`);
    }
    assert.ok(
      layers.badge <= layers.avatar + 1e-12,
      `badge must fade out no later than the avatar at ${value}`,
    );
  }
  // Degenerate input degrades to the fanned-out state.
  const degenerate = clusterLayerOpacities(NaN);
  assert.equal(degenerate.avatar, 1);
  assert.equal(degenerate.summary, 0);

  // Ramp primitives.
  assert.equal(smoothRamp(0, 0, 1), 0);
  assert.equal(smoothRamp(1, 0, 1), 1);
  assert.equal(smoothRamp(0.5, 0, 1), 0.5);
  assert.equal(smoothRamp(5, 0, 1), 1, 'clamps above the end');
  assert.equal(smoothRamp(-5, 0, 1), 0, 'clamps below the start');
  assert.equal(smoothRamp(2, 2, 2), 1, 'a zero-width ramp steps at its end');
  assert.equal(smoothRamp(1, 2, 2), 0, 'below a zero-width ramp is still 0');
});