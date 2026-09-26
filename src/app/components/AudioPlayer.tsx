"use client";

import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { motion, MotionConfig } from "framer-motion";
import {
  PauseIcon,
  PlayIcon,
  VolumeIcon,
  VolumeOffIcon,
} from "@/app/components/icons";
import { FALLBACK_REFLECTION_AUDIO_URL } from "@/lib/reflectionFallback";

interface AudioPlayerProps {
  src: string;
  title?: string;
}

const SPEEDS = [1, 1.25, 1.5];

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

/** Keyboard scrub step (seconds) for Left/Right arrows on the player group. */
const SCRUB_STEP_SECONDS = 5;

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

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export default function AudioPlayer({ src, title }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);
  const [isScrubTrackHovered, setIsScrubTrackHovered] = useState(false);

  const primarySrc = resolveAudioSrc(src);
  const primaryType = resolveAudioType(primarySrc);
  const hasDuration = Number.isFinite(duration) && duration > 0;
  const progress = hasDuration
    ? Math.min(100, (currentTime / duration) * 100)
    : 0;
  const showsFallbackNotice = usingFallback && primarySrc !== FALLBACK_SRC;
  /** The transport control never claims to be playing while the badge reports a failure. */
  const showPlaying = isPlaying && !hasError;

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
    setDuration(
      Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : 0,
    );
    if (Number.isFinite(audio.currentTime) && audio.currentTime > 0) {
      setCurrentTime(audio.currentTime);
    }
    if (audio.error) setHasError(true);
    syncFallbackNotice(audio);
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
    node.playbackRate = SPEEDS[speedIndex];
    node.muted = isMuted;
  };

  /** Bound to both `loadedmetadata` and `canplay`, so a late `error` self-heals. */
  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;

    setHasError(false);
    syncFromElement(audio);
    audio.playbackRate = SPEEDS[speedIndex];
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
    setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    // Safety net: if the metadata events were missed entirely (see
    // `attachAudioElement`), the first `timeupdate` still repairs the duration.
    if (!hasDuration && Number.isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
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
    } catch (err: unknown) {
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
    setCurrentTime(next);
    if (audio && hasDuration)
      audio.currentTime = Math.min(Math.max(next, 0), duration);
  };

  /** Applies a speed preset and mirrors it onto the live media element. */
  const setSpeed = (index: number) => {
    const audio = audioRef.current;
    setSpeedIndex(index);
    if (audio) audio.playbackRate = SPEEDS[index];
  };

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
      if (!audio || !Number.isFinite(mediaDuration) || mediaDuration <= 0)
        return;

      event.preventDefault();
      const offset =
        event.key === "ArrowLeft" ? -SCRUB_STEP_SECONDS : SCRUB_STEP_SECONDS;
      const next = Math.min(
        Math.max(audio.currentTime + offset, 0),
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
            : `Reflection audio player. Space to ${showPlaying ? "pause" : "play"}, left and right arrows to scrub`
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

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-sm font-bold text-espresso">
                {title ?? "Reflection audio"}
              </p>
              <p className="shrink-0 text-xs font-medium tabular-nums text-muted">
                {formatTime(currentTime)} / {formatTime(duration || 0)}
              </p>
            </div>

            {/* Waveform visualizer — deterministic heights, springs settle when paused */}
            <div
              aria-hidden="true"
              className="mt-2.5 flex h-9 items-center justify-between gap-[3px]"
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
                aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration || 0)}`}
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
                {SPEEDS.map((speed, index) => {
                  const isActive = speedIndex === index;
                  return (
                    <button
                      key={speed}
                      type="button"
                      onClick={() => setSpeed(index)}
                      aria-pressed={isActive}
                      aria-label={`Playback speed ${speed}x${isActive ? " (active)" : ""}`}
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
                      <span className="relative">{speed}x</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {hasError ? (
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
