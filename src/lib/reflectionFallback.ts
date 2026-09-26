import type { Reflection } from "@/lib/types";

/**
 * Tier 2 of the audio architecture: the canonical, same-origin MP3 that ships in
 * `public/audio/daily-reflection.mp3`.
 *
 * Every fallback path in the app - the data layer, the player's second
 * `<source>` candidate, and the UI notices - resolves to this single constant so
 * the guaranteed track can never drift out of sync between layers.
 */
export const FALLBACK_REFLECTION_AUDIO_URL = "/audio/daily-reflection.mp3";

/**
 * Local fallback reflection used when the `reflections` table is unreachable,
 * empty, or returns a row that cannot be used. It mirrors the live table shape
 * so Module 1 always has a complete reflection (and a playable track) to render.
 */
export const FALLBACK_REFLECTION: Reflection = {
  id: "fallback-daily-reflection",
  title: "Be Still and Know",
  scripture_reference: "Psalm 46:10",
  reflection_text:
    "Be still, and know that I am God. Before the day asks anything of you, let this moment be an altar.\n\nStillness is not the absence of noise; it is the presence of God. The world will keep moving, the messages will keep arriving, and the work will still be waiting when you rise. But the soul that pauses first is the soul that can carry the rest of the day without being carried away by it.\n\nSo breathe slowly, name one thing you are grateful for, and hand one worry over to the One who holds the mountains. He is not distant from your ordinary Tuesday. He is nearer than your next breath.\n\nGo gently today, and let His peace walk ahead of you.",
  audio_url: FALLBACK_REFLECTION_AUDIO_URL,
  reflection_date: "2026-09-16",
  created_at: "2026-09-15T08:55:53.399007+00:00",
};
