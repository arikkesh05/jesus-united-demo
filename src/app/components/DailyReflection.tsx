"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import type { Reflection } from "@/lib/types";
import AudioPlayer from "@/app/components/AudioPlayer";
import PrayerWatchModal from "@/app/components/PrayerWatchModal";
import PrayerSubmissionModal, {
  type PrayerSubmissionSeed,
} from "@/app/components/PrayerSubmissionModal";
import AvatarCanvas from "@/app/components/3d/AvatarCanvas";
import {
  BellIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  HandHeartIcon,
  HeartIcon,
  ShareIcon,
} from "@/app/components/icons";

interface DailyReflectionProps {
  reflection: Reflection | null;
}

/** One contemplation prompt in the reflective Examen section. */
interface ExamenPrompt {
  id: string;
  label: string;
  prompt: string;
}

/** Guest-first, on-device Examen state persisted per reflection date. */
interface ExamenEntry {
  completed: Record<string, boolean>;
  notes: Record<string, string>;
}

const EXAMEN_STORAGE_KEY = "jesusunited:daily-reflection-examen:v1";

/** Guest-first, per-day Amen lock so one heart offers one amen per day. */
interface AmenPulseEntry {
  date: string;
  hasAmen: boolean;
}

const AMEN_STORAGE_KEY = "jesusunited:amen-pulse:v1";

/** Examen prompt that carries a shareable conviction (Prompt 3: One Small Step). */
const STEP_PROMPT_ID = "one-small-step";

/** Wall category the bridge files a Morning Reflection under. */
const BRIDGE_TOPIC = "Guidance";

/** Minimum reflection length before an intercession share is offered. */
const BRIDGE_MIN_LENGTH = 10;

/** Local calendar date (YYYY-MM-DD) so the Amen lock rolls over at local midnight. */
function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Deterministic communal presence baseline derived from the local date, so the
 * server-rendered HTML and the first client render agree (no hydration shift).
 */
function regionBaselineFor(dateKey: string): number {
  let hash = 0;
  for (const character of dateKey) {
    hash = (hash * 31 + character.charCodeAt(0)) % 997;
  }
  return 12 + (hash % 9);
}

/** Reads today's Amen lock; corrupt or blocked storage degrades to not-offered. */
function readAmenPulse(dateKey: string): boolean {
  if (!dateKey || typeof window === "undefined") return false;

  try {
    const raw = window.localStorage.getItem(AMEN_STORAGE_KEY);
    if (!raw) return false;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return false;

    const entry = parsed as Partial<AmenPulseEntry>;
    return entry.date === dateKey && entry.hasAmen === true;
  } catch {
    return false;
  }
}

/** Persists the Amen lock; quota or privacy failures stay non-fatal. */
function writeAmenPulse(dateKey: string): void {
  if (!dateKey || typeof window === "undefined") return;

  const entry: AmenPulseEntry = { date: dateKey, hasAmen: true };
  try {
    window.localStorage.setItem(AMEN_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Private-browsing quota errors are non-fatal; state stays in memory.
  }
}

/**
 * Condenses a scripture reference to its passage anchor for communal copy:
 * "Ephesians 2:8-10" reads as "Ephesians 2"; "Psalm 46:10" as "Psalm 46".
 */
function scriptureAnchor(reference: string): string {
  const trimmed = reference.trim();
  if (!trimmed) return "the Word";
  const passage = trimmed.split(":")[0]?.trim() ?? "";
  return passage || trimmed;
}

/**
 * Builds the three contemplation prompts for the Examen section, anchored to
 * the day's scripture reference where one exists.
 */
function buildExamenPrompts(reference: string): ExamenPrompt[] {
  const anchor = reference.trim() || "the passage";
  return [
    {
      id: "anchor-word",
      label: "Anchor Word",
      prompt: `What word or phrase from ${anchor} rose above the rest as you listened? Sit with it for a moment before moving on.`,
    },
    {
      id: "grace-noticed",
      label: "Grace Noticed",
      prompt:
        "Where did you sense God at work in the last 24 hours — a kindness, a provision, a quiet answer?",
    },
    {
      id: "one-small-step",
      label: "One Small Step",
      prompt:
        "What is one humble act of obedience you can carry into tomorrow because of this passage?",
    },
  ];
}

/**
 * Formats a `reflection_date` value into a human-readable date.
 * Date-only values (YYYY-MM-DD) are anchored to local midnight so the
 * displayed day does not shift backwards in negative UTC offsets.
 */
function formatReflectionDate(value: string): string {
  if (!value) return "";

  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(isDateOnly ? `${value}T00:00:00` : value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Reads the stored Examen entry for a date; corrupt or blocked storage degrades to empty. */
function readExamenStore(date: string): ExamenEntry {
  const empty: ExamenEntry = { completed: {}, notes: {} };
  if (!date || typeof window === "undefined") return empty;

  try {
    const raw = window.localStorage.getItem(EXAMEN_STORAGE_KEY);
    if (!raw) return empty;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !(date in parsed))
      return empty;

    const entry = (parsed as Record<string, unknown>)[date];
    if (!entry || typeof entry !== "object") return empty;

    const { completed, notes } = entry as Partial<ExamenEntry>;
    const safeCompleted: Record<string, boolean> = {};
    if (completed && typeof completed === "object") {
      for (const [key, value] of Object.entries(completed)) {
        if (typeof value === "boolean") safeCompleted[key] = value;
      }
    }
    const safeNotes: Record<string, string> = {};
    if (notes && typeof notes === "object") {
      for (const [key, value] of Object.entries(notes)) {
        if (typeof value === "string") safeNotes[key] = value;
      }
    }
    return { completed: safeCompleted, notes: safeNotes };
  } catch {
    // Corrupt or privacy-mode storage: behave like a first-time guest.
    return empty;
  }
}

/** Persists one date's Examen entry; quota or privacy failures stay non-fatal. */
function writeExamenEntry(date: string, entry: ExamenEntry): void {
  if (!date || typeof window === "undefined") return;

  try {
    let store: Record<string, unknown> = {};
    const raw = window.localStorage.getItem(EXAMEN_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        store = parsed as Record<string, unknown>;
      }
    }
    store[date] = entry;
    window.localStorage.setItem(EXAMEN_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Private-browsing quota errors are non-fatal; state stays in memory.
  }
}

export default function DailyReflection({ reflection }: DailyReflectionProps) {
  const reflectionDate = reflection?.reflection_date ?? "";
  const prompts = useMemo(
    () => buildExamenPrompts(reflection?.scripture_reference ?? ""),
    [reflection?.scripture_reference],
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Examen-to-intercession bridge state (Prompt 3 → Prayer Wall).
  const [bridgeOpen, setBridgeOpen] = useState(false);
  const [shareHintVisible, setShareHintVisible] = useState(false);
  const [sharedToWall, setSharedToWall] = useState(false);
  const [bridgeRings, setBridgeRings] = useState<number[]>([]);

  // Synchronous Amen Resonance + Prayer Rhythms state.
  const [isWatchModalOpen, setIsWatchModalOpen] = useState(false);
  const [hasAmenToday, setHasAmenToday] = useState(false);
  const [amenDrift, setAmenDrift] = useState(0);
  const [amenRings, setAmenRings] = useState<number[]>([]);
  /** Monotonic Amen counter — each increment lights the Watchman's ember core. */
  const [amenPulseCount, setAmenPulseCount] = useState(0);
  const amenBase = useMemo(
    () => regionBaselineFor(reflectionDate || "daily"),
    [reflectionDate],
  );

  /**
   * Mount-gated load: the server HTML renders the same empty maps as the first
   * client render (no hydration mismatch), then stored Examen state fills in.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = readExamenStore(reflectionDate);
      if (cancelled) return;
      setCompleted(loaded.completed);
      setNotes(loaded.notes);
    })();
    return () => {
      cancelled = true;
    };
  }, [reflectionDate]);

  /** Clears the pending copy-feedback timer on unmount. */
  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  /**
   * Mount-gated Amen lock read: the server HTML renders the same not-offered
   * state as the first client render (no hydration mismatch), then the stored
   * per-day lock fills in.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = readAmenPulse(todayKey());
      if (cancelled) return;
      setHasAmenToday(stored);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Gentle ambient drift on the communal count so the bar breathes while open. */
  useEffect(() => {
    const interval = setInterval(() => {
      setAmenDrift((current) => {
        const step = Math.floor(Math.random() * 3) - 1; // -1 | 0 | 1
        return Math.min(4, Math.max(0, current + step));
      });
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  /** Offers the Amen: optimistic count bump, per-day localStorage lock, pulse ring. */
  const sayAmen = () => {
    if (hasAmenToday) return;
    setHasAmenToday(true);
    writeAmenPulse(todayKey());
    setAmenRings((current) => [...current, Date.now()]);
    // Light the Watchman's interior ember core (800ms pulse).
    setAmenPulseCount((current) => current + 1);
  };

  /** Removes a finished radial gold pulse ring from the Animate-free ring stack. */
  const dismissAmenRing = (id: number) => {
    setAmenRings((current) => current.filter((ring) => ring !== id));
  };

  const toggleCompleted = (id: string) => {
    const nextCompleted = { ...completed, [id]: !completed[id] };
    setCompleted(nextCompleted);
    writeExamenEntry(reflectionDate, { completed: nextCompleted, notes });
  };

  const updateNote = (id: string, value: string) => {
    const nextNotes = { ...notes, [id]: value };
    setNotes(nextNotes);
    writeExamenEntry(reflectionDate, { completed, notes: nextNotes });

    // The bridge's "write something first" hint clears itself once satisfied.
    if (id === STEP_PROMPT_ID && value.trim().length >= BRIDGE_MIN_LENGTH) {
      setShareHintVisible(false);
    }
  };

  // ---------------------------------------------------------------------
  // Examen-to-intercession bridge (Prompt 3 → Community Prayer Wall)
  // ---------------------------------------------------------------------

  /** True when Prompt 3 carries something worth sharing. */
  const stepNote = notes[STEP_PROMPT_ID] ?? "";
  const canShareStep = stepNote.trim().length >= BRIDGE_MIN_LENGTH;

  /** Opens the pre-filled intercession dialog (anonymous by default). */
  const openIntercessionBridge = () => {
    if (!canShareStep) {
      setShareHintVisible(true);
      return;
    }
    setShareHintVisible(false);
    setBridgeOpen(true);
  };

  /** Modal seed: title from the day's theme, body from the typed reflection. */
  const bridgeSeed = useMemo<PrayerSubmissionSeed>(
    () => ({
      title: reflection
        ? `Morning Reflection: ${reflection.title}`
        : "Morning Reflection",
      body: stepNote.trim(),
      topics: [BRIDGE_TOPIC],
      anonymous: true,
    }),
    [reflection, stepNote],
  );

  /** Optimistic confirmation: the wall reflects the share on its own. */
  const handleBridgeSubmitted = () => {
    setSharedToWall(true);
    setBridgeRings((current) => [...current, Date.now()]);
  };

  /** Smooth handoff: carry the believer from the Examen card to the live wall. */
  const scrollToWall = () => {
    const wall = document.getElementById("prayer-wall-section");
    if (!wall) return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    wall.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  };

  /** Removes a finished radial gold pulse ring from the Animate-free ring stack. */
  const dismissBridgeRing = (id: number) => {
    setBridgeRings((current) => current.filter((ring) => ring !== id));
  };

  /** Copies the full reflection to the clipboard with legacy-fallback support. */
  const copyReflection = async () => {
    if (!reflection) return;

    const text = [
      reflection.title,
      reflection.scripture_reference,
      "",
      reflection.reflection_text,
    ].join("\n");

    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }

    if (!ok) {
      // Legacy path for non-secure contexts where the async clipboard is absent.
      try {
        const helper = document.createElement("textarea");
        helper.value = text;
        helper.setAttribute("readonly", "");
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.appendChild(helper);
        helper.select();
        ok = document.execCommand("copy");
        document.body.removeChild(helper);
      } catch {
        ok = false;
      }
    }

    if (ok) {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!reflection) {
    return (
      <MotionConfig reducedMotion="user">
        <section className="relative w-full max-w-2xl">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-6 -z-10 rounded-[3rem] blur-3xl"
            style={{
              background:
                "radial-gradient(ellipse at 50% 0%, rgba(245, 158, 11, 0.14), transparent 70%)",
            }}
          />
          <div className="relative rounded-[2.25rem] border border-white/10 bg-pill/75 p-6 text-center shadow-[0_20px_60px_-15px_rgba(2,8,18,0.55)] backdrop-blur-2xl sm:p-8">
            <span className="inline-flex items-center rounded-full bg-pill px-3 py-1 text-xs font-bold uppercase tracking-wide text-pill-ink shadow-sm">
              Daily Bread
            </span>
            <h2 className="mt-4 font-serif text-2xl font-bold tracking-tight text-espresso">
              No reflection available today
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
              Today&apos;s reflection has not been published yet. Please check
              back soon and keep abiding in His word.
            </p>
          </div>
        </section>
      </MotionConfig>
    );
  }

  const completedCount = prompts.filter(
    (prompt) => completed[prompt.id],
  ).length;
  const amenCount = amenBase + amenDrift + (hasAmenToday ? 1 : 0);

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative w-full max-w-2xl">
        {/* Layers-style atmospheric backlight glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-6 -z-10 rounded-[3rem] blur-3xl"
          style={{
            background:
              "radial-gradient(ellipse at 50% 0%, rgba(245, 158, 11, 0.14), transparent 70%)",
          }}
        />

        {/* Floating glassmorphic container */}
        <article className="relative overflow-hidden rounded-[2.25rem] border border-white/10 bg-pill/75 p-6 shadow-[0_20px_60px_-15px_rgba(2,8,18,0.55)] backdrop-blur-2xl transition-all duration-300 sm:p-8">
          {/* Subtle inner highlight border */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[2.25rem] ring-1 ring-inset ring-white/10"
          />

          <div className="relative">
            <div className="flex flex-wrap items-center gap-3">
              <motion.span
                whileHover={{ y: -2 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
                className="inline-flex items-center rounded-full bg-pill px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-pill-ink shadow-sm"
              >
                Daily Bread
              </motion.span>
              <time
                dateTime={reflection.reflection_date}
                className="text-sm font-medium text-muted"
              >
                {formatReflectionDate(reflection.reflection_date)}
              </time>
              <motion.button
                type="button"
                onClick={() => setIsWatchModalOpen(true)}
                whileTap={{ scale: 0.96 }}
                whileHover={{ y: -1 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
                aria-haspopup="dialog"
                aria-expanded={isWatchModalOpen}
                className="ml-auto inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-sand bg-pill px-3 text-xs font-bold text-espresso shadow-soft transition-colors duration-200 hover:border-gold hover:text-pill-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 sm:px-4"
              >
                <BellIcon className="h-4 w-4 text-gold-deep" />
                Prayer Rhythms
              </motion.button>
            </div>

            <h2 className="mt-5 font-serif text-2xl font-bold leading-tight tracking-tight text-espresso sm:text-3xl">
              {reflection.title}
            </h2>

            {/* Watchman viewport — the real GLB figurine rendered in WebGL. Client-only:
                the canvas mounts after hydration and fills this transparent stage, so
                there is no card, border or backdrop behind it. */}
            <div
              className="relative mx-auto mt-6 flex h-[380px] w-full max-w-[340px] items-center justify-center"
              role="img"
              aria-label="An interactive 3D watchman figure standing on a lit amber pedestal as it keeps vigil over today's scripture — tap the figure to make it wave"
            >
              <AvatarCanvas amenPulseCount={amenPulseCount} />
            </div>

            {/* Scripture anchor */}
            <figure className="mt-5 flex items-start gap-3 rounded-2xl border border-sand/70 bg-pill/50 p-4 sm:p-5">
              <span
                aria-hidden="true"
                className="font-serif text-4xl leading-none text-gold"
              >
                &ldquo;
              </span>
              <div className="min-w-0">
                <blockquote className="font-serif text-base italic leading-7 text-espresso/90 sm:text-lg">
                  {reflection.scripture_reference}
                </blockquote>
                <figcaption className="mt-1.5 text-xs font-bold uppercase tracking-[0.18em] text-pill-ink">
                  Scripture Anchor
                </figcaption>
              </div>
            </figure>

            {/* Synchronous Amen Resonance — communal presence + tactile Amen */}
            <div className="mt-3 rounded-2xl border border-sand/80 bg-pill/85 p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span
                  className="relative flex h-2.5 w-2.5 shrink-0"
                  aria-hidden="true"
                >
                  <span className="amen-breath absolute inline-flex h-full w-full rounded-full bg-gold opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-gold" />
                </span>
                <p
                  aria-live="polite"
                  className="min-w-0 flex-1 text-sm leading-6 text-espresso/85"
                >
                  <span className="font-bold tabular-nums">{amenCount}</span>{" "}
                  {
                    "believers in your region are consecrating their morning with"
                  }{" "}
                  <span className="font-bold">
                    {scriptureAnchor(reflection.scripture_reference)}
                  </span>{" "}
                  right now.
                </p>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <motion.button
                  type="button"
                  onClick={sayAmen}
                  disabled={hasAmenToday}
                  whileTap={{ scale: 0.95 }}
                  whileHover={{ y: -1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 22 }}
                  aria-label={
                    hasAmenToday
                      ? "Amen offered today"
                      : "Say Amen to this scripture anchor"
                  }
                  className={`relative inline-flex min-h-[44px] items-center gap-2 overflow-visible rounded-full px-5 text-sm font-bold shadow-soft transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${
                    hasAmenToday
                      ? "bg-pill text-pill-ink"
                      : "bg-gold text-canvas hover:bg-gold-deep"
                  }`}
                >
                  <HeartIcon
                    className={`h-4 w-4 ${hasAmenToday ? "fill-current" : ""}`}
                  />
                  {hasAmenToday ? "Amen Offered" : "Say Amen"}
                </motion.button>
                <span role="status" aria-live="polite" className="sr-only">
                  {hasAmenToday ? "Your amen has been offered today." : ""}
                </span>
                {/* Expanding radial gold pulse rings */}
                <div className="relative" aria-hidden="true">
                  {amenRings.map((id) => (
                    <motion.span
                      key={id}
                      initial={{ opacity: 0.55, scale: 0.35 }}
                      animate={{ opacity: 0, scale: 2.4 }}
                      transition={{ duration: 1.1, ease: "easeOut" }}
                      onAnimationComplete={() => dismissAmenRing(id)}
                      className="pointer-events-none absolute -top-11 right-0 block h-24 w-24 rounded-full border-2 border-gold"
                    />
                  ))}
                </div>
              </div>
            </div>

            <p className="mt-5 whitespace-pre-line text-base leading-7 text-espresso/80">
              {reflection.reflection_text}
            </p>

            <div className="mt-6">
              <p className="mb-3 text-sm font-bold text-espresso">
                Listen to the reflection
              </p>
              {/*
                Always rendered: the data layer normalises `audio_url` to the bundled
                MP3, and an empty value would still resolve to it inside the player -
                so a missing URL can never remove the player itself.
              */}
              <AudioPlayer
                src={reflection.audio_url ?? ""}
                title={reflection.title}
              />
            </div>

            {/* Reflective Examen */}
            <section aria-labelledby="examen-heading" className="mt-8">
              <h3
                id="examen-heading"
                className="text-xs font-bold uppercase tracking-[0.2em] text-pill-ink"
              >
                Reflective Examen
              </h3>
              <p className="mt-1 text-sm leading-6 text-muted">
                Open a prompt, jot a thought, and mark it reflected — three
                small steps of examen.
              </p>
              <ul className="mt-4 space-y-3">
                {prompts.map((prompt, index) => (
                  <ExamenCard
                    key={prompt.id}
                    prompt={prompt}
                    index={index}
                    isExpanded={expandedId === prompt.id}
                    isCompleted={Boolean(completed[prompt.id])}
                    note={notes[prompt.id] ?? ""}
                    onToggleExpanded={() =>
                      setExpandedId((current) =>
                        current === prompt.id ? null : prompt.id,
                      )
                    }
                    onToggleCompleted={() => toggleCompleted(prompt.id)}
                    onNoteChange={(value) => updateNote(prompt.id, value)}
                    canBridge={prompt.id === STEP_PROMPT_ID}
                    shared={prompt.id === STEP_PROMPT_ID && sharedToWall}
                    hintVisible={
                      prompt.id === STEP_PROMPT_ID && shareHintVisible
                    }
                    shareHintId="examen-share-hint"
                    bridgeRings={bridgeRings}
                    onShareToWall={openIntercessionBridge}
                    onDismissRing={dismissBridgeRing}
                  />
                ))}
              </ul>
            </section>

            {/* Footer: progress + tactile copy action */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-sand/70 pt-5">
              <p
                aria-live="polite"
                className="text-xs font-semibold tabular-nums text-muted"
              >
                {completedCount} of {prompts.length} prompts reflected
              </p>
              <div className="flex items-center gap-2">
                <motion.button
                  type="button"
                  onClick={() => void copyReflection()}
                  whileTap={{ scale: 0.96 }}
                  whileHover={{ y: -1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 22 }}
                  className={`inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-sm font-bold shadow-soft transition-colors duration-200 ${
                    copied
                      ? "bg-gold text-canvas hover:bg-gold-deep"
                      : "border border-sand bg-pill text-espresso hover:border-gold hover:text-pill-ink"
                  }`}
                >
                  {copied ? (
                    <CheckIcon className="h-4 w-4" />
                  ) : (
                    <CopyIcon className="h-4 w-4 text-muted" />
                  )}
                  {copied ? "Copied!" : "Copy Reflection"}
                </motion.button>
                <span role="status" aria-live="polite" className="sr-only">
                  {copied ? "Reflection copied to clipboard" : ""}
                </span>
              </div>
            </div>
          </div>
        </article>
      </div>
      <PrayerWatchModal
        open={isWatchModalOpen}
        onClose={() => setIsWatchModalOpen(false)}
      />
      <PrayerSubmissionModal
        open={bridgeOpen}
        onClose={() => setBridgeOpen(false)}
        onSubmitted={handleBridgeSubmitted}
        seed={bridgeSeed}
        onViewWall={scrollToWall}
      />
    </MotionConfig>
  );
}

interface ExamenCardProps {
  prompt: ExamenPrompt;
  index: number;
  isExpanded: boolean;
  isCompleted: boolean;
  note: string;
  onToggleExpanded: () => void;
  onToggleCompleted: () => void;
  onNoteChange: (value: string) => void;
  /** True only for the prompt that carries the intercession bridge. */
  canBridge: boolean;
  /** True once this prompt's reflection has reached the community altar. */
  shared: boolean;
  /** True while the "write something first" hint is showing. */
  hintVisible: boolean;
  shareHintId: string;
  /** Active radial gold pulse rings for the share confirmation. */
  bridgeRings: number[];
  onShareToWall: () => void;
  onDismissRing: (id: number) => void;
}

/** One interactive, spring-damped Examen prompt card with a checkable state. */
function ExamenCard({
  prompt,
  index,
  isExpanded,
  isCompleted,
  note,
  onToggleExpanded,
  onToggleCompleted,
  onNoteChange,
  canBridge,
  shared,
  hintVisible,
  shareHintId,
  bridgeRings,
  onShareToWall,
  onDismissRing,
}: ExamenCardProps) {
  const bodyId = `examen-body-${prompt.id}`;
  const headerId = `examen-header-${prompt.id}`;
  const noteId = `examen-note-${prompt.id}`;

  return (
    <motion.li
      layout
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className="list-none"
    >
      <motion.div
        whileHover={{ y: -2 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        className={`overflow-hidden rounded-2xl border transition-colors duration-200 ${
          isCompleted
            ? "border-gold/50 bg-pill/60 shadow-sm"
            : "border-sand bg-pill/80 hover:border-gold/40 hover:shadow-sm"
        }`}
      >
        <button
          id={headerId}
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={isExpanded}
          aria-controls={bodyId}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
        >
          <span
            aria-hidden="true"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              isCompleted ? "bg-gold text-canvas" : "bg-pill text-pill-ink"
            }`}
          >
            {isCompleted ? <CheckIcon className="h-4 w-4" /> : index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-espresso">
              {prompt.label}
            </span>
            <span className="block truncate text-xs text-muted">
              {prompt.prompt}
            </span>
          </span>
          {isCompleted && (
            <span className="hidden shrink-0 items-center rounded-full bg-pill px-2.5 py-1 text-[11px] font-bold text-pill-ink sm:inline-flex">
              Completed
            </span>
          )}
          <motion.span
            aria-hidden="true"
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="shrink-0 text-muted"
          >
            <ChevronDownIcon className="h-4 w-4" />
          </motion.span>
        </button>

        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="examen-body"
              id={bodyId}
              role="region"
              aria-labelledby={headerId}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 280, damping: 30 }}
              className="overflow-hidden"
            >
              <div className="border-t border-sand/70 px-4 pb-4 pt-3">
                <p className="text-sm leading-6 text-espresso/80">
                  {prompt.prompt}
                </p>
                <label
                  htmlFor={noteId}
                  className="mt-3 block text-xs font-bold uppercase tracking-wide text-muted"
                >
                  Your reflection
                </label>
                <textarea
                  id={noteId}
                  value={note}
                  onChange={(event) => onNoteChange(event.target.value)}
                  rows={3}
                  placeholder="Write as little or as much as you like..."
                  className="mt-1.5 min-h-[88px] w-full resize-y rounded-xl border border-sand bg-canvas/70 px-3 py-2 text-sm leading-6 text-espresso shadow-inner outline-none transition placeholder:text-muted/60 focus:border-gold focus:ring-2 focus:ring-gold/25"
                />
                <motion.button
                  type="button"
                  onClick={onToggleCompleted}
                  whileTap={{ scale: 0.96 }}
                  aria-pressed={isCompleted}
                  className={`mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-sm font-bold transition-colors duration-200 ${
                    isCompleted
                      ? "bg-gold text-canvas shadow-sm hover:bg-gold-deep"
                      : "border border-sand bg-pill text-espresso hover:border-gold hover:text-pill-ink"
                  }`}
                >
                  <CheckIcon className="h-4 w-4" />
                  {isCompleted ? "Completed" : "Mark Reflected"}
                </motion.button>

                {/* Examen-to-intercession bridge (Prompt 3 only). */}
                {canBridge ? (
                  <div className="mt-3 border-t border-sand/70 pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <motion.button
                        type="button"
                        onClick={onShareToWall}
                        whileTap={{ scale: 0.95 }}
                        whileHover={{ y: -1 }}
                        transition={{
                          type: "spring",
                          stiffness: 400,
                          damping: 30,
                        }}
                        aria-describedby={hintVisible ? shareHintId : undefined}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-white/10 bg-pill/60 px-3.5 py-2 text-xs font-medium text-slate-300 transition hover:bg-gold/15 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                      >
                        <ShareIcon className="h-3.5 w-3.5" />
                        Share Anonymously to Intercession Pulse
                      </motion.button>

                      <AnimatePresence initial={false}>
                        {shared ? (
                          <motion.span
                            key="shared-badge"
                            role="status"
                            aria-live="polite"
                            initial={{ opacity: 0, scale: 0.9, y: 4 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{
                              type: "spring",
                              stiffness: 420,
                              damping: 30,
                            }}
                            className="relative inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/15 px-3 py-1.5 text-[11px] font-semibold text-gold shadow-[0_0_16px_rgba(245,158,11,0.28)]"
                          >
                            <span
                              aria-hidden="true"
                              className="h-1.5 w-1.5 rounded-full bg-gold amen-breath"
                            />
                            <HandHeartIcon className="h-3.5 w-3.5" />
                            Shared with the community prayer altar
                            {bridgeRings.map((ringId) => (
                              <motion.span
                                key={ringId}
                                initial={{ opacity: 0.5, scale: 0.4 }}
                                animate={{ opacity: 0, scale: 2.2 }}
                                transition={{ duration: 1, ease: "easeOut" }}
                                onAnimationComplete={() =>
                                  onDismissRing(ringId)
                                }
                                className="pointer-events-none absolute inset-0 block rounded-full border-2 border-gold"
                              />
                            ))}
                          </motion.span>
                        ) : null}
                      </AnimatePresence>
                    </div>

                    <AnimatePresence initial={false}>
                      {hintVisible ? (
                        <motion.p
                          key="share-hint"
                          id={shareHintId}
                          role="status"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{
                            type: "spring",
                            stiffness: 320,
                            damping: 30,
                          }}
                          className="overflow-hidden text-xs font-medium text-gold/90"
                        >
                          <span className="mt-2 block">
                            Write a short reflection first to share.
                          </span>
                        </motion.p>
                      ) : null}
                    </AnimatePresence>
                  </div>
                ) : null}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.li>
  );
}
