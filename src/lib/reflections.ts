import { FALLBACK_REFLECTION, FALLBACK_REFLECTION_AUDIO_URL } from '@/lib/reflectionFallback';
import { supabase } from '@/lib/supabase';
import type { Reflection } from '@/lib/types';

/**
 * Containers that WebKit/Safari cannot decode (the retired Google Actions sound
 * library seeded `*.ogg` ambiences into this table). Any such value is replaced
 * with the bundled same-origin MP3 before it reaches the player.
 */
const UNSUPPORTED_AUDIO_PATTERN = /\.(ogg|oga|opus|webm)$/i;

/** Drops any `?query`/`#fragment` suffix so extension checks see the real path. */
function stripQuery(value: string): string {
  return value.split(/[?#]/)[0];
}

/**
 * Normalises `reflection.audio_url` at the data layer so every consumer receives
 * a playable, same-origin-first URL:
 * - `null`, `undefined`, empty or whitespace-only values -> `/audio/daily-reflection.mp3`
 * - Ogg-family values (`morning_birds.ogg`, `gentle_rain.oga`, `*.opus`, `*.webm`)
 *   -> `/audio/daily-reflection.mp3`, because Safari cannot decode that container
 * - everything else (`https://…mp3`, `/media/talk.m4a`, `data:`, `blob:`) is kept
 *   verbatim, so real hosted audio still plays as the primary source.
 */
export function normalizeReflectionAudioUrl(value: unknown): string {
  if (typeof value !== 'string') return FALLBACK_REFLECTION_AUDIO_URL;

  const url = value.trim();
  if (url === '') return FALLBACK_REFLECTION_AUDIO_URL;
  if (UNSUPPORTED_AUDIO_PATTERN.test(stripQuery(url))) return FALLBACK_REFLECTION_AUDIO_URL;

  return url;
}

/** Copies a reflection with its audio URL normalised, leaving every other field intact. */
function withNormalizedAudio(reflection: Reflection): Reflection {
  return {
    ...reflection,
    audio_url: normalizeReflectionAudioUrl(reflection.audio_url),
  };
}

/**
 * Fetches the most recent daily reflection.
 *
 * The local `FALLBACK_REFLECTION` (whose `audio_url` is the bundled
 * `/audio/daily-reflection.mp3`) is returned when Supabase errors, throws, or has
 * no published row yet, so Module 1 always renders a reflection and a playable
 * track - even fully offline or when the stored `audio_url` is missing or Ogg-only.
 */
export async function getDailyReflection(): Promise<Reflection | null> {
  try {
    const { data, error } = await supabase
      .from('reflections')
      .select('*')
      .order('reflection_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching daily reflection, using local fallback reflection:', error.message);
      return FALLBACK_REFLECTION;
    }

    if (!data || typeof data !== 'object') {
      console.error('No daily reflection returned, using local fallback reflection.');
      return FALLBACK_REFLECTION;
    }

    return withNormalizedAudio(data as Reflection);
  } catch (error) {
    console.error('Unexpected error fetching daily reflection, using local fallback reflection:', error);
    return FALLBACK_REFLECTION;
  }
}
