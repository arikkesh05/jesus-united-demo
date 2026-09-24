/**
 * One-shot normalization bake for `public/models/watchman.glb`.
 *
 * The FBX2glTF export ships the whole rig — mesh, skeleton, IBM and animation tracks — in a
 * ~0.01-unit-tall coordinate space (crown at 0.0099881, soles already pinned at exactly 0,
 * x/z already centred on the origin). The stage contract expects a unit-height figure, so this
 * script applies ONE uniform scale `s = 1 / crownY` about the origin to every piece of data whose
 * units are world-space:
 *
 *   1. POSITION vertex data (and the accessor's required min/max, recomputed from the quantised
 *      float32 values so they stay spec-exact),
 *   2. every node's local translation (rotations are dimensionless, scales are all 1),
 *   3. the translation column of every bone matrix in the skin (inverse-bind matrices — both the
 *      referenced accessor and FBX2glTF's orphaned duplicate),
 *   4. every animation channel that targets `translation` (the hips root motion).
 *
 * This is the conjugation `S·M·S⁻¹` of the whole rig by the uniform scale `S` (for a pure
 * translation it multiplies the displacement; for rotation/scale it is a no-op), so the fully
 * animated rig renders as an exact `s×` of the original at every frame — rotations keep pivoting
 * about their joints because the IBM translations scale together with the bones. Verified by
 * running `scripts/measureWatchmanBounds.mjs` before and after: every sampled bound matches to
 * float32 precision. TEXCOORD/NORMAL/JOINTS/WEIGHTS/input times are untouched.
 *
 * Guarded against re-running: it aborts if the crown is already at ~1.0.
 *
 * Usage: node scripts/normalizeWatchmanGlb.mjs [path/to/model.glb]
 */
import { readFileSync, writeFileSync } from "node:fs";

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

const path = process.argv[2] ?? new URL("../public/models/watchman.glb", import.meta.url).pathname;
const glb = readFileSync(path);

// --- container ---------------------------------------------------------------------------------
if (glb.readUInt32LE(0) !== GLB_MAGIC) throw new Error("not a GLB container");
if (glb.readUInt32LE(8) !== glb.length) throw new Error("GLB header length disagrees with the file");
const jsonLength = glb.readUInt32LE(12);
if (glb.readUInt32LE(16) !== JSON_CHUNK) throw new Error("first chunk is not JSON");
const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8"));
const binHeader = 20 + jsonLength;
if (glb.readUInt32LE(binHeader + 4) !== BIN_CHUNK) throw new Error("second chunk is not BIN");
const binLength = glb.readUInt32LE(binHeader);
const binStart = binHeader + 8;
if (binStart + binLength !== glb.length) throw new Error("trailing bytes after the BIN chunk");
if (json.buffers.length !== 1 || json.buffers[0].byteLength !== binLength)
  throw new Error("expected exactly one buffer backed by the BIN chunk");

// --- guard: only an un-normalized file may be baked --------------------------------------------
const position = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
if (position.max[1] > 0.9) throw new Error("already normalized (crown is at ~1.0) — refusing to re-bake");
if (position.min[1] !== 0) throw new Error(`soles are not pinned at 0 (min.y = ${position.min[1]})`);
const xCenter = Math.abs(position.min[0] + position.max[0]) / position.max[0];
const zCenter = Math.abs(position.min[2] + position.max[2]) / position.max[2];
if (xCenter > 1e-6 || zCenter > 1e-6) throw new Error("x/z are not centred — bake assumptions broken");

const scale = 1 / position.max[1];
console.log(`scale = ${scale} (crown ${position.max[1]} -> 1.0)`);

// --- binary editing -----------------------------------------------------------------------------
/** Writable copy of the BIN payload; all edits are in place, sizes never change. */
const bin = new Uint8Array(glb.subarray(binStart, binStart + binLength)); // byteOffset 0 copy
const f32 = new Float32Array(bin.buffer);

/** Absolute float start index + element stride (float units) for an accessor. */
function layout(accessor) {
  const view = json.bufferViews[accessor.bufferView];
  if (view.buffer !== 0) throw new Error("accessor references a buffer this script does not own");
  const byteStart = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const bytesPerElement = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type] * 4;
  const byteStride = view.byteStride ?? bytesPerElement;
  if (byteStart % 4 || byteStride % 4) throw new Error("float accessor is not 4-byte aligned");
  return { start: byteStart / 4, strideFloats: byteStride / 4 };
}

/** Iterate an accessor as `count` group bases (float indices). */
function* groups(accessor) {
  const { start, strideFloats } = layout(accessor);
  for (let i = 0; i < accessor.count; i++) yield start + i * strideFloats;
}

// 1. POSITION: scale in place, then recompute the required min/max from the quantised values.
{
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const base of groups(position)) {
    for (let c = 0; c < 3; c++) {
      f32[base + c] *= scale;
      // Re-read after the store: `f32[i] *= s` as an expression yields the pre-quantisation
      // double, but the accessor's min/max must describe the float32 values actually written.
      const value = f32[base + c];
      if (value < min[c]) min[c] = value;
      if (value > max[c]) max[c] = value;
    }
  }
  position.min = [...min];
  position.max = [...max];
  console.log(`POSITION min = ${position.min}\n         max = ${position.max}`);
  if (position.min[1] !== 0 || Math.abs(position.max[1] - 1) > 1e-7)
    throw new Error(`normalisation missed: sole ${position.min[1]}, crown ${position.max[1]}`);
}

// 2. Node local translations.
let scaledNodes = 0;
for (const node of json.nodes) {
  if (!node.translation) continue;
  node.translation = node.translation.map((v) => v * scale);
  scaledNodes++;
}
console.log(`node translations scaled: ${scaledNodes}`);

// 3. Bone matrices (MAT4): conjugation by a uniform scale touches only the translation column.
let scaledMatrices = 0;
const jointCount = json.skins.reduce((n, skin) => Math.max(n, skin.joints.length), 0);
for (const accessor of json.accessors) {
  if (accessor.type !== "MAT4") continue;
  if (accessor.count !== jointCount)
    throw new Error(`MAT4 accessor count ${accessor.count} does not match the ${jointCount} joints`);
  for (const base of groups(accessor)) {
    f32[base + 12] *= scale;
    f32[base + 13] *= scale;
    f32[base + 14] *= scale;
    scaledMatrices++;
  }
}
console.log(`bone matrices scaled: ${scaledMatrices}`);

// 4. Animation translation tracks (deduped — Wave and ThumbsUp share their hips track).
const translationOutputs = new Set();
for (const clip of json.animations)
  for (const channel of clip.channels)
    if (channel.target.path === "translation")
      translationOutputs.add(clip.samplers[channel.sampler].output);
for (const accessorIndex of translationOutputs) {
  const accessor = json.accessors[accessorIndex];
  if (accessor.type !== "VEC3") throw new Error("translation track is not VEC3");
  if (accessor.min || accessor.max) throw new Error("unexpected min/max on an animation output");
  for (const base of groups(accessor)) {
    f32[base] *= scale;
    f32[base + 1] *= scale;
    f32[base + 2] *= scale;
  }
}
console.log(`animation translation tracks scaled: ${translationOutputs.size}`);

// Sanity: the hips joint now sits at ~0.595 world units (0.0059408 × scale), 59.5% of the crown.
const hipsY = json.nodes[2].translation[1];
if (Math.abs(hipsY - 0.5948) > 0.002) throw new Error(`hips landed at ${hipsY}, expected ~0.5948`);

// --- reassemble --------------------------------------------------------------------------------
const jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
const jsonPadding = (4 - (jsonBuf.length % 4)) % 4;
const total = 12 + 8 + jsonBuf.length + jsonPadding + 8 + binLength;
const out = Buffer.alloc(total);
out.writeUInt32LE(GLB_MAGIC, 0);
out.writeUInt32LE(2, 4);
out.writeUInt32LE(total, 8);
out.writeUInt32LE(jsonBuf.length + jsonPadding, 12);
out.writeUInt32LE(JSON_CHUNK, 16);
jsonBuf.copy(out, 20);
out.fill(0x20, 20 + jsonBuf.length, 20 + jsonBuf.length + jsonPadding);
const outBinHeader = 20 + jsonBuf.length + jsonPadding;
out.writeUInt32LE(binLength, outBinHeader);
out.writeUInt32LE(BIN_CHUNK, outBinHeader + 4);
Buffer.from(bin.buffer).copy(out, outBinHeader + 8);

writeFileSync(path, out);
console.log(`wrote ${path} (${total} bytes, was ${glb.length})`);

