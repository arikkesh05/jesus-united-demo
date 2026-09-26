/**
 * Pure playback helpers for the reflection audio player.
 *
 * Everything here is deliberately free of DOM and React so it can be verified
 * under `node:test` (see `tests/audioPlayer.test.mjs`) and reused by both the
 * player and the reflection stream. The component owns the `HTMLAudioElement`;
 * this module owns the arithmetic that decides what the user is told.
 *
 * Two invariants run through the file:
 * 1. **No NaN ever reaches the UI.** A media element reports `NaN` for
 *    `duration` until metadata loads, and `Infinity` for a live stream. Every
 *    helper treats a non-finite or negative input as "unknown" and returns the
 *    neutral value rather than propagating it.
 * 2. **Positions are clamped, not wrapped.** Seeking past either end pins to
 *    that end; it never wraps to the opposite side, which would be a
 *    spectacular way to lose a reader's place.
 */

/** Playback rates offered by the speed control, in the order they cycle. */
export const PLAYBACK_SPEEDS: readonly number[] = [1, 1.25, 1.5];

/** Default index into {@link PLAYBACK_SPEEDS} -- normal speed. */
export const DEFAULT_SPEED_INDEX = 0;

/** Seconds of keyboard scrub per arrow press. */
export const SCRUB_STEP_SECONDS = 5;

/** Below this, a track is treated as "no duration yet" rather than as a stub. */
const MIN_TRACK_SECONDS = 0.01;

/**
 * Formats a position as `mm:ss`, widening to `h:mm:ss` past the hour.
 *
 * The player previously emitted `m:ss`, so a nine-second reflection read
 * `0:09` and a sixty-second one read `1:00` -- the digits shifted width as the
 * track ran, which made the counter visibly jitter. Two-digit minutes keep the
 * label a fixed width for every track under an hour.
 */
export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Inverse of {@link formatTimestamp}: parses `ss`, `mm:ss` or `h:mm:ss` back
 * into seconds.
 *
 * Returns `0` for anything unparseable rather than `NaN`, so a corrupt stored
 * position resumes the track at the start instead of disabling the player. A
 * bare number of seconds (`"90"`) is accepted, because that is what the
 * persisted state actually contains.
 */
export function parseTimestamp(value: string): number {
  if (typeof value !== "string") return 0;

  const trimmed = value.trim();
  if (trimmed === "") return 0;

  // A bare numeric value is already seconds -- the persisted shape.
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3) return 0;
  if (!parts.every((part) => /^\d+$/.test(part))) return 0;

  const numbers = parts.map(Number);
  if (numbers.some((part) => !Number.isFinite(part))) return 0;

  // Right-associative: seconds, then minutes, then hours.
  return numbers.reduce((total, part) => total * 60 + part, 0);
}

/** Renders a rate for the speed pills: `1`, `1.25` and `1.5` all read cleanly. */
export function formatSpeedLabel(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return "1x";
  return `${Number(rate.toFixed(2))}x`;
}

/** Clamps any index into the speed list, so a stale stored index cannot throw. */
export function normalizeSpeedIndex(index: number): number {
  if (!Number.isFinite(index)) return DEFAULT_SPEED_INDEX;
  const whole = Math.trunc(index);
  if (whole < 0) return 0;
  if (whole >= PLAYBACK_SPEEDS.length) return PLAYBACK_SPEEDS.length - 1;
  return whole;
}

/**
 * Advances the speed selection by `step`, wrapping at both ends.
 *
 * Cycling is deliberate: a reader who wants normal speed from 1.5x should not
 * have to aim for a specific button, and 1x is the common destination.
 */
export function cycleSpeedIndex(
  index: number,
  step: number = 1,
  length: number = PLAYBACK_SPEEDS.length,
): number {
  if (!Number.isFinite(step) || step === 0 || length <= 0) {
    return normalizeSpeedIndex(index);
  }

  const whole = Math.trunc(step);
  const from = normalizeSpeedIndex(index);
  return (((from + whole) % length) + length) % length;
}

/** The rate a given speed index resolves to, defaulting to normal speed. */
export function speedAtIndex(index: number): number {
  return PLAYBACK_SPEEDS[normalizeSpeedIndex(index)];
}

/**
 * Playhead position as a `0..1` fraction of the track.
 *
 * Returns `0` for an unknown duration, so a progress bar renders empty rather
 * than dividing by zero into `NaN` and collapsing the layout.
 */
export function progressFraction(currentTime: number, duration: number): number {
  if (!hasUsableDuration(duration)) return 0;
  const clamped = clampSeekTime(currentTime, duration);
  return Math.min(1, Math.max(0, clamped / duration));
}

/**
 * Converts a click position on the waveform into a seek target.
 *
 * The fraction is clamped rather than trusted: a pointer can report a
 * coordinate outside the element during a drag that leaves the window, and an
 * unclamped value would seek to a negative or past-the-end time.
 */
export function seekTimeFromFraction(fraction: number, duration: number): number {
  if (!hasUsableDuration(duration)) return 0;
  if (!Number.isFinite(fraction)) return 0;
  return clampSeekTime(Math.min(Math.max(fraction, 0), 1) * duration, duration);
}

/** Human-readable remaining time, e.g. `4 min 12 sec left`. */
export function formatRemainingLabel(
  currentTime: number,
  duration: number,
): string {
  if (!hasUsableDuration(duration)) return "";
  const remaining = Math.max(0, Math.ceil(duration - currentTime));
  if (remaining === 0) return "Finished";
  const minutes = Math.floor(remaining / 60);
  const secs = remaining % 60;
  if (minutes === 0) return `${secs} sec left`;
  if (secs === 0) return `${minutes} min left`;
  return `${minutes} min ${secs} sec left`;
}

/**
 * Whether a rejected `play()` promise was the browser's autoplay policy.
 *
 * `NotAllowedError` means "the user has not interacted yet", which is a normal,
 * recoverable state -- the UI should invite a tap rather than report the track
 * as broken. Every other rejection is a genuine failure.
 */
export function isAutoplayRejection(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "NotAllowedError" || name === "AbortError";
}

/** True once the playhead reaches the end (within one tick of slack). */
export function isPlaybackComplete(
  currentTime: number,
  duration: number,
  tolerance: number = 0.25,
): boolean {
  if (!hasUsableDuration(duration)) return false;
  return currentTime >= duration - tolerance;
}

/** A cue: a moment in the track that a reflection prompt should light up at. */
export interface AudioCue {
  /** Stable identifier, matched against a prompt id. */
  id: string;
  /** Fraction of the track, `0..1`, at which this cue becomes active. */
  at: number;
}

/**
 * Distributes `count` cues evenly across the track, starting after the opening.
 *
 * The first cue is not at `0`: the reader has not heard anything yet at zero,
 * so lighting a prompt immediately would assert a connection before the audio
 * earns one. Spacing the rest evenly is what makes the highlight feel like it
 * is following the narration.
 */
export function buildEvenCues(
  ids: readonly string[],
  duration: number,
): AudioCue[] {
  if (!Array.isArray(ids) || ids.length === 0) return [];

  // Without a duration, fall back to fractions so the caller still gets a
  // stable ordering to render against a track that has not loaded yet.
  if (!hasUsableDuration(duration)) {
    return ids.map((id, index) => ({ id, at: (index + 1) / (ids.length + 1) }));
  }

  const first = 0.1;
  const span = (1 - first) / ids.length;
  return ids.map((id, index) => ({ id, at: first + index * span }));
}

/**
 * The cue active at `currentTime`, or `null` before the first one.
 *
 * Returns the *last* cue whose `at` has passed rather than the next upcoming
 * one, so a position between two cues keeps the earlier prompt lit instead of
 * flickering to nothing.
 */
export function activeCueAt(
  cues: readonly AudioCue[],
  currentTime: number,
  duration: number,
): AudioCue | null {
  if (!Array.isArray(cues) || cues.length === 0) return null;
  if (!Number.isFinite(currentTime) || currentTime < 0) return null;

  // Without a duration every cue's position collapses to 0, which would light
  // *all* of them at once. Nothing is genuinely active until the track has a
  // length to measure against.
  if (!hasUsableDuration(duration)) return null;

  let active: AudioCue | null = null;
  for (const cue of cues) {
    if (!cue || typeof cue.id !== "string" || cue.id.trim() === "") continue;
    if (!Number.isFinite(cue.at) || cue.at < 0 || cue.at > 1) continue;
    if (seekTimeFromFraction(cue.at, duration) <= currentTime) active = cue;
    else break;
  }
  return active;
}

/** Namespaced key so the player's storage cannot collide with the app's. */
export const PLAYBACK_STORAGE_PREFIX = "jesusunited:reflection-audio:v1";

/** Storage key for one track. The source is hashed to a short, stable token. */
export function playbackStorageKey(src: string): string {
  const value = typeof src === "string" ? src.trim() : "";
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return `${PLAYBACK_STORAGE_PREFIX}:${(hash >>> 0).toString(36)}`;
}

/** The slice of playback state worth surviving a navigation. */
export interface PlaybackMemory {
  /** Last known playhead position, in seconds. */
  currentTime: number;
  /** Whether the track reached its end. */
  completed: boolean;
  /** Speed index at the time of writing. */
  speedIndex: number;
}

/** Neutral state for a track that has never been played. */
export function emptyPlaybackMemory(): PlaybackMemory {
  return { currentTime: 0, completed: false, speedIndex: DEFAULT_SPEED_INDEX };
}

/**
 * Reads persisted state, tolerating anything the storage layer hands back.
 *
 * `sessionStorage` throws in private-mode Safari and is absent during SSR, and
 * a truncated write can leave a half-serialised string, so every field is
 * re-validated rather than trusted. A failed read degrades to "never played"
 * and never blocks playback.
 */
export function readPlaybackMemory(raw: string | null): PlaybackMemory {
  const fallback = emptyPlaybackMemory();
  if (typeof raw !== "string" || raw.trim() === "") return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }

  if (typeof parsed !== "object" || parsed === null) return fallback;
  const record = parsed as Partial<PlaybackMemory>;

  const time =
    typeof record.currentTime === "number" && Number.isFinite(record.currentTime)
      ? Math.max(0, record.currentTime)
      : 0;

  return {
    currentTime: time,
    completed: record.completed === true,
    speedIndex: normalizeSpeedIndex(
      typeof record.speedIndex === "number" ? record.speedIndex : NaN,
    ),
  };
}

/** Serialises state for storage; invalid fields are coerced, not dropped. */
export function serializePlaybackMemory(memory: PlaybackMemory): string {
  return JSON.stringify({
    currentTime: Number.isFinite(memory.currentTime)
      ? Math.max(0, memory.currentTime)
      : 0,
    completed: memory.completed === true,
    speedIndex: normalizeSpeedIndex(memory.speedIndex),
  });
}

/**
 * The position to resume at, given what was stored and the track's duration.
 *
 * A completed track restarts from the beginning rather than resuming at the
 * very end, where the first frame would be indistinguishable from "finished"
 * and play would immediately stop again. A position past the end of a shorter
 * track (the reader replayed a longer one earlier in the session) also
 * restarts, which is what the player treats as a fresh listen.
 */
export function resumeTimeFor(memory: PlaybackMemory, duration: number): number {
  if (memory.completed) return 0;
  if (memory.currentTime <= 0) return 0;
  if (hasUsableDuration(duration) && memory.currentTime >= duration) return 0;
  return memory.currentTime;
}

/**
 * Minimal storage surface, so the memory helpers can be exercised against a
 * stub and the real `sessionStorage` at the call site.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}


/** Progress `0..1` toward a cue, used to drive the pulse ramp. */
export function cueProgress(
  cue: AudioCue | null,
  currentTime: number,
  duration: number,
): number {
  if (!cue || !hasUsableDuration(duration)) return 0;
  const target = seekTimeFromFraction(cue.at, duration);
  if (target <= 0) return 0;
  return Math.min(1, Math.max(0, currentTime / target));
}


/** Whether a track has a usable duration yet. */
export function hasUsableDuration(duration: number): boolean {
  return Number.isFinite(duration) && duration >= MIN_TRACK_SECONDS;
}

/** Pins a seek target to `[0, duration]`, or to `0` when the duration is unknown. */
export function clampSeekTime(time: number, duration: number): number {
  if (!Number.isFinite(time) || time < 0) return 0;
  if (!hasUsableDuration(duration)) return 0;
  return Math.min(time, duration);
}
