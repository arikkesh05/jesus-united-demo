/**
 * Measure `public/models/watchman.glb` the way the stage contract measures it: three's own
 * GLTFLoader plus the exact skin-aware vertex path the renderer uses (`Mesh.getVertexPosition`,
 * which applies bone transforms), evaluated in world space over sampled frames of every shipped
 * clip. Dependency-free beyond `three` itself, no DOM, no GPU.
 *
 * Usage:  node scripts/measureWatchmanBounds.mjs [path/to/model.glb]
 *
 * It prints a JSON summary: rest bounds, per-clip bounds, the deepest sole and tallest crown
 * across all clips, the rest + idle silhouette radius and the Wave gesture reach — the numbers
 * `src/lib/watchmanStage.ts` pins. Run it before and after any normalization bake to prove the
 * bake was a pure uniform scale of the fully animated rig.
 */
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Minimal image shim: the GLB embeds a PNG, and three's ImageLoader wants a DOM `<img>`.
 * The loader registers its listeners before assigning `src`, so a microtask tick after the
 * src setter fires `load` with plausible dimensions — GLTFLoader never reads pixels during
 * load, it only needs the element to report success.
 */
globalThis.self = globalThis; // GLTFLoader's image path reaches for `self.URL`.

globalThis.document = {
  createElementNS(_namespace, tag) {
    if (tag !== "img") throw new Error(`unexpected element <${tag}>`);
    const listeners = {};
    return {
      style: {},
      width: 4,
      height: 4,
      naturalWidth: 4,
      naturalHeight: 4,
      addEventListener(type, cb) {
        (listeners[type] ??= []).push(cb);
      },
      removeEventListener() {},
      set src(value) {
        this._src = value;
        queueMicrotask(() => {
          for (const cb of listeners.load ?? []) cb({ type: "load", target: this });
        });
      },
      get src() {
        return this._src;
      },
    };
  },
};

const glbPath = process.argv[2] ?? new URL("../public/models/watchman.glb", import.meta.url).pathname;
const bytes = readFileSync(glbPath);
const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

const loader = new GLTFLoader();

loader.parse(
  arrayBuffer,
  "",
  (gltf) => {
    const { scene, animations } = gltf;
    scene.updateMatrixWorld(true);

    const meshList = [];
    scene.traverse((object) => {
      if (object.isMesh) meshList.push(object);
    });

    /** Bounds accumulator over every mesh vertex in world space. */
    function scan() {
      const box = {
        minY: Infinity, maxY: -Infinity,
        minX: Infinity, maxX: -Infinity,
        minZ: Infinity, maxZ: -Infinity,
        maxRadius: 0, // widest hypot(x, z) from the Y axis
      };
      const vertex = new THREE.Vector3();
      for (const mesh of meshList) {
        const count = mesh.geometry.attributes.position.count;
        for (let i = 0; i < count; i++) {
          mesh.getVertexPosition(i, vertex); // skin-aware local position
          vertex.applyMatrix4(mesh.matrixWorld); // world space
          if (vertex.y < box.minY) box.minY = vertex.y;
          if (vertex.y > box.maxY) box.maxY = vertex.y;
          if (vertex.x < box.minX) box.minX = vertex.x;
          if (vertex.x > box.maxX) box.maxX = vertex.x;
          if (vertex.z < box.minZ) box.minZ = vertex.z;
          if (vertex.z > box.maxZ) box.maxZ = vertex.z;
          const radius = Math.hypot(vertex.x, vertex.z);
          if (radius > box.maxRadius) box.maxRadius = radius;
        }
      }
      return box;
    }

    const round = (box) => ({
      min: [box.minX, box.minY, box.minZ].map((v) => Number(v.toFixed(7))),
      max: [box.maxX, box.maxY, box.maxZ].map((v) => Number(v.toFixed(7))),
      height: Number((box.maxY - box.minY).toFixed(7)),
      maxRadius: Number(box.maxRadius.toFixed(7)),
    });

    const result = { meshes: meshList.length, clips: animations.map((a) => a.name), rest: round(scan()) };

    const mixer = new THREE.AnimationMixer(scene);
    const clipBounds = {};
    for (const clip of animations) {
      const action = mixer.clipAction(clip);
      action.reset().play();
      const merged = {
        minY: Infinity, maxY: -Infinity, minX: Infinity, maxX: -Infinity,
        minZ: Infinity, maxZ: -Infinity, maxRadius: 0,
      };
      const step = clip.duration / Math.max(24, Math.ceil(clip.duration / 0.1));
      for (let t = 0; t <= clip.duration + 1e-6; t += step) {
        mixer.setTime(Math.min(t, clip.duration));
        scene.updateMatrixWorld(true); // the mixer writes quaternions; world matrices must follow
        const frame = scan();
        merged.minY = Math.min(merged.minY, frame.minY);
        merged.maxY = Math.max(merged.maxY, frame.maxY);
        merged.minX = Math.min(merged.minX, frame.minX);
        merged.maxX = Math.max(merged.maxX, frame.maxX);
        merged.minZ = Math.min(merged.minZ, frame.minZ);
        merged.maxZ = Math.max(merged.maxZ, frame.maxZ);
        merged.maxRadius = Math.max(merged.maxRadius, frame.maxRadius);
      }
      clipBounds[clip.name] = round(merged);
      action.stop();
    }
    result.clips_sampled = clipBounds;

    /** The pins the stage contract ships: deepest sole, tallest crown, silhouettes. */
    const all = [result.rest, ...Object.values(clipBounds)];
    result.pins = {
      sole_deepest: Math.min(...all.map((b) => b.min[1])),
      crown_tallest: Math.max(...all.map((b) => b.max[1])),
      rest_radius: result.rest.maxRadius,
      idle_radius: clipBounds.Idle?.maxRadius ?? null,
      wave_reach: clipBounds.Wave?.maxRadius ?? null,
      thumbsup_reach: clipBounds.ThumbsUp?.maxRadius ?? null,
      full_play_radius: Math.max(...all.map((b) => b.maxRadius)),
      rest_width_x: Number((result.rest.max[0] - result.rest.min[0]).toFixed(7)),
    };

    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  },
  (error) => {
    console.error("GLTF parse failed:", error);
    process.exit(1);
  },
);
