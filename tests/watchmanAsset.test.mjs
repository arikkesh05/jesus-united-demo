/**
 * Asset contract for the shipped `public/models/watchman.glb`.
 *
 * This exists because the rigged export shipped with `POSITION/NORMAL/JOINTS_0/WEIGHTS_0` at 4,055
 * vertices while `TEXCOORD_0` pointed at a 6,235-entry accessor — the *un-welded* mesh's UV buffer.
 * glTF requires every attribute of a primitive to have the same count, so WebGL sampled `uv[i]`
 * against a reordered position stream and the figure rendered as a marble smear rather than a
 * robed shepherd. Nothing about that failure is visible from TypeScript, lint, or a passing build,
 * so the invariant is asserted here against the binary itself.
 *
 * The same test also pins the things the repair had to preserve: the 34-joint skin, the three
 * animation clips, per-vertex weight normalisation, index range, normalized bounds, and the
 * embedded texture. Re-running `scripts/rebuildWatchmanMesh.mjs` must leave every one of these
 * unchanged.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadGlb } from '../scripts/glbAccessors.mjs';

const model = loadGlb(new URL('../public/models/watchman.glb', import.meta.url).pathname);
const [primitive] = model.primitives;
const { attributeCounts } = primitive;
const vertices = attributeCounts.POSITION;

describe('watchman.glb primitive attribute contract', () => {
  it('gives every attribute the same vertex count', () => {
    // The regression that mattered: a UV accessor sized for a different mesh reorders all UVs.
    for (const [semantic, count] of Object.entries(attributeCounts)) {
      assert.equal(count, vertices, `${semantic} has ${count} entries, POSITION has ${vertices}`);
    }
  });

  it('carries the attributes a skinned textured character needs', () => {
    for (const semantic of ['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0', 'TEXCOORD_0']) {
      assert.ok(semantic in attributeCounts, `missing ${semantic}`);
    }
  });

  it('has a material bound to the embedded base-colour texture', () => {
    const material = model.json.materials[primitive.material];
    assert.ok(material, 'primitive has no material');
    const baseColor = material.pbrMetallicRoughness?.baseColorTexture;
    assert.ok(baseColor, 'material has no baseColorTexture');
    const image = model.json.textures[baseColor.index].source;
    assert.equal(model.json.images[image].mimeType, 'image/png');
  });
});

describe('watchman.glb geometry', () => {
  it('indexes within the vertex stream and keeps 8,116 triangles', () => {
    assert.ok(primitive.indices, 'mesh is not indexed');
    assert.equal(primitive.indices.length % 3, 0);
    assert.equal(primitive.indices.length / 3, 8116, 'triangle count changed during repair');
    for (const index of primitive.indices) {
      assert.ok(index < vertices, `index ${index} out of range for ${vertices} vertices`);
    }
  });

  it('is normalized to a unit height box, soles at y=0 and crown at y=1', () => {
    const position = primitive.attributes.POSITION;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertices; i++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = position[3 * i + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
    assert.ok(Math.abs(min[1]) < 1e-6, `soles at y=${min[1]}, expected 0`);
    assert.ok(Math.abs(max[1] - 1) < 1e-6, `crown at y=${max[1]}, expected 1`);
    // x/z recentred, so the figure stands square on the pedestal.
    for (const axis of [0, 2]) {
      const centre = (min[axis] + max[axis]) / 2;
      assert.ok(Math.abs(centre) < 1e-6, `axis ${axis} centre ${centre}, expected 0`);
    }
  });

  it('declares accessor bounds that match the decoded data', () => {
    const uv = model.json.accessors[primitive.semanticIndices.TEXCOORD_0];
    assert.equal(uv.count, vertices, 'declared UV count disagrees with POSITION');
    for (const value of primitive.attributes.TEXCOORD_0) {
      assert.ok(Number.isFinite(value), 'non-finite UV coordinate');
    }
  });
});

describe('watchman.glb rig', () => {
  it('has a single 34-joint skin covering every joint index used', () => {
    const [skin] = model.json.skins;
    assert.ok(skin, 'model has no skin');
    assert.equal(skin.joints.length, 34);
    assert.ok(skin.inverseBindMatrices !== undefined, 'skin has no inverse bind matrices');
    // The skin's matrices must not be confused with a mesh attribute during any repair.
    const meshAccessors = Object.values(primitive.semanticIndices);
    assert.ok(!meshAccessors.includes(skin.inverseBindMatrices));
    for (let i = 0; i < vertices; i++) {
      for (let k = 0; k < 4; k++) {
        assert.ok(
          primitive.attributes.JOINTS_0[4 * i + k] < skin.joints.length,
          `joint index out of range at vertex ${i}`,
        );
      }
    }
  });

  it('normalises skin weights to 1 for every vertex', () => {
    const weights = primitive.attributes.WEIGHTS_0;
    for (let i = 0; i < vertices; i++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += weights[4 * i + k];
      assert.ok(Math.abs(sum - 1) < 1e-4, `vertex ${i} weights sum to ${sum}`);
    }
  });

  it('exposes the three clips the scene binds by name', () => {
    assert.deepEqual(
      model.json.animations.map((clip) => clip.name),
      ['Idle', 'Wave', 'ThumbsUp'],
    );
  });
});
