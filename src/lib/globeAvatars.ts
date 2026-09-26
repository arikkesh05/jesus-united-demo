/**
 * Storybook avatar gallery for the mission globe (Phase 2 — Task 3.2).
 *
 * Pure catalog + deterministic assignment maths. The texture rasterisation
 * (SVG → canvas → `THREE.CanvasTexture`) lives in the three.js scene so this
 * module stays three-free and unit-testable.
 *
 * Every style maps 1:1 to a self-contained SVG under `public/assets/avatars/`.
 * The scene rasterises those files and falls back to a procedurally drawn badge
 * if a file is ever missing or blocked, so a broken avatar can never appear.
 */

import { stableHashSeed } from "@/lib/globe";

/** Longest public first name a label sprite will show. */
export const MARKER_NAME_MAX_CHARS = 14;
/** Shown when a leader has no usable first name (privacy-safe placeholder). */
export const MARKER_NAME_FALLBACK = "Believer";

export interface AvatarStyle {
  /** Stable key, also used as the texture cache key. */
  id: string;
  /** Storybook character name (used in the accessible marker list). */
  name: string;
  /** Public path to the sprite. */
  file: string;
  /** Halo / ring colour. */
  accent: string;
  skin: string;
  hair: string;
  garment: string;
  /** Soft disc behind the character. */
  backdrop: string;
}

/**
 * Six distinct storybook colourways, all inside the Warm Linen brand palette.
 * Keep this list in sync with `public/assets/avatars/` — the test suite asserts
 * that every catalogued file exists and is a complete, self-contained SVG.
 */
export const AVATAR_STYLES: readonly AvatarStyle[] = [
  {
    id: "grace-sage",
    name: "Grace",
    file: "/assets/avatars/avatar-grace-sage.svg",
    accent: "#8FA88B",
    skin: "#F2D3B6",
    hair: "#4A3A2C",
    garment: "#8FA88B",
    backdrop: "#EDF1E9",
  },
  {
    id: "micah-gold",
    name: "Micah",
    file: "/assets/avatars/avatar-micah-gold.svg",
    accent: "#D4A359",
    skin: "#CE9C74",
    hair: "#2F2620",
    garment: "#D4A359",
    backdrop: "#F8EFDD",
  },
  {
    id: "naomi-terracotta",
    name: "Naomi",
    file: "/assets/avatars/avatar-naomi-terracotta.svg",
    accent: "#C97F5C",
    skin: "#A9714B",
    hair: "#241A14",
    garment: "#C97F5C",
    backdrop: "#F7E7DF",
  },
  {
    id: "elias-slate",
    name: "Elias",
    file: "/assets/avatars/avatar-elias-slate.svg",
    accent: "#6E7C8C",
    skin: "#E8BE9A",
    hair: "#5A4632",
    garment: "#6E7C8C",
    backdrop: "#E9EDF2",
  },
  {
    id: "zuri-plum",
    name: "Zuri",
    file: "/assets/avatars/avatar-zuri-plum.svg",
    accent: "#8E6C88",
    skin: "#7A4B2E",
    hair: "#1F1512",
    garment: "#8E6C88",
    backdrop: "#F0E8F0",
  },
  {
    id: "samuel-olive",
    name: "Samuel",
    file: "/assets/avatars/avatar-samuel-olive.svg",
    accent: "#7E8A5A",
    skin: "#F7DFC6",
    hair: "#8A8378",
    garment: "#7E8A5A",
    backdrop: "#EFF1E4",
  },
];

/**
 * Deterministic gallery index for a gathering id: the same gathering always
 * wears the same storybook avatar, across renders and reloads.
 */
export function avatarStyleIndex(seed: string): number {
  const safeSeed =
    typeof seed === "string" && seed.length > 0 ? seed : MARKER_NAME_FALLBACK;
  return stableHashSeed(safeSeed) % AVATAR_STYLES.length;
}

export function avatarStyleForSeed(seed: string): AvatarStyle {
  return AVATAR_STYLES[avatarStyleIndex(seed)];
}

/**
 * Normalises a public first name for a label sprite: whitespace collapsed, empty
 * or non-string values fall back to `Believer`, and runaway names are trimmed to
 * `MARKER_NAME_MAX_CHARS` so the pill can never overflow the globe.
 */
export function normalizeMarkerName(
  firstName: string | null | undefined,
): string {
  const text =
    typeof firstName === "string" ? firstName.replace(/\s+/g, " ").trim() : "";
  if (text === "") return MARKER_NAME_FALLBACK;
  return text.length > MARKER_NAME_MAX_CHARS
    ? text.slice(0, MARKER_NAME_MAX_CHARS).trimEnd()
    : text;
}
