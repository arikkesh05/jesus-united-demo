import { readFileSync } from "node:fs";

/**
 * Accessor-aware GLB reader.
 *
 * The trap this exists to close: a buffer view is selected by `accessor.bufferView`,
 * NOT by the accessor's own index. Indexing `bufferViews` with the accessor index reads a
 * different view, silently producing plausible-looking garbage. The absolute offset is
 * `binStart + bufferViews[accessor.bufferView].byteOffset + (accessor.byteOffset ?? 0)`.
 */
export function loadGlb(path) {
  const bytes = readFileSync(path);
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB container`);
  if (bytes.readUInt32LE(8) !== bytes.length) throw new Error(`${path} header length disagrees`);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  const binStart = 20 + jsonLength + 8;

  const viewOffset = (accessorIndex) => {
    const access = json.accessors[accessorIndex];
    if (access.bufferView === undefined) throw new Error(`accessor ${accessorIndex} has no bufferView`);
    return binStart + (json.bufferViews[access.bufferView].byteOffset ?? 0) + (access.byteOffset ?? 0);
  };

  const readFloats = (accessorIndex, components) => {
    const access = json.accessors[accessorIndex];
    return new Float32Array(
      bytes.buffer,
      bytes.byteOffset + viewOffset(accessorIndex),
      access.count * components,
    );
  };

  const readIndices = (accessorIndex) => {
    const access = json.accessors[accessorIndex];
    const Ctor = access.componentType === 5123 ? Uint16Array : Uint32Array;
    return new Ctor(bytes.buffer, bytes.byteOffset + viewOffset(accessorIndex), access.count);
  };

  const primitives = json.meshes.flatMap((mesh) =>
    mesh.primitives.map((primitive) => {
      const attributes = {};
      /** Accessor *indices* by semantic, kept separate from the decoded arrays. */
      const semanticIndices = { ...primitive.attributes };
      for (const [semantic, accessorIndex] of Object.entries(primitive.attributes)) {
        const access = json.accessors[accessorIndex];
        if (semantic === "JOINTS_0") {
          attributes[semantic] = new Uint16Array(
            bytes.buffer,
            bytes.byteOffset + viewOffset(accessorIndex),
            access.count * 4,
          );
        } else {
          const components = access.type === "VEC2" ? 2 : access.type === "VEC3" ? 3 : 4;
          attributes[semantic] = readFloats(accessorIndex, components);
        }
      }
      return {
        attributes,
        semanticIndices,
        attributeCounts: Object.fromEntries(
          Object.entries(primitive.attributes).map(([s, i]) => [s, json.accessors[i].count]),
        ),
        indices: primitive.indices === undefined ? null : readIndices(primitive.indices),
        material: primitive.material,
      };
    }),
  );

  return { path, bytes, json, binStart, primitives, viewOffset };
}

// --- Structure probe: which accessors serve which role, and are there orphans? --------------------
// A GLB that carries unreferenced accessors is still valid, but it is how a half-finished rewrite
// hides, so the probe makes the roles and the leftovers explicit.
if (process.env.PROBE_STRUCTURE && process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const model = loadGlb(process.argv[2]);
  const j = model.json;
  const accUsers = {};
  j.accessors.forEach((a, i) => {
    const list = accUsers[a.bufferView] ?? [];
    list.push(i);
    accUsers[a.bufferView] = list;
  });
  const animAccessors = new Set();
  for (const anim of j.animations ?? []) {
    for (const channel of anim.channels) {
      // `channel.sampler` is an INDEX into `anim.samplers`, not the sampler object itself.
      const sampler = anim.samplers[channel.sampler];
      if (!sampler) continue;
      animAccessors.add(sampler.input);
      animAccessors.add(sampler.output);
    }
  }
  const skinAccessors = new Set();
  for (const skin of j.skins ?? []) {
    if (skin.inverseBindMatrices !== undefined) skinAccessors.add(skin.inverseBindMatrices);
  }
  const meshAccessors = new Set();
  for (const mesh of j.meshes) {
    for (const prim of mesh.primitives) {
      for (const idx of Object.values(prim.attributes)) meshAccessors.add(idx);
      if (prim.indices !== undefined) meshAccessors.add(prim.indices);
    }
  }
  const usedAccessors = new Set([...animAccessors, ...skinAccessors, ...meshAccessors]);
  const STRUCTURE = {
    // Orphans first: an unreferenced accessor is still valid glTF, but it is how a half-finished
    // rewrite hides, so the probe makes the leftovers explicit.
    orphanAccessors: j.accessors
      .map((a, i) => ({ accessor: i, count: a.count, type: a.type, componentType: a.componentType, bufferView: a.bufferView, min: a.min, max: a.max }))
      .filter((row) => !usedAccessors.has(row.accessor)),
    usedAccessors: [...usedAccessors].sort((a, b) => a - b),
    meshes: j.meshes.map((m) => ({ name: m.name, primitives: m.primitives.length })),
    primitive0: j.meshes[0].primitives[0],
    skins: (j.skins ?? []).map((s) => ({
      name: s.name,
      joints: s.joints.length,
      skeleton: s.skeleton,
      inverseBindMatrices: s.inverseBindMatrices,
    })),
    nodes: j.nodes.length,
    animations: (j.animations ?? []).map((a) => ({
      name: a.name,
      channels: a.channels.length,
      samplers: a.samplers.length,
    })),
    // Which accessors belong to which role. Anything unaccounted for is dead weight we may drop.
    accessorRoles: {
      animation: [...animAccessors].sort((a, b) => a - b),
      skin: [...skinAccessors],
      mesh: [...meshAccessors].sort((a, b) => a - b),
    },
    totals: {
      accessors: j.accessors.length,
      bufferViews: j.bufferViews.length,
      buffers: j.buffers.length,
      binLength: (j.buffers ?? []).map((b) => b.byteLength),
    },
    imageBufferView: (j.images ?? []).map((img) => img.bufferView),
    scene: j.scenes?.[j.scene ?? 0],
    rootNodes: (j.scenes?.[j.scene ?? 0]?.nodes ?? []).length,
    // Exact component types / strides, so a rebuild reuses the existing accessor layout
    // rather than inventing a new one.
    accessorDetail: Object.fromEntries(
      [...meshAccessors].sort((a, b) => a - b).map((i) => {
        const a = j.accessors[i];
        return [i, {
          bufferView: a.bufferView,
          byteOffset: a.byteOffset ?? 0,
          componentType: a.componentType,
          count: a.count,
          type: a.type,
          normalized: a.normalized ?? false,
          min: a.min,
          max: a.max,
        }];
      }),
    ),
    bufferViewDetail: Object.fromEntries(
      (j.bufferViews ?? []).map((v, i) => [i, {
        byteOffset: v.byteOffset ?? 0,
        byteLength: v.byteLength,
        byteStride: v.byteStride ?? null,
        target: v.target ?? null,
      }]),
    ),
  };
  const rendered = JSON.stringify(STRUCTURE, null, 2);
  if (process.env.PROBE_OUT) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env.PROBE_OUT, rendered);
  } else {
    console.log(rendered);
  }
}

// Only when invoked directly: importing this file (for `loadGlb`) must not print a report.
if (process.env.PROBE_PREFLIGHT && process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const model = loadGlb(process.argv[2]);
  const other = loadGlb(process.argv[3]);
  const m = model.json;
  const o = other.json;
  const mPrim = model.primitives[0];
  const oPrim = other.primitives[0];
  // Raw accessor bytes, so "identical stream" is decided by the bytes and not by float decoding.
  const rawBytes = (glb, accessorIndex) => {
    const a = glb.json.accessors[accessorIndex];
    const v = glb.json.bufferViews[a.bufferView];
    const start = glb.binStart + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const sizePerComponent = a.componentType === 5126 || a.componentType === 5125 ? 4 : 2;
    return Buffer.from(glb.bytes.buffer, glb.bytes.byteOffset + start, a.count * sizePerComponent * typeArity(a.type));
  };
  const typeArity = (t) => ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 })[t];
  const result = {
    mUvAccessor: m.accessors[mPrim.semanticIndices.TEXCOORD_0],
    oUvAccessor: o.accessors[oPrim.semanticIndices.TEXCOORD_0],
    mUvFirst: Array.from(mPrim.attributes.TEXCOORD_0.slice(0, 8)),
    oUvFirst: Array.from(oPrim.attributes.TEXCOORD_0.slice(0, 8)),
    uvBytesEqual: Buffer.compare(
      rawBytes(model, mPrim.semanticIndices.TEXCOORD_0),
      rawBytes(other, oPrim.semanticIndices.TEXCOORD_0),
    ) === 0,
    // Where, if anywhere, the two UV streams diverge - a length mismatch and a late/first
    // difference are very different problems, and the repair depends on which it is.
    uvStreamDiff: (() => {
      const a = rawBytes(model, mPrim.semanticIndices.TEXCOORD_0);
      const b = rawBytes(other, oPrim.semanticIndices.TEXCOORD_0);
      const n = Math.min(a.length, b.length);
      let first = -1;
      let diffs = 0;
      let maxAbsUvDelta = 0;
      for (let i = 0; i < n; i++) {
        if (a[i] !== b[i]) {
          if (first < 0) first = i;
          diffs++;
        }
      }
      const fa = new Float32Array(a); // copies, and guarantees 4-byte alignment
      const fb = new Float32Array(b);
      for (let i = 0; i < Math.min(fa.length, fb.length); i++) {
        maxAbsUvDelta = Math.max(maxAbsUvDelta, Math.abs(fa[i] - fb[i]));
      }
      return { aLength: a.length, bLength: b.length, firstDiffByte: first, diffBytes: diffs, maxAbsUvDelta };
    })(),
    mIndexAccessor: m.accessors[mPrim.semanticIndices.indices],
    oIndexAccessor: o.accessors[oPrim.semanticIndices.indices],
    mIndexMax: Math.max(...mPrim.indices),
    oIndexMax: Math.max(...oPrim.indices),
    indicesEqual: mPrim.indices.length === oPrim.indices.length && mPrim.indices.every((v, i) => v === oPrim.indices[i]),
    // Are the two meshes the same surface? Compare triangles by quantised centroid, order-free.
    centroidTriangleKey: (indices, positions) => {
      const seen = new Set();
      for (let t = 0; t < indices.length; t += 3) {
        const pts = [indices[t], indices[t + 1], indices[t + 2]].map((i) =>
          [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]]
            .map((c) => Math.round(c * 1e4))
            .join(":"),
        );
        seen.add([...pts].sort().join("|"));
      }
      return seen;
    },
  };
  result.sharedTriangles = (() => {
    const a = result.centroidTriangleKey(mPrim.indices, mPrim.attributes.POSITION);
    const b = result.centroidTriangleKey(oPrim.indices, oPrim.attributes.POSITION);
    let shared = 0;
    for (const k of a) if (b.has(k)) shared++;
    return { shared, mTotal: a.size, oTotal: b.size };
  })();
  if (process.env.PROBE_OUT) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env.PROBE_OUT, JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify(result, null, 2));
}

// Only when invoked directly: importing this file (for `loadGlb`) must not print a report.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const model = loadGlb(process.argv[2]);
  const [primitive] = model.primitives;
  // `primitive.attributes.SEMANTIC` is already a decoded typed array; the accessor *index* lives on
  // `semanticIndices`. Reading the metadata off the typed array is the same accessor/view mix-up the
  // reader itself exists to prevent.
  const positionAccessor = model.json.accessors[primitive.semanticIndices.POSITION];
  const uvAccessor = model.json.accessors[primitive.semanticIndices.TEXCOORD_0];
  const uv = primitive.attributes.TEXCOORD_0;
  let uvMin = Infinity;
  let uvMax = -Infinity;
  for (const value of uv) {
    uvMin = Math.min(uvMin, value);
    uvMax = Math.max(uvMax, value);
  }
  console.log(
    JSON.stringify(
      {
        path: process.argv[2],
        primitives: model.primitives.length,
        attributeCounts: primitive.attributeCounts,
        positionBounds: positionAccessor.min.concat(positionAccessor.max),
        uvAccessor: { count: uvAccessor.count, declaredMin: uvAccessor.min, declaredMax: uvAccessor.max },
        uvObserved: { min: uvMin, max: uvMax, inUnitRange: uvMin >= -0.001 && uvMax <= 1.001 },
        firstUv: Array.from(uv.slice(0, 8)).map((v) => +v.toFixed(6)),
        material: model.json.materials[primitive.material],
        textures: model.json.textures,
        images: model.json.images,
        clips: (model.json.animations ?? []).map((clip) => clip.name),
      },
      null,
      2,
    ),
  );
}
