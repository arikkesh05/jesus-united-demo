'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import type { Reflection } from '@/lib/types';
import AudioPlayer from '@/app/components/AudioPlayer';
import { CheckIcon, ChevronDownIcon, CopyIcon } from '@/app/components/icons';

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

const EXAMEN_STORAGE_KEY = 'jesusunited:daily-reflection-examen:v1';

/**
 * Builds the three contemplation prompts for the Examen section, anchored to
 * the day's scripture reference where one exists.
 */
function buildExamenPrompts(reference: string): ExamenPrompt[] {
  const anchor = reference.trim() || 'the passage';
  return [
    {
      id: 'anchor-word',
      label: 'Anchor Word',
      prompt: `What word or phrase from ${anchor} rose above the rest as you listened? Sit with it for a moment before moving on.`,
    },
    {
      id: 'grace-noticed',
      label: 'Grace Noticed',
      prompt:
        'Where did you sense God at work in the last 24 hours — a kindness, a provision, a quiet answer?',
    },
    {
      id: 'one-small-step',
      label: 'One Small Step',
      prompt:
        'What is one humble act of obedience you can carry into tomorrow because of this passage?',
    },
  ];
}

/**
 * Formats a `reflection_date` value into a human-readable date.
 * Date-only values (YYYY-MM-DD) are anchored to local midnight so the
 * displayed day does not shift backwards in negative UTC offsets.
 */
function formatReflectionDate(value: string): string {
  if (!value) return '';

  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(isDateOnly ? `${value}T00:00:00` : value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Reads the stored Examen entry for a date; corrupt or blocked storage degrades to empty. */
function readExamenStore(date: string): ExamenEntry {
  const empty: ExamenEntry = { completed: {}, notes: {} };
  if (!date || typeof window === 'undefined') return empty;

  try {
    const raw = window.localStorage.getItem(EXAMEN_STORAGE_KEY);
    if (!raw) return empty;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !(date in parsed)) return empty;

    const entry = (parsed as Record<string, unknown>)[date];
    if (!entry || typeof entry !== 'object') return empty;

    const { completed, notes } = entry as Partial<ExamenEntry>;
    const safeCompleted: Record<string, boolean> = {};
    if (completed && typeof completed === 'object') {
      for (const [key, value] of Object.entries(completed)) {
        if (typeof value === 'boolean') safeCompleted[key] = value;
      }
    }
    const safeNotes: Record<string, string> = {};
    if (notes && typeof notes === 'object') {
      for (const [key, value] of Object.entries(notes)) {
        if (typeof value === 'string') safeNotes[key] = value;
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
  if (!date || typeof window === 'undefined') return;

  try {
    let store: Record<string, unknown> = {};
    const raw = window.localStorage.getItem(EXAMEN_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
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
  const reflectionDate = reflection?.reflection_date ?? '';
  const prompts = useMemo(
    () => buildExamenPrompts(reflection?.scripture_reference ?? ''),
    [reflection?.scripture_reference],
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const toggleCompleted = (id: string) => {
    const nextCompleted = { ...completed, [id]: !completed[id] };
    setCompleted(nextCompleted);
    writeExamenEntry(reflectionDate, { completed: nextCompleted, notes });
  };

  const updateNote = (id: string, value: string) => {
    const nextNotes = { ...notes, [id]: value };
    setNotes(nextNotes);
    writeExamenEntry(reflectionDate, { completed, notes: nextNotes });
  };

  /** Copies the full reflection to the clipboard with legacy-fallback support. */
  const copyReflection = async () => {
    if (!reflection) return;

    const text = [
      reflection.title,
      reflection.scripture_reference,
      '',
      reflection.reflection_text,
    ].join('\n');

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
        const helper = document.createElement('textarea');
        helper.value = text;
        helper.setAttribute('readonly', '');
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        ok = document.execCommand('copy');
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
                'radial-gradient(ellipse at 50% 0%, rgba(194, 155, 56, 0.12), transparent 70%)',
            }}
          />
          <div className="relative rounded-[2.25rem] border border-white/80 bg-white/75 p-6 text-center shadow-[0_20px_60px_-15px_rgba(42,37,33,0.07)] backdrop-blur-2xl sm:p-8">
            <span className="inline-flex items-center rounded-full bg-pill px-3 py-1 text-xs font-bold uppercase tracking-wide text-pill-ink shadow-sm">
              Daily Bread
            </span>
            <h2 className="mt-4 font-serif text-2xl font-bold tracking-tight text-espresso">
              No reflection available today
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
              Today&apos;s reflection has not been published yet. Please check back soon and keep
              abiding in His word.
            </p>
          </div>
        </section>
      </MotionConfig>
    );
  }

  const completedCount = prompts.filter((prompt) => completed[prompt.id]).length;

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative w-full max-w-2xl">
        {/* Layers-style atmospheric backlight glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-6 -z-10 rounded-[3rem] blur-3xl"
          style={{
            background:
              'radial-gradient(ellipse at 50% 0%, rgba(194, 155, 56, 0.12), transparent 70%)',
          }}
        />

        {/* Floating glassmorphic container */}
        <article className="relative overflow-hidden rounded-[2.25rem] border border-white/80 bg-white/75 p-6 shadow-[0_20px_60px_-15px_rgba(42,37,33,0.07)] backdrop-blur-2xl transition-all duration-300 sm:p-8">
          {/* Subtle inner highlight border */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[2.25rem] ring-1 ring-inset ring-black/[0.04]"
          />

          <div className="relative">
            <div className="flex flex-wrap items-center gap-3">
              <motion.span
                whileHover={{ y: -2 }}
                transition={{ type: 'spring', stiffness: 400, damping: 22 }}
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
            </div>

            <h2 className="mt-5 font-serif text-2xl font-bold leading-tight tracking-tight text-espresso sm:text-3xl">
              {reflection.title}
            </h2>

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

            <p className="mt-5 whitespace-pre-line text-base leading-7 text-espresso/80">
              {reflection.reflection_text}
            </p>

            <div className="mt-6">
              <p className="mb-3 text-sm font-bold text-espresso">Listen to the reflection</p>
              {/*
                Always rendered: the data layer normalises `audio_url` to the bundled
                MP3, and an empty value would still resolve to it inside the player -
                so a missing URL can never remove the player itself.
              */}
              <AudioPlayer src={reflection.audio_url ?? ''} title={reflection.title} />
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
                Open a prompt, jot a thought, and mark it reflected — three small steps of
                examen.
              </p>
              <ul className="mt-4 space-y-3">
                {prompts.map((prompt, index) => (
                  <ExamenCard
                    key={prompt.id}
                    prompt={prompt}
                    index={index}
                    isExpanded={expandedId === prompt.id}
                    isCompleted={Boolean(completed[prompt.id])}
                    note={notes[prompt.id] ?? ''}
                    onToggleExpanded={() =>
                      setExpandedId((current) => (current === prompt.id ? null : prompt.id))
                    }
                    onToggleCompleted={() => toggleCompleted(prompt.id)}
                    onNoteChange={(value) => updateNote(prompt.id, value)}
                  />
                ))}
              </ul>
            </section>

            {/* Footer: progress + tactile copy action */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-sand/70 pt-5">
              <p aria-live="polite" className="text-xs font-semibold tabular-nums text-muted">
                {completedCount} of {prompts.length} prompts reflected
              </p>
              <div className="flex items-center gap-2">
                <motion.button
                  type="button"
                  onClick={() => void copyReflection()}
                  whileTap={{ scale: 0.96 }}
                  whileHover={{ y: -1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                  className={`inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-sm font-bold shadow-soft transition-colors duration-200 ${
                    copied
                      ? 'bg-gold text-espresso hover:bg-gold-deep'
                      : 'border border-sand bg-white text-espresso hover:border-gold hover:text-pill-ink'
                  }`}
                >
                  {copied ? (
                    <CheckIcon className="h-4 w-4" />
                  ) : (
                    <CopyIcon className="h-4 w-4 text-muted" />
                  )}
                  {copied ? 'Copied!' : 'Copy Reflection'}
                </motion.button>
                <span role="status" aria-live="polite" className="sr-only">
                  {copied ? 'Reflection copied to clipboard' : ''}
                </span>
              </div>
            </div>

          </div>
        </article>
      </div>
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
}: ExamenCardProps) {
  const bodyId = `examen-body-${prompt.id}`;
  const headerId = `examen-header-${prompt.id}`;
  const noteId = `examen-note-${prompt.id}`;

  return (
    <motion.li
      layout
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className="list-none"
    >
      <motion.div
        whileHover={{ y: -2 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className={`overflow-hidden rounded-2xl border transition-colors duration-200 ${
          isCompleted
            ? 'border-gold/50 bg-pill/60 shadow-sm'
            : 'border-sand bg-white/80 hover:border-gold/40 hover:shadow-sm'
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
              isCompleted ? 'bg-gold text-white' : 'bg-pill text-pill-ink'
            }`}
          >
            {isCompleted ? <CheckIcon className="h-4 w-4" /> : index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-espresso">{prompt.label}</span>
            <span className="block truncate text-xs text-muted">{prompt.prompt}</span>
          </span>
          {isCompleted && (
            <span className="hidden shrink-0 items-center rounded-full bg-pill px-2.5 py-1 text-[11px] font-bold text-pill-ink sm:inline-flex">
              Completed
            </span>
          )}
          <motion.span
            aria-hidden="true"
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
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
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 280, damping: 30 }}
              className="overflow-hidden"
            >
              <div className="border-t border-sand/70 px-4 pb-4 pt-3">
                <p className="text-sm leading-6 text-espresso/80">{prompt.prompt}</p>
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
                      ? 'bg-gold text-espresso shadow-sm hover:bg-gold-deep'
                      : 'border border-sand bg-white text-espresso hover:border-gold hover:text-pill-ink'
                  }`}
                >
                  <CheckIcon className="h-4 w-4" />
                  {isCompleted ? 'Completed' : 'Mark Reflected'}
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.li>
  );
}

