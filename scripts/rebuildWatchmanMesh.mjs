/**
 * Rebuild `public/models/watchman.glb` so its skinned primitive is internally consistent again.
 *
 * ## The defect
 *
 * The rigged export indexes 4,055 `POSITION` entries but points `TEXCOORD_0` at a 6,235-entry
 * accessor. That accessor is the *un-welded* mesh's UV buffer (byte-identical declared min/max and
 * first values to `sample12.glb`). glTF requires every attribute of a primitive to have the same
 * count, so WebGL reads `uv[i]` for vertex `i` against a reordered 4,055-position stream — the
 * marble smear. `.git/watchman.glb.pre-normalize` has the identical mismatch, which proves the
 * corruption entered at the FBX export, not at the normalization bake.
 *
 * ## Why a remap is the wrong fix
 *
 * The 4,055-vertex mesh is *welded*: it absorbed the 6,235 source vertices, and 1,750 welded
 * vertices merged parents whose UVs differ (worst spread 0.97). So no single-UV-per-vertex remap
 * can restore the seams — the information needed for it does not exist in the welded mesh.
 *
 * ## What this script does instead
 *
 * Unweld. Restore the source's 6,235 vertices, each with its own correct UV, and inherit
 * `NORMAL` / `JOINTS_0` / `WEIGHTS_0` from the coincident shipped host. The host match is exact
 * (max residual 1.1e-6, float32 noise), so skinning is preserved, and the UV stream becomes 100%
 * correct. Only six mesh buffer views are rewritten; the 34-joint skin, inverse bind matrices, all
 * three animation clips, the node hierarchy, the material, and the embedded 1024x1024 PNG are
 * copied through untouched.
 *
 * Cost: 4,055 -> 6,235 vertices (+54%) at 8,116 triangles. Trivial for the GPU; it is also what
 * correctness demands, since a single-UV-per-vertex mesh cannot carry these seams at all.
 *
 * Usage:
 *   node scripts/rebuildWatchmanMesh.mjs <source.glb>            # dry run: verify + report, no writes
 *   node scripts/rebuildWatchmanMesh.mjs <source.glb> --apply    # rewrite public/models/watchman.glb
 */
import { writeFileSync, copyFileSync } from "node:fs";
import { loadGlb } from "./glbAccessors.mjs";

const TARGET = "public/models/watchman.glb";
const BACKUP = ".git/watchman.glb.pre-unweld";
const COINCIDENT = 1e-5; // generous vs the 1.1e-6 float32 residual, far below any real feature size

const fail = (message) => {
  console.error(`rebuildWatchmanMesh: ${message}`);
  process.exit(1);
};

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const sourcePath = argv.find((a) => !a.startsWith("--"));
if (!sourcePath) fail("usage: node scripts/rebuildWatchmanMesh.mjs <source.glb> [--apply]");

const shipped = loadGlb(TARGET);
const source = loadGlb(sourcePath);
const sp = shipped.primitives[0];
const src = source.primitives[0];
const sj = shipped.json;
const sJson = source.json;
const sPrim = sJson.meshes[0].primitives[0];

const nShipped = sp.attributeCounts.POSITION;
const nSource = src.attributeCounts.POSITION;

// --- Gate: only a UV-count defect is in scope -----------------------------------------------------
// If any other attribute disagrees, this script is aimed at the wrong problem, and proceeding
// would corrupt an otherwise working rig.
for (const [semantic, count] of Object.entries(sp.attributeCounts)) {
  if (semantic !== "TEXCOORD_0" && count !== nShipped) {
    fail(`${semantic} count ${count} != POSITION ${nShipped}: not a UV-only defect, refusing to rewrite`);
  }
}
if (src.attributeCounts.TEXCOORD_0 !== nSource) {
  fail(`source TEXCOORD_0 ${src.attributeCounts.TEXCOORD_0} != source POSITION ${nSource}`);
}
if (!sp.indices || !src.indices) fail("both meshes must be indexed");
if (sp.indices.length !== src.indices.length) {
  fail(`triangle count differs: shipped ${sp.indices.length / 3} vs source ${src.indices.length / 3}`);
}

console.log(JSON.stringify({
  phase: "input",
  shippedVertices: nShipped,
  shippedUvEntries: sp.attributeCounts.TEXCOORD_0,
  sourceVertices: nSource,
  triangles: sp.indices.length / 3,
  clips: (sj.animations ?? []).map((c) => c.name),
  skinJoints: sj.skins?.[0]?.joints?.length ?? 0,
}));

// --- Source -> normalized frame ------------------------------------------------------------------
// Derived from the source's own accessor bounds, not hard-coded, so a future re-export still lands
// on sole-at-0 / crown-at-1 without editing this script.
const sPosAcc = sJson.accessors[sPrim.attributes.POSITION];
const scale = sPosAcc.max[1] - sPosAcc.min[1];
const frame = {
  scale,
  cx: (sPosAcc.min[0] + sPosAcc.max[0]) / 2,
  cz: (sPosAcc.min[2] + sPosAcc.max[2]) / 2,
  y0: sPosAcc.min[1],
};
const sourceInFrame = new Float64Array(nSource * 3);
for (let i = 0; i < nSource; i++) {
  sourceInFrame[3 * i] = (src.attributes.POSITION[3 * i] - frame.cx) / scale;
  sourceInFrame[3 * i + 1] = (src.attributes.POSITION[3 * i + 1] - frame.y0) / scale;
  sourceInFrame[3 * i + 2] = (src.attributes.POSITION[3 * i + 2] - frame.cz) / scale;
}

// --- Correspondence gate -------------------------------------------------------------------------
// Each source vertex must land on exactly one shipped host. Uniform grid bucketing keeps this
// O(n) instead of the O(25M) double loop that made earlier runs unfinishable.
const CELL = COINCIDENT * 4;
const grid = new Map();
const cellKey = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
for (let i = 0; i < nShipped; i++) {
  const key = cellKey(
    sp.attributes.POSITION[3 * i],
    sp.attributes.POSITION[3 * i + 1],
    sp.attributes.POSITION[3 * i + 2],
  );
  const bucket = grid.get(key);
  if (bucket) bucket.push(i);
  else grid.set(key, [i]);
}

const host = new Int32Array(nSource).fill(-1);
let maxResidual = 0;
let unmatched = 0;
for (let i = 0; i < nSource; i++) {
  const x = sourceInFrame[3 * i];
  const y = sourceInFrame[3 * i + 1];
  const z = sourceInFrame[3 * i + 2];
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  const cz = Math.floor(z / CELL);
  let best = -1;
  let bestDistance = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
        if (!bucket) continue;
        for (const i2 of bucket) {
          const d = Math.hypot(
            x - sp.attributes.POSITION[3 * i2],
            y - sp.attributes.POSITION[3 * i2 + 1],
            z - sp.attributes.POSITION[3 * i2 + 2],
          );
          if (d < bestDistance) {
            bestDistance = d;
            best = i2;
          }
        }
      }
    }
  }
  if (bestDistance > COINCIDENT) unmatched++;
  else host[i] = best;
  if (bestDistance > maxResidual) maxResidual = bestDistance;
}
if (unmatched) {
  fail(`${unmatched}/${nSource} source vertices have no shipped host within ${COINCIDENT} (max ${maxResidual})`);
}

const usedHosts = new Set(host);
console.log(JSON.stringify({
  phase: "correspondence",
  frame,
  matched: nSource,
  unmatched,
  distinctHostsUsed: usedHosts.size,
  hostlessShippedVertices: nShipped - usedHosts.size,
  maxResidual,
}));
if (usedHosts.size !== nShipped) {
  fail(`${nShipped - usedHosts.size} shipped vertices are not hosts of any source vertex: geometry mismatch`);
}
// --- Build the unwelded attribute streams ---------------------------------------------------------
// Positions come from the *shipped host* (byte-identical to the current geometry, so bounds and
// skinning stay exactly as they are today). UVs come from the source, one per source vertex, which
// is what restores the seams. NORMAL/JOINTS_0/WEIGHTS_0 are inherited from the host, because a
// welded vertex already carries exactly the skin binding of every source vertex merged into it.
const position = new Float32Array(nSource * 3);
const normal = new Float32Array(nSource * 3);
const joints = new Uint16Array(nSource * 4);
const weights = new Float32Array(nSource * 4);
const texcoord = new Float32Array(nSource * 2);
for (let i = 0; i < nSource; i++) {
  const h = host[i];
  for (let c = 0; c < 3; c++) {
    position[3 * i + c] = sp.attributes.POSITION[3 * h + c];
    normal[3 * i + c] = sp.attributes.NORMAL[3 * h + c];
  }
  for (let c = 0; c < 4; c++) {
    joints[4 * i + c] = sp.attributes.JOINTS_0[4 * h + c];
    weights[4 * i + c] = sp.attributes.WEIGHTS_0[4 * h + c];
  }
  texcoord[2 * i] = src.attributes.TEXCOORD_0[2 * i];
  texcoord[2 * i + 1] = src.attributes.TEXCOORD_0[2 * i + 1];
}
// The index width must follow the declared componentType. Building a Uint32Array while the JSON
// says UNSIGNED_SHORT would write 97,392 bytes that get read as 48,744 halfwords, corrupting every
// triangle while still looking like a valid container.
const indexComponentType = sj.accessors[sj.meshes[0].primitives[0].indices].componentType;
let indices;
if (indexComponentType === 5123) indices = new Uint16Array(src.indices);
else if (indexComponentType === 5125) indices = new Uint32Array(src.indices);
else fail(`unsupported index componentType ${indexComponentType}`);
let maxSourceIndex = 0;
for (const v of indices) if (v > maxSourceIndex) maxSourceIndex = v;
if (maxSourceIndex >= nSource) {
  fail(`source index ${maxSourceIndex} out of range for ${nSource} vertices`);
}
if (indexComponentType === 5123 && maxSourceIndex > 65535) {
  fail(`index ${maxSourceIndex} does not fit UNSIGNED_SHORT; re-export required`);
}

// --- Verification: the surface must be unchanged ---------------------------------------------------
// Compare triangles by quantised *position*, so a weld or reorder cannot hide behind index identity.
// Quantising to 1e-5 is far finer than the 1.1e-6 host residual, so genuine matches are exact.
const Q = 1e5;
const posKey = (arr, v) =>
  `${Math.round(arr[3 * v] * Q)},${Math.round(arr[3 * v + 1] * Q)},${Math.round(arr[3 * v + 2] * Q)}`;
const triKey = (arr, index, t) =>
  [posKey(arr, index[t]), posKey(arr, index[t + 1]), posKey(arr, index[t + 2])].sort().join("|");

const newTris = new Set();
for (let t = 0; t < indices.length; t += 3) newTris.add(triKey(position, indices, t));
let sameTriangles = 0;
for (let t = 0; t < sp.indices.length; t += 3) {
  if (newTris.has(triKey(sp.attributes.POSITION, sp.indices, t))) sameTriangles++;
}

const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < nSource; i++) {
  for (let c = 0; c < 3; c++) {
    bounds.min[c] = Math.min(bounds.min[c], position[3 * i + c]);
    bounds.max[c] = Math.max(bounds.max[c], position[3 * i + c]);
  }
}
const uvBounds = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
for (let i = 0; i < nSource; i++) {
  for (let c = 0; c < 2; c++) {
    uvBounds.min[c] = Math.min(uvBounds.min[c], texcoord[2 * i + c]);
    uvBounds.max[c] = Math.max(uvBounds.max[c], texcoord[2 * i + c]);
  }
}
console.log(JSON.stringify({
  phase: "build",
  newVertexCount: nSource,
  triangles: indices.length / 3,
  sameTriangles,
  positionBounds: { min: bounds.min, max: bounds.max },
  uvBounds,
}));
if (sameTriangles !== indices.length / 3) {
  fail(`only ${sameTriangles}/${indices.length / 3} unwelded triangles match the shipped surface`);
}




// --- Rebuild the container ------------------------------------------------------------------------
// Only the six mesh buffer views are replaced. Everything else — the 36 animation views, the skin's
// inverse bind matrices, and the PNG image view — is copied byte-for-byte.
const prim = sj.meshes[0].primitives[0];
const MESH_ACCESSORS = {
  indices: prim.indices,
  POSITION: prim.attributes.POSITION,
  NORMAL: prim.attributes.NORMAL,
  JOINTS_0: prim.attributes.JOINTS_0,
  WEIGHTS_0: prim.attributes.WEIGHTS_0,
  TEXCOORD_0: prim.attributes.TEXCOORD_0,
};
const newData = {
  indices: new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength),
  POSITION: new Uint8Array(position.buffer, position.byteOffset, position.byteLength),
  NORMAL: new Uint8Array(normal.buffer, normal.byteOffset, normal.byteLength),
  JOINTS_0: new Uint8Array(joints.buffer, joints.byteOffset, joints.byteLength),
  WEIGHTS_0: new Uint8Array(weights.buffer, weights.byteOffset, weights.byteLength),
  TEXCOORD_0: new Uint8Array(texcoord.buffer, texcoord.byteOffset, texcoord.byteLength),
};
const newCount = {
  indices: indices.length,
  POSITION: nSource,
  NORMAL: nSource,
  JOINTS_0: nSource,
  WEIGHTS_0: nSource,
  TEXCOORD_0: nSource,
};
const newBounds = {
  POSITION: { min: bounds.min, max: bounds.max },
  TEXCOORD_0: { min: uvBounds.min, max: uvBounds.max },
};

// The skin's inverse bind matrices must not be confused with a mesh attribute, or a "repair" would
// silently destroy the rig while looking successful.
if (Object.values(MESH_ACCESSORS).includes(sj.skins[0].inverseBindMatrices)) {
  fail("inverse bind matrices share an accessor with a mesh attribute; refusing to rewrite");
}

const oldViews = sj.bufferViews;
const replacedViews = new Map();
for (const [role, accessorIndex] of Object.entries(MESH_ACCESSORS)) {
  replacedViews.set(sj.accessors[accessorIndex].bufferView, role);
}

const align4 = (n) => (n + 3) & ~3;
const chunks = [];
let cursor = 0;
const newViews = oldViews.map((view, i) => {
  const role = replacedViews.get(i);
  const bytes = role
    ? newData[role]
    : shipped.bytes.subarray(
        shipped.binStart + (view.byteOffset ?? 0),
        shipped.binStart + (view.byteOffset ?? 0) + view.byteLength,
      );
  const padding = align4(cursor) - cursor;
  if (padding > 0) {
    chunks.push(Buffer.alloc(padding));
    cursor += padding;
  }
  const out = { ...view, byteOffset: cursor, byteLength: bytes.byteLength };
  chunks.push(Buffer.from(bytes));
  cursor += bytes.byteLength;
  return out;
});

const bin = Buffer.concat(chunks);
const json = structuredClone(sj);
json.bufferViews = newViews;
json.buffers = [{ byteLength: bin.byteLength }];
for (const [role, accessorIndex] of Object.entries(MESH_ACCESSORS)) {
  const access = json.accessors[accessorIndex];
  access.count = newCount[role];
  // NORMAL / JOINTS_0 / WEIGHTS_0 keep the same distribution as the mesh they were copied from, so
  // their declared bounds are already correct and are deliberately left alone.
  if (newBounds[role]) {
    access.min = newBounds[role].min;
    access.max = newBounds[role].max;
  }
}
let maxIndex = 0;
for (const v of indices) if (v > maxIndex) maxIndex = v;
const indexAccess = json.accessors[MESH_ACCESSORS.indices];
if (indexAccess.count !== indices.length) fail("index count drift during emit");

// The shipped index accessor is UNSIGNED_SHORT. A 6,235-vertex mesh still fits, but a larger
// re-export would not, and an overflowing index buffer fails silently as scrambled geometry.
if (indexAccess.componentType === 5123 && maxIndex > 65535) {
  fail(`max index ${maxIndex} overflows UNSIGNED_SHORT; re-export the source instead`);
}

let jsonText = JSON.stringify(json);
jsonText += " ".repeat((4 - (jsonText.length % 4)) % 4);
const jsonBuffer = Buffer.from(jsonText, "utf8");
const total = 20 + jsonBuffer.length + 8 + bin.length;
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546c67, 0);
out.writeUInt32LE(2, 4);
out.writeUInt32LE(total, 8);
out.writeUInt32LE(jsonBuffer.length, 12);
out.writeUInt32LE(0x4e4f534a, 16);
jsonBuffer.copy(out, 20);
const binHeader = 20 + jsonBuffer.length;
out.writeUInt32LE(bin.length, binHeader);
out.writeUInt32LE(0x004e4942, binHeader + 4);
bin.copy(out, binHeader + 8);

console.log(JSON.stringify({
  phase: "emit",
  bytes: total,
  previousBytes: shipped.bytes.length,
  replacedViews: [...replacedViews.entries()].map(([view, role]) => `${view}:${role}`),
  maxIndex,
  indexComponentType: indexAccess.componentType,
}));

if (!apply) {
  console.log("dry run: no file written (pass --apply to rewrite public/models/watchman.glb)");
  process.exit(0);
}
copyFileSync(TARGET, BACKUP);
writeFileSync(TARGET, out);
console.log(`written ${TARGET} (previous state backed up to ${BACKUP})`);
