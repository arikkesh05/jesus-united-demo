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

  it('re-grounds identically through the idle-breathing pivot group', () => {
    // `WatchmanModel` nests the primitive one level deeper so the breathing can pivot at the ground
    // plane: <group position=[0, GROUND_Y, 0]><primitive position=[0, BASE_Y - GROUND_Y, 0] />.
    // That rewrite of the base offset is easy to get wrong and would silently float or sink the
    // hero, and the composition tests above all read the *stage* constants — they cannot see it.
    // Re-derive the world transform the JSX produces and pin it against the same two anchors the
    // grounding contract is written in.
    const innerOffset = stage.FIGURINE_BASE_Y - stage.BREATHING_PIVOT_Y;
    const worldSoleY =
      stage.FIGURINE_GROUND_Y + innerOffset + stage.MODEL_SOLE_Y * stage.FIGURINE_SCALE;
    const worldCrownY =
      stage.FIGURINE_GROUND_Y + innerOffset + stage.MODEL_CROWN_Y * stage.FIGURINE_SCALE;

    assert.ok(
      Math.abs(worldSoleY - stage.FIGURINE_GROUND_Y) < 1e-12,
      `sole rests at ${worldSoleY} through the breathing pivot, ground plane is ${stage.FIGURINE_GROUND_Y}`,
    );
    assert.ok(
      Math.abs(worldCrownY - stage.FIGURINE_TOP_Y) < 1e-12,
      `crown reaches ${worldCrownY} through the breathing pivot, composed top is ${stage.FIGURINE_TOP_Y}`,
    );
  });

  it('makes the soles the fixed point of the breathing, so the contact shadow stays welded', () => {
    // The breathing group is seated at the ground plane precisely so scaling and yawing move the
    // figure *about its feet*. If that pivot is ever moved, the soles drift laterally and lift off
    // the acrylic — a few millimetres, invisible in a screenshot and obvious in motion, and exactly
    // the "feet feel detached" symptom this pass exists to fix. Assert the pivot sits on the sole.
    assert.ok(
      stage.BREATHING_PIVOT_Y === stage.FIGURINE_GROUND_Y,
      `breathing pivot ${stage.BREATHING_PIVOT_Y} has drifted off the sole line ${stage.FIGURINE_GROUND_Y}`,
    );

    // And the pivot must not be the world origin the rig group sits at — that offset is the whole
    // reason a second group exists. 1.0 unit of separation is what turns "slides the feet" into
    // "rotates about the feet".
    assert.ok(
      Math.abs(stage.BREATHING_PIVOT_Y) > 0.5,
      'the breathing pivot collapsed onto the world origin, where the rig group already sits',
    );

    // At this pivot, a 0.005 rad yaw produces exactly zero lateral travel at the sole line.
    const peakYaw = 0.005;
    const lateralAtSole = Math.abs(
      stage.BREATHING_PIVOT_Y - stage.FIGURINE_GROUND_Y,
    ) * Math.sin(peakYaw);
    assert.ok(
      lateralAtSole < 1e-9,
      `the sole slides ${lateralAtSole} units when yawed`,
    );
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

  it('pivots at the figurine\'s heart, not the composition\'s bounding-box midpoint', () => {
    // The regression that motivated the recalibration. The old pivot was the midpoint of
    // pedestal-underside-to-crown, which sits at the figure's waist; framing from there pushed the
    // camera above the crown and tilted it down onto the top of the head.
    const compositionMidpoint =
      (stage.PEDESTAL_BOTTOM_Y + stage.FIGURINE_TOP_Y) / 2;
    assert.ok(
      stage.ORBIT_TARGET_Y > compositionMidpoint,
      `pivot ${stage.ORBIT_TARGET_Y} must sit above the composition midpoint ${compositionMidpoint}`,
    );

    // Heart level, per spec: 0.45-0.50 on a figure whose soles are at -1.0 and crown at 1.4.
    assert.ok(
      stage.ORBIT_TARGET_Y >= 0.45 && stage.ORBIT_TARGET_Y <= 0.5,
      `pivot ${stage.ORBIT_TARGET_Y} is not at heart level (want 0.45-0.50)`,
    );

    // It must be *derived*, not hard-coded: re-deriving from the fraction proves the pivot tracks
    // the composition if FIGURINE_HEIGHT is ever re-fitted.
    assert.ok(
      Math.abs(
        stage.ORBIT_TARGET_Y -
          (stage.FIGURINE_GROUND_Y + stage.FIGURINE_HEIGHT * stage.FIGURINE_HEART_FRACTION),
      ) < 1e-12,
    );
    // ...and the fraction must be a plausible sternum height, not a number tuned to hit a pixel.
    assert.ok(
      stage.FIGURINE_HEART_FRACTION > 0.5 && stage.FIGURINE_HEART_FRACTION < 0.7,
      `heart fraction ${stage.FIGURINE_HEART_FRACTION} is outside the torso`,
    );
  });

  it('sights the crown within a few degrees of level, never down onto the top of the head', () => {
    // The regression that motivated the recalibration, stated as the thing it actually broke: the
    // *sightline onto the head*, not the camera's absolute height. A camera at Y=1.557 still sits
    // above the 1.4 crown — that is unavoidable at 15-20° of elevation over a chest-level pivot,
    // and it is what a portrait of a standing figure looks like. What matters is the angle the head
    // is *seen* at: the old mount put it at 2.62°, this one at 2.22°, and the suite pins the ceiling
    // so a future change cannot quietly climb back toward a plan view.
    const [, cameraY, cameraZ] = stage.CAMERA_POSITION;
    const sightlineOntoCrown =
      (Math.atan2(cameraY - stage.FIGURINE_TOP_Y, cameraZ) * 180) / Math.PI;
    assert.ok(
      sightlineOntoCrown <= 5,
      `the crown is seen from ${sightlineOntoCrown.toFixed(2)}deg above — that is a top-down view`,
    );

    // And the camera must be close to the pivot, not parked high above it: the *elevation* is the
    // real error term, so assert it independently of the absolute Y.
    assert.ok(
      cameraY - stage.ORBIT_TARGET_Y < 1.2,
      `camera sits ${(cameraY - stage.ORBIT_TARGET_Y).toFixed(2)} above the pivot — too high for a desk-level read`,
    );
  });

  it('mounts at a 15-20 degree downward tilt and caps the whole orbit arc there', () => {
    // The 1e-9 tolerance is not decoration: `15 * Math.PI / 180 * 180 / Math.PI` evaluates to
    // 14.999999999999998, so a bare `>= 15` comparison fails on the spec's own exact value.
    const elevationDeg = (stage.CAMERA_ELEVATION * 180) / Math.PI;
    assert.ok(
      elevationDeg >= 15 - 1e-9 && elevationDeg <= 20 + 1e-9,
      `mounts at ${elevationDeg.toFixed(2)}deg, want the 15-20deg altar-desk band`,
    );

    // The ceiling is the load-bearing half: a visitor must not be able to drag the camera back up
    // into the plan view the recalibration removed. 20° is the spec's stated ceiling, so the clamp
    // is allowed to land exactly on it and the tolerance is float slack, not slack in the spec.
    const maxReachableElevationDeg =
      ((Math.PI / 2 - stage.ORBIT_MIN_POLAR_ANGLE) * 180) / Math.PI;
    assert.ok(
      maxReachableElevationDeg <= 20 + 1e-9,
      `a drag can reach ${maxReachableElevationDeg.toFixed(2)}deg above the horizon`,
    );
    assert.ok(
      maxReachableElevationDeg >= elevationDeg,
      'the mount elevation must sit inside the arc the clamps allow, or the first frame snaps',
    );
  });

  it('holds the framing across a sweep of responsive viewport widths', () => {
    // The hero card is fluid (a max-w-340px column on a 320px phone up to a full-width desktop
    // panel), so the narrowest aspect is not a single number but a floor. Sweep it rather than
    // trusting one measurement: a pivot raised to heart level moves the composition *down* in frame,
    // and the pedestal's underside is what runs out of room first.
    for (const aspect of [0.5, 0.6, NARROWEST_HERO_ASPECT, 0.8, 1, 1.5, 2]) {
      for (const polar of POLAR_ANGLES) {
        for (const azimuth of AZIMUTHS) {
          for (const point of COMPOSITION) {
            assert.ok(
              framed(point, polar, azimuth, aspect),
              `point ${point} left the frame at aspect ${aspect}, polar ${polar.toFixed(3)} / azimuth ${azimuth.toFixed(3)}`,
            );
          }
        }
      }
    }
  });

  it('keeps real headroom in the frame, not a pixel-perfect fit', () => {
    // A composition that exactly touches the frustum edge passes the test above and still reads as
    // cropped on a real device (device pixel ratio, scrollbar, sub-pixel rounding). Assert a
    // genuine margin: nothing may use more than 92% of the half-frame on the axis that binds.
    const halfVertical = (stage.CAMERA_FOV / 2) * (Math.PI / 180);
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * NARROWEST_HERO_ASPECT);
    let worst = 0;
    for (const polar of POLAR_ANGLES) {
      for (const azimuth of AZIMUTHS) {
        const camera = cameraAt(polar, azimuth);
        const forward = norm({
          x: -camera.x,
          y: stage.ORBIT_TARGET_Y - camera.y,
          z: -camera.z,
        });
        const right = norm(cross(forward, { x: 0, y: 1, z: 0 }));
        const up = cross(right, forward);
        for (const point of COMPOSITION) {
          const delta = {
            x: point[0] - camera.x,
            y: point[1] - camera.y,
            z: point[2] - camera.z,
          };
          const depth = dot(delta, forward);
          assert.ok(depth > 0, 'a composition point fell behind the camera');
          const vertical = Math.abs(Math.atan2(dot(delta, up), depth)) / halfVertical;
          const horizontal = Math.abs(Math.atan2(dot(delta, right), depth)) / halfHorizontal;
          worst = Math.max(worst, vertical, horizontal);
        }
      }
    }
    assert.ok(
      worst <= 0.92,
      `composition reaches ${(worst * 100).toFixed(1)}% of the half-frame — no headroom left`,
    );
  });
});

describe('watchmanStage — the Amen window', () => {
  it('opens at 6.0, decays monotonically to the resting rim, and stays finite outside it', () => {
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

  it('keeps the Amen surge a real surge over a quiet resting rim', () => {
    // The rest value is calibrated against the scene's 1.6 key (see WatchmanScene). The old pair,
    // 3.5 resting and 6.0 surging, meant the rim was already brighter than the key before an Amen
    // ever landed — the celebration was a step, not a jump, and the resting silhouette was blown
    // out to a hard white band.
    assert.ok(
      stage.RIM_BASE_INTENSITY <= 1.6,
      `resting rim ${stage.RIM_BASE_INTENSITY} must not out-shine the 1.6 key`,
    );
    assert.ok(stage.RIM_BASE_INTENSITY >= 1.2, 'the resting rim still has to draw the silhouette');
    assert.ok(
      stage.RIM_SURGE_INTENSITY > stage.RIM_BASE_INTENSITY * 3,
      `surge ${stage.RIM_SURGE_INTENSITY} over rest ${stage.RIM_BASE_INTENSITY} is not a celebration`,
    );
  });

  it('hangs the rim behind and above the figure\'s shoulders', () => {
    // The gold edge is what separates the figurine from the dark slate card, and it only does that
    // from a position behind the subject: in front it is just another key, in profile it is nothing.
    const [x, y, z] = stage.RIM_POSITION;
    assert.ok(z < 0, `rim at z=${z} is in front of the figure, not behind it`);
    // Above the pivot, so the highlight lands on the shoulders, hair and upper back rather than
    // skimming the ankles — a rim level with the pivot would trace the hem instead of the outline.
    assert.ok(
      y > stage.ORBIT_TARGET_Y,
      `rim at y=${y} is below the chest pivot ${stage.ORBIT_TARGET_Y} — it will rim the hem, not the silhouette`,
    );
    // The old [0, 4, -4] hung further out *and* higher. Keeping it close in keeps the falloff tight
    // enough that the back of the robe still reads as cloth rather than falling off to black.
    assert.ok(Math.abs(z) <= 3, `rim at z=${z} is too far back to shape the robe`);
    assert.ok(Math.abs(x) < 1e-9, 'the rim is a centre light, not a side one');
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
    // 3 clips / 1 skin / 34 joints / 8,116 tris — the numbers every constant in the lib derives from.
    // A model swap changes them on the first assertion below.
    assert.equal(SHIPPED_CLIPS.length, 3);
    assert.equal(asset.skins.length, 1);
    // One skin over a single 34-bone skeleton.
    assert.equal(new Set(asset.skins.flatMap((skin) => skin.joints)).size, 34);
    assert.equal(SHIPPED_TRIANGLES, 8116);
  });

  it('gives every primitive attribute the same vertex count', () => {
    // The regression that matters most here. An export once shipped a welded 4,055-vertex skin
    // referencing the unwelded 6,235-vertex TEXCOORD_0 accessor, so WebGL sampled `uv[i]` against
    // `position[i]` for i < 4,055 and the surface came out marbled. glTF requires one accessor count
    // per attribute on a primitive, so assert the invariant rather than a magic vertex total: the
    // count itself is a free parameter of how the rig was welded, but agreement never is.
    const uvCounts = new Set();
    for (const mesh of asset.meshes) {
      for (const primitive of mesh.primitives) {
        const positionCount = asset.accessors[primitive.attributes.POSITION].count;
        for (const [semantic, accessorIndex] of Object.entries(primitive.attributes)) {
          const count = asset.accessors[accessorIndex].count;
          assert.equal(
            count,
            positionCount,
            `${semantic} has ${count} entries but POSITION has ${positionCount}`,
          );
          if (semantic === 'TEXCOORD_0') uvCounts.add(count);
        }
        if (primitive.indices !== undefined) {
          // `min`/`max` on a SCALAR index accessor are optional and this exporter omits them, so
          // only assert index reachability when they are actually declared.
          const indexMax = asset.accessors[primitive.indices].max?.[0];
          if (indexMax !== undefined) {
            assert.ok(
              indexMax < positionCount,
              `indices reference vertex ${indexMax} but POSITION has only ${positionCount}`,
            );
          }
        }
      }
    }
    // Every mesh shares one unwelded vertex stream, so the UV count equals the geometry total.
    assert.equal(uvCounts.size, 1);
    assert.equal([...uvCounts][0], SHIPPED_VERTICES);
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
