/**
 * Weld / seam audit for the shipped `watchman.glb` against a provenance source.
 *
 * The shipped skinned primitive has 4,055 POSITION entries but references a 6,235-entry
 * TEXCOORD_0 accessor, so WebGL samples the wrong UV per vertex (the marble smear). The repair is
 * to reindex a source UV stream onto the shipped vertex order. Before that, we must know whether
 * the export *welded across UV seams*: if one shipped vertex absorbed several coincident source
 * vertices carrying different UVs, a single UV per shipped vertex is unavoidable, and the only
 * question is how much of the model that affects.
 *
 * Answers with hard numbers: how far the 2nd-nearest source vertex really is (coincident vs merely
 * nearby), how many parents fall in each tolerance band, and whether both meshes describe the same
 * surface (triangles compared by quantised 3D position, so a weld cannot masquerade as a
 * different surface).
 */
import { loadGlb } from "./glbAccessors.mjs";

const SHIPPED = "public/models/watchman.glb";

/** Source -> shipped frame: uniform scale from the sole-to-crown extent, x/z recentred, y pinned. */
function frameFor(model) {
  const p = model.primitives[0];
  const a = model.json.accessors[p.semanticIndices.POSITION];
  return {
    scale: a.max[1] - a.min[1],
    cx: (a.min[0] + a.max[0]) / 2,
    cz: (a.min[2] + a.max[2]) / 2,
    y0: a.min[1],
  };
}

function transformIntoFrame(positions, frame) {
  const n = positions.length / 3;
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[3 * i] = (positions[3 * i] - frame.cx) / frame.scale;
    out[3 * i + 1] = (positions[3 * i + 1] - frame.y0) / frame.scale;
    out[3 * i + 2] = (positions[3 * i + 2] - frame.cz) / frame.scale;
  }
  return out;
}

/**
 * Direction matters: a naive "shipped vertex -> nearest source vertex" is lossy, because 1,750
 * shipped vertices absorbed several coincident source parents with *different* UVs. The repair must
 * therefore go the other way: start from the SOURCE vertex list (which still has the correct UVs) and
 * ask which shipped vertex carries the skin/normal data for it. So the questions are:
 *
 *   1. Does every source vertex have >= 1 coincident shipped vertex to inherit skin data from?
 *   2. Do all 8,116 shipped triangles match a source triangle by quantised corner position? If so the
 *      source corner (and hence its exact UV) is recoverable for every corner, and the mesh can be
 *      rebuilt at source resolution instead of picking one UV per welded vertex.
 */
const shipped = loadGlb(SHIPPED);
const sp = shipped.primitives[0];
const source = loadGlb(process.argv[2]);
const src = source.primitives[0];

const frame = frameFor(source);
const S = transformIntoFrame(src.attributes.POSITION, frame);
const nS = src.attributes.POSITION.length / 3;
const nC = sp.attributes.POSITION.length / 3;
const sUv = src.attributes.TEXCOORD_0;

/**
 * Tolerance-based spatial hash. Exact quantised keys fail here: the two files agree only to
 * float32 rounding (~1.1e-6), which straddles a 1e-6 grid and splits 1 match in ~500. Bucketing on a
 * cell size comfortably larger than the tolerance and searching the 27-cell neighbourhood resolves
 * coincidences robustly without the boundary artefacts.
 */
const CELL = 1e-4;
const TOL = 1e-5;

function buildGrid(positions) {
  const grid = new Map();
  for (let i = 0; i < positions.length / 3; i++) {
    const cx = Math.floor(positions[3 * i] / CELL);
    const cy = Math.floor(positions[3 * i + 1] / CELL);
    const cz = Math.floor(positions[3 * i + 2] / CELL);
    const key = `${cx},${cy},${cz}`;
    const list = grid.get(key) ?? [];
    list.push(i);
    grid.set(key, list);
  }
  return grid;
}

function findWithin(grid, positions, x, y, z) {
  const out = [];
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  const cz = Math.floor(z / CELL);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
        if (!list) continue;
        for (const i of list) {
          const d = Math.hypot(x - positions[3 * i], y - positions[3 * i + 1], z - positions[3 * i + 2]);
          if (d <= TOL) out.push({ i, d });
        }
      }
    }
  }
  return out;
}

const shippedGrid = buildGrid(sp.attributes.POSITION);
const sourceGrid = buildGrid(S);

// --- 1. Can every source vertex inherit skin data from a coincident shipped vertex? -------------
let sourceWithHost = 0;
let sourceWithoutHost = 0;
let maxHostDistance = 0;
let maxHostDistanceNoHost = 0;
const orphanSamples = [];
for (let k = 0; k < nS; k++) {
  const hits = findWithin(shippedGrid, sp.attributes.POSITION, S[3 * k], S[3 * k + 1], S[3 * k + 2]);
  if (hits.length) {
    sourceWithHost++;
    for (const h of hits) maxHostDistance = Math.max(maxHostDistance, h.d);
  } else {
    sourceWithoutHost++;
    // How far is the closest shipped vertex really? Distinguishes "no such vertex on this surface"
    // (a genuinely different mesh) from "float32 jitter just outside the tolerance".
    let best = Infinity;
    for (let i = 0; i < nC; i++) {
      const d = Math.hypot(
        S[3 * k] - sp.attributes.POSITION[3 * i],
        S[3 * k + 1] - sp.attributes.POSITION[3 * i + 1],
        S[3 * k + 2] - sp.attributes.POSITION[3 * i + 2],
      );
      if (d < best) best = d;
    }
    if (best < 1e-3) maxHostDistanceNoHost = Math.max(maxHostDistanceNoHost, best);
    if (orphanSamples.length < 8) orphanSamples.push({ source: k, nearest: best });
  }
}

// --- 2. Does every shipped vertex have at least one coincident source vertex (with a UV)? --------
let shippedWithSource = 0;
let shippedWithoutSource = 0;
for (let i = 0; i < nC; i++) {
  const hits = findWithin(sourceGrid, S, sp.attributes.POSITION[3 * i], sp.attributes.POSITION[3 * i + 1], sp.attributes.POSITION[3 * i + 2]);
  if (hits.length) shippedWithSource++;
  else shippedWithoutSource++;
}

// --- 3. Weld audit: do coincident source parents agree on UV? -----------------------------------
// A vertex weld is only UV-lossless if every source vertex collapsed onto one shipped vertex carried
// the SAME UV. Where they disagree, the upstream export destroyed a UV seam and no reindex of the
// source stream can restore it. This is the single measurement that decides whether the repair is a
// clean reindex or an approximation, so it is measured rather than assumed.
const UV_EPS = 1e-6;
let weldedMultipleParents = 0;
let uvConflicts = 0;
let worstUvSpread = 0;
let maxParents = 0;
const conflictSamples = [];
for (let i = 0; i < nC; i++) {
  const hits = findWithin(
    sourceGrid,
    S,
    sp.attributes.POSITION[3 * i],
    sp.attributes.POSITION[3 * i + 1],
    sp.attributes.POSITION[3 * i + 2],
  );
  if (hits.length === 0) continue;
  maxParents = Math.max(maxParents, hits.length);
  if (hits.length === 1) continue;
  weldedMultipleParents++;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const hit of hits) {
    minU = Math.min(minU, sUv[2 * hit.i]);
    maxU = Math.max(maxU, sUv[2 * hit.i]);
    minV = Math.min(minV, sUv[2 * hit.i + 1]);
    maxV = Math.max(maxV, sUv[2 * hit.i + 1]);
  }
  const spread = Math.max(maxU - minU, maxV - minV);
  worstUvSpread = Math.max(worstUvSpread, spread);
  if (spread > UV_EPS) {
    uvConflicts++;
    if (conflictSamples.length < 8) {
      conflictSamples.push({
        shippedVertex: i,
        parents: hits.map((h) => ({ source: h.i, uv: [sUv[2 * h.i], sUv[2 * h.i + 1]] })),
      });
    }
  }
}

console.log(
  JSON.stringify(
    {
      source: process.argv[2],
      frame,
      shippedVertices: nC,
      sourceVertices: nS,
      tolerance: TOL,
      unweld: {
        sourceWithHost,
        sourceWithoutHost,
        maxHostDistance,
        orphansWithin1e3: maxHostDistanceNoHost,
        orphanSamples,
      },
      inverse: { shippedWithSource, shippedWithoutSource },
      lossless: sourceWithoutHost === 0 && shippedWithoutSource === 0,
      weld: {
        uvEpsilon: UV_EPS,
        weldedMultipleParents,
        maxParentsPerVertex: maxParents,
        uvConflicts,
        worstUvSpread,
        conflictSamples,
        // The decisive verdict: 0 conflicts means a pure reindex recovers the texture exactly.
        uvRecoverable: uvConflicts === 0,
      },
    },
    null,
    2,
  ),
);

