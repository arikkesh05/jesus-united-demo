import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import vm from 'node:vm';

/**
 * Verification suite for the pure stage + rig contract in `src/lib/watchmanStage.ts`: the
 * grounding geometry (the measured deepest vertex on the ground plane, the measured crown on the
 * composed top), the orbit framing that keeps the pedestal and the figure inside the viewport at
 * every allowed camera angle, the calibrated Amen window, and the clip policy — with all three
 * clip names checked against the JSON chunk of the shipped `public/models/watchman.glb`, so a
 * swapped asset fails here instead of silently un-grounding the hero or reaching for a clip it
 * does not have. Same sandbox strategy as globeSearch.test.mjs — node:test, ts.transpileModule
 * and node:vm — so the numbers are verified without a DOM or a GPU.
 */
const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = ts.transpileModule(
  readFileSync(new URL('../src/lib/watchmanStage.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;

const moduleObj = { exports: {} };
vm.runInNewContext(source, {
  exports: moduleObj.exports,
  module: moduleObj,
  require: () => undefined,
  console,
});
const stage = moduleObj.exports;

// --- the shipped asset, read the way any client reads a GLB ------------------------------------

const glb = readFileSync(new URL('../public/models/watchman.glb', import.meta.url));
if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error('watchman.glb is not a GLB container');

/** GLB header: magic (4) + version (4) + length (4), then chunk length (4) + chunk type (4). */
const asset = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
const SHIPPED_CLIPS = asset.animations.map((clip) => clip.name);

/** Unique geometry in the meshes array — node instancing would otherwise double-count it. */
const SHIPPED_VERTICES = asset.meshes.reduce(
  (total, mesh) =>
    total +
    mesh.primitives.reduce(
      (meshTotal, primitive) => meshTotal + asset.accessors[primitive.attributes.POSITION].count,
      0,
    ),
  0,
);
const SHIPPED_TRIANGLES = asset.meshes.reduce(
  (total, mesh) =>
    total +
    mesh.primitives.reduce(
      (meshTotal, primitive) =>
        meshTotal +
        (primitive.indices
          ? asset.accessors[primitive.indices].count / 3
          : asset.accessors[primitive.attributes.POSITION].count / 3),
      0,
    ),
  0,
);

// --- geometry helpers (the test's own sandbox, no three.js) -----------------------------------

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm = (v) => {
  const length = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / length, y: v.y / length, z: v.z / length };
};

/** Camera pose for an orbit angle, mirroring what drei's OrbitControls maintains (fixed radius,
 *  looking at the pivot). */
function cameraAt(polar, azimuth) {
  const radius = stage.CAMERA_DISTANCE * Math.sin(polar);
  return {
    x: radius * Math.sin(azimuth),
    y: stage.ORBIT_TARGET_Y + stage.CAMERA_DISTANCE * Math.cos(polar),
    z: radius * Math.cos(azimuth),
  };
}

/** Exact frustum test: framed while the point's vertical and horizontal angles off the view axis
 *  stay inside the hero canvas's half-fovs. */
function framed(point, polar, azimuth, aspect) {
  const camera = cameraAt(polar, azimuth);
  const forward = norm({
    x: -camera.x,
    y: stage.ORBIT_TARGET_Y - camera.y,
    z: -camera.z,
  });
  const right = norm(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = cross(right, forward);
  const delta = { x: point[0] - camera.x, y: point[1] - camera.y, z: point[2] - camera.z };
  const depth = dot(delta, forward);
  if (depth <= 0) return false;

  const halfVertical = (stage.CAMERA_FOV / 2) * (Math.PI / 180);
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
  return (
    Math.abs(Math.atan2(dot(delta, up), depth)) <= halfVertical &&
    Math.abs(Math.atan2(dot(delta, right), depth)) <= halfHorizontal
  );
}

const POLAR_ANGLES = [
  stage.ORBIT_MIN_POLAR_ANGLE,
  Math.PI / 2 - stage.CAMERA_ELEVATION,
  stage.ORBIT_MAX_POLAR_ANGLE,
];
const AZIMUTHS = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI];

/** 256px of card interior at 380px tall — the narrowest the hero gets on a 320px viewport. */
const NARROWEST_HERO_ASPECT = 0.65;

/** Worst-case silhouette: the composed crown, and the pedestal's lowest rim all round. */
const COMPOSITION = [
  [0, stage.FIGURINE_TOP_Y, 0],
  ...[0, 1, 2, 3].map((quarter) => {
    const angle = (quarter * Math.PI) / 2;
    return [
      stage.PEDESTAL_RADIUS * Math.sin(angle),
      stage.PEDESTAL_BOTTOM_Y,
      stage.PEDESTAL_RADIUS * Math.cos(angle),
    ];
  }),
];

describe('watchmanStage — grounding geometry', () => {
  it('drops the measured deepest vertex exactly onto the ground plane', () => {
    const sole = stage.FIGURINE_BASE_Y + stage.MODEL_SOLE_Y * stage.FIGURINE_SCALE;
    assert.ok(
      Math.abs(sole - stage.FIGURINE_GROUND_Y) < 1e-12,
      `sole rested at ${sole}, ground plane is ${stage.FIGURINE_GROUND_Y}`,
    );
  });

  it('lands the measured crown on the composed top of a 2.4-unit figure', () => {
    const crown = stage.FIGURINE_BASE_Y + stage.MODEL_CROWN_Y * stage.FIGURINE_SCALE;
    assert.ok(
      Math.abs(crown - stage.FIGURINE_TOP_Y) < 1e-12,
      `crown rested at ${crown}, composed top is ${stage.FIGURINE_TOP_Y}`,
    );
    assert.ok(
      Math.abs(stage.FIGURINE_TOP_Y - stage.FIGURINE_GROUND_Y - stage.FIGURINE_HEIGHT) < 1e-12,
      'the composition must span FIGURINE_HEIGHT between the two pins',
    );
  });

  it('pins the asset measurements every derived constant is fitted to', () => {
    // Measured with three's own skin-aware vertex path across Idle, Wave and ThumbsUp (see the
    // lib docblock). A swapped GLB moves these, and scale, grounding, half-width and framing all
    // follow it.
    assert.ok(Math.abs(stage.MODEL_HEIGHT - 1) < 1e-9, `height was ${stage.MODEL_HEIGHT}`);
    assert.ok(
      Math.abs(stage.MODEL_SILHOUETTE_RADIUS - 0.38) < 1e-9,
      `silhouette radius was ${stage.MODEL_SILHOUETTE_RADIUS}`,
    );
    assert.ok(
      Math.abs(stage.MODEL_GESTURE_REACH - 0.3669) < 1e-4,
      `gesture reach was ${stage.MODEL_GESTURE_REACH}`,
    );
    assert.ok(
      stage.MODEL_SOLE_Y === 0 && stage.MODEL_CROWN_Y === 1,
      'the normalized asset must pin its soles at the origin and its crown at 1, or the base offset is meaningless',
    );
    // The silhouette bound covers every frame the rig plays — gestures included.
    assert.ok(
      stage.MODEL_GESTURE_REACH <= stage.MODEL_SILHOUETTE_RADIUS,
      'the gesture peak must stay inside the silhouette bound',
    );
  });

  it('ships a POSITION accessor that IS the normalized unit box', () => {
    // The file-level half of the contract: soles exactly at 0, crown exactly at 1, x/z exactly
    // centred — with min/max describing the float32 data actually written — and the stage
    // constants reading those same numbers back.
    const position = asset.accessors[asset.meshes[0].primitives[0].attributes.POSITION];

    assert.equal(position.min[1], 0, `soles rested at ${position.min[1]}`);
    assert.equal(position.max[1], 1, `crown rested at ${position.max[1]}`);
    assert.ok(Math.abs(position.min[0] + position.max[0]) < 1e-9, 'x must be centred on 0');
    assert.ok(Math.abs(position.min[2] + position.max[2]) < 1e-9, 'z must be centred on 0');

    assert.equal(stage.MODEL_SOLE_Y, position.min[1]);
    assert.equal(stage.MODEL_CROWN_Y, position.max[1]);
    assert.ok(
      Math.abs(stage.MODEL_HEIGHT - (position.max[1] - position.min[1])) < 1e-12,
      'MODEL_HEIGHT must equal the shipped box height',
    );

    // The directed silhouette bound tracks the file's actual rest width (0.3768) closely enough
    // that a swapped asset moving the width moves the pin out of tolerance.
    const restWidth = position.max[0] - position.min[0];
    assert.ok(
      Math.abs(stage.MODEL_SILHOUETTE_RADIUS - restWidth) < 0.01,
      `silhouette ${stage.MODEL_SILHOUETTE_RADIUS} drifts from the shipped rest width ${restWidth}`,
    );
  });

  it('meets the ground plane from below without crossing it', () => {
    const topFace = stage.PEDESTAL_CENTER_Y + stage.PEDESTAL_THICKNESS / 2;
    assert.ok(topFace <= stage.FIGURINE_GROUND_Y, `pedestal top face ${topFace} is above the plane`);
    assert.ok(stage.FIGURINE_GROUND_Y - topFace <= 0.005, 'guard should stay invisible (< 5mm)');

    // The played silhouette, scaled, stays inside the platter's rim — while never standing so far
    // inside it that a silent re-scale could shrink the hero to a speck on a stage the pedestal's
    // width (the exact invisible-figure failure this suite exists to catch).
    assert.ok(
      stage.FIGURINE_HALF_WIDTH <= stage.PEDESTAL_RADIUS,
      `half-width ${stage.FIGURINE_HALF_WIDTH} overhangs the platter radius ${stage.PEDESTAL_RADIUS}`,
    );
    const underfill = 1 - stage.FIGURINE_HALF_WIDTH / stage.PEDESTAL_RADIUS;
    assert.ok(
      underfill <= 0.15,
      `half-width ${stage.FIGURINE_HALF_WIDTH} sits ${(underfill * 100).toFixed(1)}% inside the rim — the figure would read as a speck`,
    );
  });

  it('keeps the halo ring under the ground plane so the shadow pool sees no phantom ring', () => {
    assert.ok(stage.PEDESTAL_RING_Y + stage.PEDESTAL_RING_TUBE <= stage.FIGURINE_GROUND_Y);
  });
});

describe('watchmanStage — orbit framing', () => {
  it('keeps the whole composition inside the frustum at every allowed orbit angle', () => {
    for (const polar of POLAR_ANGLES) {
      for (const azimuth of AZIMUTHS) {
        for (const point of COMPOSITION) {
          assert.ok(
            framed(point, polar, azimuth, NARROWEST_HERO_ASPECT),
            `point ${point} left the frame at polar ${polar.toFixed(3)} / azimuth ${azimuth.toFixed(3)}`,
          );
        }
      }
    }
  });

  it('mounts the camera inside its own polar limits (no first-frame snap)', () => {
    const initialPolar = Math.PI / 2 - stage.CAMERA_ELEVATION;
    assert.ok(initialPolar >= stage.ORBIT_MIN_POLAR_ANGLE);
    assert.ok(initialPolar <= stage.ORBIT_MAX_POLAR_ANGLE);

    const [, cameraY, cameraZ] = stage.CAMERA_POSITION;
    const mountedPolar = Math.atan2(cameraZ, cameraY - stage.ORBIT_TARGET_Y);
    assert.ok(Math.abs(mountedPolar - initialPolar) < 1e-12, `mounted at ${mountedPolar}`);
  });
});

describe('watchmanStage — the Amen window', () => {
  it('opens at 6.0, decays monotonically to the 3.5 rest value, and stays finite outside it', () => {
    assert.equal(stage.amenProgress(12, 12), 0);
    assert.ok(Math.abs(stage.amenProgress(12.8, 12) - 1) < 1e-9);
    assert.ok(stage.amenProgress(13.8, 12) > 1);

    assert.equal(stage.rimIntensity(0), stage.RIM_SURGE_INTENSITY);
    assert.equal(stage.rimIntensity(1), stage.RIM_BASE_INTENSITY);
    assert.equal(stage.rimIntensity(-0.5), stage.RIM_SURGE_INTENSITY);
    assert.equal(stage.rimIntensity(40), stage.RIM_BASE_INTENSITY);

    let previous = stage.rimIntensity(0);
    for (let step = 1; step <= 100; step++) {
      const current = stage.rimIntensity(step / 100);
      assert.ok(current <= previous, 'the flare must not re-brighten mid-window');
      assert.ok(Number.isFinite(current), 'no NaN leak from the fractional exponent');
      previous = current;
    }
  });

});

describe('watchmanStage — the clip policy', () => {
  it('names only clips the shipped GLB actually carries', () => {
    const named = [stage.IDLE_CLIP, stage.CLICK_GESTURE_CLIP, stage.AMEN_GESTURE_CLIP];
    for (const name of named) {
      assert.ok(
        SHIPPED_CLIPS.includes(name),
        `the GLB ships ${SHIPPED_CLIPS.length} clips, none named "${name}"`,
      );
    }
    assert.equal(new Set(named).size, named.length, 'idle and gestures must be distinct clips');
  });

  it('answers a tap with a wave and an Amen with a thumbs up — both shipped', () => {
    assert.equal(stage.gestureClip('click'), stage.CLICK_GESTURE_CLIP);
    assert.equal(stage.gestureClip('amen'), stage.AMEN_GESTURE_CLIP);
    for (const source of ['click', 'amen']) {
      assert.ok(
        SHIPPED_CLIPS.includes(stage.gestureClip(source)),
        `gestureClip("${source}") asked for a clip the asset does not have`,
      );
    }
  });

  it('cross-fades on the durations the spec pins', () => {
    assert.equal(stage.IDLE_FADE_IN_SECONDS, 0.5);
    assert.equal(stage.GESTURE_FADE_SECONDS, 0.2);
    assert.ok(stage.IDLE_FADE_IN_SECONDS > 0 && stage.GESTURE_FADE_SECONDS > 0);
  });

  it('still measures the asset the contract was fitted to', () => {
    // 3 clips / 1 skin / 34 joints / 4,055 verts / 8,116 tris — the numbers every constant in
    // the lib derives from. A model swap changes them on the first assertion below.
    assert.equal(SHIPPED_CLIPS.length, 3);
    assert.equal(asset.skins.length, 1);
    // One skin over a single 34-bone skeleton.
    assert.equal(new Set(asset.skins.flatMap((skin) => skin.joints)).size, 34);
    assert.equal(SHIPPED_VERTICES, 4055);
    assert.equal(SHIPPED_TRIANGLES, 8116);
  });

  it('no longer exports the procedural hop, turn or scale bump it replaced', () => {
    for (const gone of [
      'createHopState',
      'hopImpulse',
      'stepHop',
      'HOP_PEAK',
      'HOP_LAUNCH_VELOCITY',
      'createSpinState',
      'spinImpulse',
      'stepSpin',
      'spinEase',
      'SPIN_TAU',
      'amenScaleBump',
    ]) {
      assert.equal(stage[gone], undefined, `${gone} should be gone — the clips play those now`);
    }
  });
});
