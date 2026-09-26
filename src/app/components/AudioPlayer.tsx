"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChangeEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { motion, MotionConfig } from "framer-motion";
import {
  PauseIcon,
  PlayIcon,
  RestartIcon,
  VolumeIcon,
  VolumeOffIcon,
} from "@/app/components/icons";
import { FALLBACK_REFLECTION_AUDIO_URL } from "@/lib/reflectionFallback";
import {
  PLAYBACK_SPEEDS,
  SCRUB_STEP_SECONDS,
  activeCueAt,
  buildEvenCues,
  clampSeekTime,
  emptyPlaybackMemory,
  formatRemainingLabel,
  formatSpeedLabel,
  formatTimestamp,
  hasUsableDuration,
  isAutoplayRejection,
  isPlaybackComplete,
  normalizeSpeedIndex,
  playbackStorageKey,
  progressFraction,
  readPlaybackMemory,
  resumeTimeFor,
  seekTimeFromFraction,
  serializePlaybackMemory,
  speedAtIndex,
  type AudioCue,
  type PlaybackMemory,
  type StorageLike,
} from "@/lib/audioEngine";

interface AudioPlayerProps {
  src: string;
  title?: string;
  /**
   * Ordered prompt ids to light up as the track plays. The player spaces them
   * evenly across the duration and reports the active one upward; it never
   * renders the prompts itself.
   */
  cueIds?: readonly string[];
  /** Fires whenever the active cue changes, and with `null` when none is. */
  onActiveCueChange?: (cueId: string | null) => void;
}

/**
 * Deterministic waveform bar profile: the heights are pure functions of the bar
 * index (never `Math.random()`), so the server-rendered markup and the first
 * client render are identical - no hydration mismatch. Values are normalised to
 * `[0.22, 1]` scale factors of the track height.
 */
const WAVEFORM_BAR_COUNT = 32;
const WAVEFORM_BAR_HEIGHTS = Array.from(
  { length: WAVEFORM_BAR_COUNT },
  (_, index) => {
    const wave =
      Math.abs(Math.sin(index * 0.83 + 1.7)) * 0.72 +
      Math.abs(Math.cos(index * 0.31)) * 0.28;
    return 0.22 + 0.78 * Math.min(1, wave);
  },
);

/**
 * Tier 2 of the playback architecture: a bundled, locally synthesised track
 * (`public/audio/daily-reflection.mp3`) served from the same origin. It is always
 * rendered as the final `<source>` candidate, so playback keeps working when the
 * database URL is missing, a third-party host is dead, the container is
 * unsupported by the browser, or the client is completely offline.
 */
const FALLBACK_SRC = FALLBACK_REFLECTION_AUDIO_URL;

/** `<source type>` MIME hints, keyed by file extension. */
const AUDIO_MIME_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  webm: "audio/webm",
};

const AUDIO_FILE_PATTERN = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;

/**
 * Ogg-family containers cannot be decoded by WebKit/Safari, so those values are
 * swapped for the bundled MP3 before any `<source>` is rendered - the player
 * never advertises a candidate Safari is guaranteed to reject.
 */
const WEBKIT_UNSUPPORTED_PATTERN = /\.(ogg|oga|opus|webm)$/i;

/** Labels for `HTMLMediaElement.error.code`, read without touching DOM globals. */
const MEDIA_ERROR_LABELS: Record<number, string> = {
  1: "MEDIA_ERR_ABORTED: the fetch was aborted",
  2: "MEDIA_ERR_NETWORK: a network error interrupted the download",
  3: "MEDIA_ERR_DECODE: the file could not be decoded",
  4: "MEDIA_ERR_SRC_NOT_SUPPORTED: the source is missing or its format is unsupported",
};

/** Drops any `?query`/`#fragment` suffix so extension checks see the real path. */
function stripQuery(value: string): string {
  return value.split(/[?#]/)[0];
}

/**
 * Normalises the `reflection.audio_url` value coming from Supabase (the data layer
 * already replaces missing/Ogg URLs, so this is the client-side safety net):
 * - `blob:`/`data:` values are used verbatim.
 * - `http(s)://`, `//host` and root-relative values are kept as-is.
 * - Bare filenames (`sermon.mp3`) resolve into `public/audio/`.
 * - Any other relative path is treated as root-relative.
 * - Empty values, and any URL whose path ends in an Ogg-family container, resolve
 *   to the bundled MP3.
 */
function resolveAudioSrc(value: string): string {
  const src = value.trim();
  if (src === "") return FALLBACK_SRC;
  if (/^(blob|data):/i.test(src)) return src;

  let local = src;
  if (!/^(https?:)?\/\//i.test(src)) {
    if (src.startsWith("/")) {
      local = src;
    } else if (!src.includes("/") && AUDIO_FILE_PATTERN.test(src)) {
      local = `/audio/${src}`;
    } else {
      local = `/${src}`;
    }
  }

  return WEBKIT_UNSUPPORTED_PATTERN.test(stripQuery(local))
    ? FALLBACK_SRC
    : local;
}

/** Resolves the `<source type>` MIME hint; `undefined` omits the attribute entirely. */
function resolveAudioType(src: string): string | undefined {
  const match = /\.([a-z0-9]+)$/i.exec(stripQuery(src));
  if (!match) return undefined;
  return AUDIO_MIME_TYPES[match[1].toLowerCase()];
}

/**
 * Session storage, or `null` where it is unavailable.
 *
 * Private-mode Safari throws on the *first property access*, not just on write,
 * so the getter itself is guarded -- an unguarded `window.sessionStorage` would
 * take the whole player down on exactly the devices least able to run audio.
 */
function getSessionStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export default function AudioPlayer({
  src,
  title,
  cueIds,
  onActiveCueChange,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);
  const [isScrubTrackHovered, setIsScrubTrackHovered] = useState(false);
  const [isAutoplayBlocked, setIsAutoplayBlocked] = useState(false);
  const [hasCompleted, setHasCompleted] = useState(false);
  /** Guards the resume effect so a later `src` change re-applies it exactly once. */
  const hasRestoredRef = useRef(false);
  /** Latest cue callback, so the timeupdate handler never closes over a stale one. */
  const cueCallbackRef = useRef(onActiveCueChange);
  const lastCueIdRef = useRef<string | null>(null);

  useEffect(() => {
    cueCallbackRef.current = onActiveCueChange;
  }, [onActiveCueChange]);

  const primarySrc = resolveAudioSrc(src);
  const primaryType = resolveAudioType(primarySrc);
  const hasDuration = hasUsableDuration(duration);
  const progress = progressFraction(currentTime, duration) * 100;
  const showsFallbackNotice = usingFallback && primarySrc !== FALLBACK_SRC;
  /** The transport control never claims to be playing while the badge reports a failure. */
  const showPlaying = isPlaying && !hasError;
  const remainingLabel = formatRemainingLabel(currentTime, duration);
  /**
   * True once the reader has heard the whole track. Distinct from `hasCompleted`
   * (which is persisted and cleared by restart): this one is derived from the
   * playhead, so it reflects the current position rather than stored history.
   */
  const hasListenedToEnd = isPlaybackComplete(currentTime, duration);

  /** Cues are spaced over the track once its length is known. */
  const cues: AudioCue[] = buildEvenCues(cueIds ?? [], duration);
  const activeCue = activeCueAt(cues, currentTime, duration);
  const activeCueId = hasDuration ? activeCue?.id ?? null : null;

  /**
   * The media element reports which `<source>` candidate it actually loaded, so
   * the "bundled track" notice reflects real resource selection instead of a guess.
   */
  const syncFallbackNotice = (audio: HTMLAudioElement) => {
    const selected = audio.currentSrc;
    if (!selected || primarySrc === FALLBACK_SRC) {
      setUsingFallback(false);
      return;
    }
    try {
      setUsingFallback(
        selected === new URL(FALLBACK_SRC, window.location.href).href,
      );
    } catch {
      // `currentSrc` can be an opaque URL (blob:/data:); leave the notice untouched.
    }
  };

  /** Reads the element's live metadata into React state. `duration` is never NaN. */
  const syncFromElement = (audio: HTMLAudioElement) => {
    const mediaDuration = audio.duration;
    setDuration(hasUsableDuration(mediaDuration) ? mediaDuration : 0);
    if (Number.isFinite(audio.currentTime) && audio.currentTime > 0) {
      setCurrentTime(audio.currentTime);
    }
    if (audio.error) setHasError(true);
    syncFallbackNotice(audio);
    // Restored here rather than in an effect: this is the first event that
    // proves the track is real, it runs at most once, and it keeps the resume
    // off the render path entirely.
    restorePlayback(audio);
  };

  /**
   * Applies the reader's saved place, exactly once per mount.
   *
   * Called from the metadata handlers rather than a `useEffect` on purpose. The
   * position can only be clamped against a real `duration`, which does not exist
   * until metadata lands, and a media event is the honest moment to act on it --
   * an effect would fire against a NaN duration and silently discard the very
   * position it was trying to restore.
   */
  const restorePlayback = (audio: HTMLAudioElement) => {
    if (hasRestoredRef.current) return;
    if (!hasUsableDuration(audio.duration)) return;
    hasRestoredRef.current = true;

    const storage = getSessionStorage();
    const memory = readPlaybackMemory(
      storage ? storage.getItem(playbackStorageKey(primarySrc)) : null,
    );

    const resumeAt = resumeTimeFor(memory, audio.duration);
    if (resumeAt > 0) {
      audio.currentTime = resumeAt;
      setCurrentTime(resumeAt);
    }

    if (memory.completed) setHasCompleted(true);

    // Only applied when it differs, so a normal-speed resume does not fight the
    // element's own default.
    if (memory.speedIndex !== 0) {
      setSpeedIndex(memory.speedIndex);
      audio.playbackRate = speedAtIndex(memory.speedIndex);
    }
  };

  /**
   * Ref callback: registers the element and immediately syncs state from it.
   * A fast same-origin asset can finish loading *before* hydration attaches the
   * media listeners (`loadedmetadata`, `canplay` and `durationchange` have then
   * already fired), which left the counter stuck at `0:00 / 0:00`. Reading the
   * element at commit time closes that race deterministically.
   */
  const attachAudioElement = (node: HTMLAudioElement | null) => {
    audioRef.current = node;
    if (!node) return;
    syncFromElement(node);
    node.playbackRate = speedAtIndex(speedIndex);
    node.muted = isMuted;
  };

  /** Bound to both `loadedmetadata` and `canplay`, so a late `error` self-heals. */
  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;

    setHasError(false);
    syncFromElement(audio);
    audio.playbackRate = speedAtIndex(speedIndex);
    audio.muted = isMuted;
  };

  const handleDurationChange = () => {
    const audio = audioRef.current;
    if (!audio) return;
    syncFromElement(audio);
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    setCurrentTime(position);
    // Scrubbing back into a finished track makes it unfinished again. Done here
    // rather than in an effect so the flag changes with the playhead that caused
    // it, instead of a render later.
    if (position > 0 && hasCompleted) setHasCompleted(false);
    // Safety net: if the metadata events were missed entirely (see
    // `attachAudioElement`), the first `timeupdate` still repairs the duration.
    if (!hasDuration && hasUsableDuration(audio.duration)) {
      setDuration(audio.duration);
    }
  };

  /** Persists position, completion and rate so a navigation does not lose the place. */
  const persistMemory = useCallback(
    (overrides?: Partial<PlaybackMemory>) => {
      const storage = getSessionStorage();
      if (!storage) return;
      try {
        const memory: PlaybackMemory = {
          ...emptyPlaybackMemory(),
          currentTime,
          completed: hasCompleted,
          speedIndex,
          ...overrides,
        };
        storage.setItem(
          playbackStorageKey(primarySrc),
          serializePlaybackMemory(memory),
        );
      } catch {
        // A full or blocked quota must never interrupt playback.
      }
    },
    [currentTime, hasCompleted, primarySrc, speedIndex],
  );

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    setHasCompleted(true);
    persistMemory({ currentTime: 0, completed: true });
  };

  /**
   * Fires only when *every* `<source>` candidate has failed, so the unavailable
   * badge is never shown while a playable candidate still exists. If metadata
   * arrives afterwards anyway, `handleLoadedMetadata` clears the badge again.
   */
  const handleAudioError = () => {
    const audio = audioRef.current;
    const mediaError = audio?.error ?? null;

    console.error(
      `Audio source failed to load (code ${mediaError?.code ?? "n/a"}): ${
        mediaError
          ? (MEDIA_ERROR_LABELS[mediaError.code] ?? "unknown media error")
          : "no media error"
      }`,
      {
        primarySrc,
        requestedSrc: src,
        selectedSrc: audio?.currentSrc ?? null,
        errorCode: mediaError?.code ?? null,
        errorMessage: mediaError?.message ?? null,
        networkState: audio?.networkState ?? null,
        readyState: audio?.readyState ?? null,
      },
    );

    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setHasError(true);
    setUsingFallback(false);
    setIsAutoplayBlocked(false);
  };

  /** Promise-safe play/pause with a defensive reload-and-retry recovery pass. */
  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    try {
      // `error` is only ever set once *every* `<source>` candidate has failed, at
      // which point some engines leave `play()` pending forever instead of
      // rejecting. Route that state straight into the recovery branch below so
      // the UI never shows a fake "playing" pause button.
      if (audio.error) {
        throw new Error(`unplayable media element (code ${audio.error.code})`);
      }

      await audio.play();
      setIsPlaying(true);
      setHasError(false);
      setIsAutoplayBlocked(false);
    } catch (err: unknown) {
      // The autoplay policy is a *policy*, not a fault: the track is fine and the
      // reader simply has not interacted yet. Surfacing it as an error badge
      // would tell them the audio is broken when one more tap fixes it.
      if (isAutoplayRejection(err)) {
        setIsAutoplayBlocked(true);
        setIsPlaying(false);
        setHasError(false);
        return;
      }

      console.warn(
        "Primary audio play blocked or failed, retrying reload:",
        err,
      );
      // Defensive recovery: re-run resource selection over the candidate list, then retry.
      audio.load();
      try {
        await audio.play();
        setIsPlaying(true);
        setHasError(false);
        setIsAutoplayBlocked(false);
      } catch (finalErr: unknown) {
        console.error("Audio playback fully rejected:", finalErr, {
          primarySrc,
          requestedSrc: src,
          selectedSrc: audio.currentSrc,
          mediaError: audio.error?.message ?? null,
        });
        setIsPlaying(false);
        setHasError(true);
      }
    }
  };

  /** Re-runs resource selection over the same candidates (a fresh load attempt). */
  const retrySource = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setHasError(false);
    setUsingFallback(false);
    audioRef.current?.load();
  };

  const handleSeek = (event: ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    const next = Number(event.target.value);
    if (!Number.isFinite(next)) return;
    const clamped = clampSeekTime(next, duration);
    setCurrentTime(clamped);
    if (audio && hasDuration) audio.currentTime = clamped;
  };

  /**
   * Click-to-seek on the waveform itself.
   *
   * The slider below already covers keyboard and drag; this is the affordance
   * for pointing at a moment, which is how people actually navigate audio. The
   * fraction is measured against the element's own box and clamped in
   * `seekTimeFromFraction`, because a pointer that leaves the window mid-press
   * can report a coordinate outside it.
   */
  const handleWaveformClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !hasDuration) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;

    const fraction = (event.clientX - bounds.left) / bounds.width;
    const next = seekTimeFromFraction(fraction, duration);
    audio.currentTime = next;
    setCurrentTime(next);
    persistMemory({ currentTime: next });
  };

  /**
   * Returns the playhead to the start and clears the completed flag.
   *
   * Seeking to zero is not enough on its own: a finished track is stored as
   * complete, and the next mount would treat that as "already done". Clearing
   * the flag is what makes restart stick.
   */
  const handleRestart = () => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = 0;
    setCurrentTime(0);
    setHasCompleted(false);
    persistMemory({ currentTime: 0, completed: false });
  };

  /** Applies a speed preset and mirrors it onto the live media element. */
  const setSpeed = (index: number) => {
    const audio = audioRef.current;
    const safeIndex = normalizeSpeedIndex(index);
    setSpeedIndex(safeIndex);
    if (audio) audio.playbackRate = speedAtIndex(safeIndex);
    persistMemory({ speedIndex: safeIndex });
  };

  /** Reports the active cue upward, but only when it actually changes. */
  useEffect(() => {
    if (lastCueIdRef.current === activeCueId) return;
    lastCueIdRef.current = activeCueId;
    cueCallbackRef.current?.(activeCueId);
  }, [activeCueId]);

  /** Persists the playhead periodically so a nav loses at most a few seconds. */
  useEffect(() => {
    if (!hasDuration || currentTime <= 0) return;
    const timer = window.setInterval(() => {
      persistMemory();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [currentTime, hasDuration, persistMemory]);

  const toggleMute = () => {
    const audio = audioRef.current;
    const next = !isMuted;
    setIsMuted(next);
    if (audio) audio.muted = next;
  };

  /**
   * Group-level keyboard support (fires only when the player shell itself is
   * focused, so buttons and the scrub slider keep their native behaviour):
   * - Space toggles play/pause.
   * - Left/Right arrows scrub ±5 seconds.
   */
  const handlePlayerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;

    if (event.key === " ") {
      event.preventDefault();
      void togglePlay();
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const audio = audioRef.current;
      const mediaDuration = audio?.duration ?? 0;
      if (!audio || !hasUsableDuration(mediaDuration)) return;

      event.preventDefault();
      const offset =
        event.key === "ArrowLeft" ? -SCRUB_STEP_SECONDS : SCRUB_STEP_SECONDS;
      // Arrow-left from the very start restarts, matching every other player:
      // holding rewind should not be the only way back to zero.
      if (event.key === "ArrowLeft" && audio.currentTime <= 0) {
        handleRestart();
        return;
      }
      const next = clampSeekTime(
        audio.currentTime + offset,
        mediaDuration,
      );
      audio.currentTime = next;
      setCurrentTime(next);
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div
        tabIndex={0}
        onKeyDown={handlePlayerKeyDown}
        aria-label={
          hasError
            ? "Reflection audio player unavailable"
            : `Reflection audio player. Space to ${showPlaying ? "pause" : "play"}, left and right arrows to scrub, left arrow at the start to restart`
        }
        className="group rounded-2xl border border-white/10 bg-pill/70 p-4 shadow-md outline-none backdrop-blur-xl transition-shadow duration-300 focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas hover:shadow-lg"
      >
        {/*
          No `src` attribute on the media element on purpose: a `src` on <audio>
          takes precedence over <source> children and would defeat the multi-tier
          fallback. The guaranteed same-origin MP3 is always the last candidate.
        */}
        <audio
          key={primarySrc}
          ref={attachAudioElement}
          preload="metadata"
          className="hidden"
          onLoadedMetadata={handleLoadedMetadata}
          onCanPlay={handleLoadedMetadata}
          onDurationChange={handleDurationChange}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={handleEnded}
          onError={handleAudioError}
        >
          {/* Tier 1: the reflection's own URL (hosted, root-relative, blob: or data:). */}
          <source src={primarySrc} type={primaryType} />
          {/* Tier 2: guaranteed local MP3 - works offline, on WebKit, and everywhere else. */}
          <source src={FALLBACK_SRC} type="audio/mpeg" />
        </audio>

        <div className="flex items-center gap-3.5">
          {/* Spring play/pause transport with gold ring highlight */}
          <motion.button
            type="button"
            onClick={togglePlay}
            disabled={hasError}
            whileTap={hasError ? undefined : { scale: 0.95 }}
            aria-label={
              showPlaying ? "Pause the reflection" : "Play the reflection"
            }
            aria-pressed={showPlaying}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold text-canvas shadow-sm ring-2 ring-transparent transition-[background-color,box-shadow] duration-200 hover:bg-gold-deep hover:shadow-md focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-gold disabled:hover:shadow-none"
          >
            {showPlaying ? (
              <PauseIcon className="h-5 w-5" />
            ) : (
              <PlayIcon className="ml-0.5 h-5 w-5" />
            )}
          </motion.button>

          <motion.button
            type="button"
            onClick={handleRestart}
            disabled={hasError}
            whileTap={hasError ? undefined : { scale: 0.95 }}
            aria-label="Restart the reflection from the beginning"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-sand bg-pill/80 p-2.5 text-muted transition-colors duration-200 hover:border-gold hover:text-espresso focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RestartIcon className="h-4 w-4" />
          </motion.button>

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-sm font-bold text-espresso">
                {title ?? "Reflection audio"}
              </p>
              <p className="shrink-0 text-xs font-medium tabular-nums text-muted">
                {formatTimestamp(currentTime)} /{" "}
                {formatTimestamp(duration || 0)}
              </p>
            </div>

            {/*
              Waveform: a real seek target, not decoration.
              `aria-hidden` stays because the range input below is the
              accessible control -- exposing a second, redundant seek surface
              to assistive tech would mean two controls for one job. The
              cursor and hover affordances tell sighted users it is clickable.
            */}
            <div
              aria-hidden="true"
              onClick={handleWaveformClick}
              className={`mt-2.5 flex h-9 items-center justify-between gap-[3px] ${
                hasDuration
                  ? "cursor-pointer rounded-md"
                  : "cursor-default"
              }`}
            >
              {WAVEFORM_BAR_HEIGHTS.map((height, index) => {
                const played = hasDuration
                  ? index / WAVEFORM_BAR_COUNT <= progress / 100
                  : false;
                return (
                  <motion.span
                    key={index}
                    className={`w-full origin-center rounded-full transition-colors duration-300 ${
                      played ? "bg-gold" : "bg-sand"
                    }`}
                    style={{ height: `${Math.round(height * 100)}%` }}
                    animate={
                      showPlaying ? { scaleY: [1, 0.45, 1] } : { scaleY: 1 }
                    }
                    transition={
                      showPlaying
                        ? {
                            duration: 1.05 + (index % 5) * 0.14,
                            repeat: Infinity,
                            ease: "easeInOut",
                            delay: (index % 7) * 0.09,
                          }
                        : { type: "spring", stiffness: 320, damping: 24 }
                    }
                  />
                );
              })}
            </div>

            {/* Interactive scrub track with hover thumb indicator */}
            <div className="relative mt-2 h-4">
              <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-sand" />
              <div
                className="absolute top-1/2 left-0 h-2 -translate-y-1/2 rounded-full bg-gradient-to-r from-gold-deep to-gold"
                style={{ width: `${progress}%` }}
              />
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-gold shadow transition-all duration-150 ease-out ${
                  isScrubTrackHovered
                    ? "scale-110 opacity-100"
                    : "scale-75 opacity-0"
                }`}
                style={{ left: `${progress}%` }}
              />
              <input
                type="range"
                min={0}
                max={hasDuration ? duration : 0}
                step={0.1}
                value={hasDuration ? Math.min(currentTime, duration) : 0}
                onChange={handleSeek}
                onMouseEnter={() => setIsScrubTrackHovered(true)}
                onMouseLeave={() => setIsScrubTrackHovered(false)}
                disabled={!hasDuration}
                aria-label="Seek through the reflection"
                aria-valuetext={`${formatTimestamp(currentTime)} of ${formatTimestamp(duration || 0)}`}
                className="absolute inset-0 h-4 w-full cursor-pointer appearance-none rounded-full bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-gold [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gold"
              />
            </div>

            {/* Mute + playback-speed segmented control */}
            <div className="mt-3 flex items-center justify-between gap-2">
              <motion.button
                type="button"
                onClick={toggleMute}
                whileTap={{ scale: 0.92 }}
                aria-label={
                  isMuted ? "Unmute the reflection" : "Mute the reflection"
                }
                aria-pressed={isMuted}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-sand bg-pill/80 text-muted transition-colors duration-200 hover:border-gold hover:text-espresso"
              >
                {isMuted ? (
                  <VolumeOffIcon className="h-4 w-4" />
                ) : (
                  <VolumeIcon className="h-4 w-4" />
                )}
              </motion.button>

              <div
                role="group"
                aria-label="Playback speed"
                className="flex items-center gap-0.5 rounded-full border border-sand bg-pill/70 p-0.5"
              >
                {PLAYBACK_SPEEDS.map((speed, index) => {
                  const isActive = speedIndex === index;
                  return (
                    <button
                      key={speed}
                      type="button"
                      onClick={() => setSpeed(index)}
                      aria-pressed={isActive}
                      aria-label={`Playback speed ${formatSpeedLabel(speed)}${isActive ? " (active)" : ""}`}
                      className={`relative rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums transition-colors duration-200 ${
                        isActive
                          ? "text-espresso"
                          : "text-muted hover:text-espresso"
                      }`}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="audio-speed-pill"
                          className="absolute inset-0 rounded-full bg-pill shadow-sm ring-1 ring-white/10"
                          transition={{
                            type: "spring",
                            stiffness: 450,
                            damping: 35,
                          }}
                        />
                      )}
                      <span className="relative">
                        {formatSpeedLabel(speed)}
                      </span>
                    </button>
                  );
                })}
              </div>

              {remainingLabel ? (
                <p className="shrink-0 text-[11px] font-medium tabular-nums text-muted/80">
                  {hasListenedToEnd ? "Listened to the end" : remainingLabel}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {isAutoplayBlocked ? (
          // A policy pause, not a fault: the track is fine, the browser just
          // wants a gesture first. Inviting the tap instead of showing the
          // "unavailable" badge keeps the two very different states distinct.
          <p
            role="status"
            aria-live="polite"
            className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-full border border-sand bg-pill px-3 py-1.5 text-xs font-bold text-espresso/80"
          >
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-gold" />
            Tap play to start the reflection
          </p>
        ) : hasError ? (
          <p
            role="status"
            aria-live="polite"
            className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-full border border-amber-300/70 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-900"
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-amber-500"
            />
            Audio temporarily unavailable
            <button
              type="button"
              onClick={retrySource}
              className="font-bold underline underline-offset-2"
            >
              Retry
            </button>
          </p>
        ) : showsFallbackNotice ? (
          <p
            role="status"
            aria-live="polite"
            className="mt-3 rounded-2xl border border-sand bg-pill px-3 py-2 text-xs leading-5 text-espresso/80"
          >
            The original reflection source could not be reached, so the bundled
            track is playing instead.{" "}
            <button
              type="button"
              onClick={retrySource}
              className="font-bold text-pill-ink underline underline-offset-2"
            >
              Retry the original source
            </button>
            .
          </p>
        ) : null}
      </div>
    </MotionConfig>
  );
}
