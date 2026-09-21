'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { BellIcon, CheckIcon, CloseIcon } from '@/app/components/icons';

/** The four canonical fixed-hour prayer watches of the daily liturgy. */
export type PrayerWatchId = 'lauds' | 'sext' | 'vespers' | 'compline';

/** Per-watch guest preference: an on/off switch plus the local reminder time (HH:mm). */
export interface PrayerWatchConfig {
  enabled: boolean;
  time: string;
}

/** Strict persisted shape stored under `jesus_united_prayer_watches_v1`. */
export interface PrayerWatchPreferences {
  version: 1;
  savedAt: string;
  watches: Record<PrayerWatchId, PrayerWatchConfig>;
}

interface PrayerWatchModalProps {
  open: boolean;
  onClose: () => void;
}

interface WatchDefinition {
  id: PrayerWatchId;
  numeral: string;
  name: string;
  liturgy: string;
  defaultTime: string;
}

const WATCH_DEFINITIONS: WatchDefinition[] = [
  {
    id: 'lauds',
    numeral: 'I',
    name: 'Lauds — Morning Altar',
    liturgy: 'Anchor Scripture & Daily Consecration',
    defaultTime: '07:00',
  },
  {
    id: 'sext',
    numeral: 'II',
    name: 'Sext — Midday Pause',
    liturgy: '60-Second Workplace Peace Pause',
    defaultTime: '12:30',
  },
  {
    id: 'vespers',
    numeral: 'III',
    name: 'Vespers — Evening Examen',
    liturgy: 'Gratitude Audit & Burdens Released',
    defaultTime: '18:30',
  },
  {
    id: 'compline',
    numeral: 'IV',
    name: 'Compline — Night Rest',
    liturgy: 'Sleep in Peace: He Neither Slumbers Nor Sleeps',
    defaultTime: '21:30',
  },
];

const STORAGE_KEY = 'jesus_united_prayer_watches_v1';
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Browser notification permission, normalised with an explicit unsupported state. */
type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

/** Deterministic default rhythm: all four watches on at their canonical hours. */
function defaultWatches(): Record<PrayerWatchId, PrayerWatchConfig> {
  const defaults = {} as Record<PrayerWatchId, PrayerWatchConfig>;
  for (const definition of WATCH_DEFINITIONS) {
    defaults[definition.id] = { enabled: true, time: definition.defaultTime };
  }
  return defaults;
}

/**
 * Reads stored watch preferences, sanitising every field against the strict
 * schema. Corrupt or privacy-blocked storage degrades gracefully to defaults.
 */
function readStoredWatches(): Record<PrayerWatchId, PrayerWatchConfig> {
  const fallback = defaultWatches();
  if (typeof window === 'undefined') return fallback;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;

    const stored = (parsed as { watches?: unknown }).watches;
    if (!stored || typeof stored !== 'object') return fallback;

    for (const definition of WATCH_DEFINITIONS) {
      const entry = (stored as Record<string, unknown>)[definition.id];
      if (!entry || typeof entry !== 'object') continue;

      const { enabled, time } = entry as Partial<PrayerWatchConfig>;
      if (typeof enabled === 'boolean') fallback[definition.id].enabled = enabled;
      if (typeof time === 'string' && TIME_PATTERN.test(time)) {
        fallback[definition.id].time = time;
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/** Persists the watch preferences; quota or privacy failures stay non-fatal. */
function writeStoredWatches(watches: Record<PrayerWatchId, PrayerWatchConfig>): void {
  if (typeof window === 'undefined') return;

  const preferences: PrayerWatchPreferences = {
    version: 1,
    savedAt: new Date().toISOString(),
    watches,
  };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Private-browsing quota errors are non-fatal; the rhythm stays in memory.
  }
}

/** Animated on/off switch with a sliding Framer Motion knob and a 44px hit area. */
function WatchSwitch({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full outline-none transition-colors duration-200 after:absolute after:-inset-2.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-gold/60"
    >
      <span
        className={`absolute inset-0 rounded-full transition-colors duration-200 ${
          checked ? 'bg-gold' : 'bg-sand'
        }`}
        aria-hidden="true"
      />
      <motion.span
        aria-hidden="true"
        animate={{ x: checked ? 20 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
        className="relative ml-0.5 block h-5 w-5 rounded-full bg-pill shadow-md"
      />
    </button>
  );
}

export default function PrayerWatchModal({ open, onClose }: PrayerWatchModalProps) {
  const [draft, setDraft] = useState<Record<PrayerWatchId, PrayerWatchConfig>>(defaultWatches);
  const [permission, setPermission] = useState<NotificationPermissionState>('default');
  const [chimeSent, setChimeSent] = useState(false);
  const chimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  /** Resolves the browser notification support/permission on mount (SSR-safe). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = typeof window !== 'undefined' && 'Notification' in window;
      const status: NotificationPermissionState = supported
        ? Notification.permission
        : 'unsupported';
      if (cancelled) return;
      setPermission(status);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Dialog behaviour: on open — focus the dialog, trap Tab cycling inside it,
   * close on Escape, lock page scroll, and restore focus to the trigger.
   */
  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  /** Re-reads stored preferences whenever the dialog opens so drafts stay fresh. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const stored = readStoredWatches();
      if (cancelled) return;
      setDraft(stored);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  /** Clears the pending test-chime feedback timer on unmount. */
  useEffect(() => {
    return () => {
      if (chimeTimer.current) clearTimeout(chimeTimer.current);
    };
  }, []);

  const toggleWatch = (id: PrayerWatchId) => {
    setDraft((current) => ({
      ...current,
      [id]: { ...current[id], enabled: !current[id].enabled },
    }));
  };

  const setWatchTime = (id: PrayerWatchId, time: string) => {
    setDraft((current) => ({ ...current, [id]: { ...current[id], time } }));
  };

  /** Requests browser notification permission; graceful on refusal or absence. */
  const requestPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
    } catch {
      // Some browsers throw when the prompt is dismissed; keep the badge honest.
      setPermission(Notification.permission);
    }
  };

  /** Fires a sample liturgical notification so the guest can preview the rhythm. */
  const sendTestChime = () => {
    if (permission !== 'granted') return;

    try {
      new Notification('Jesus United — Prayer Watch', {
        body: 'A gentle chime for the hours. When a watch arrives, a quiet reminder like this will call you to prayer.',
        tag: 'jesus-united-prayer-watch-test',
      });
      setChimeSent(true);
      if (chimeTimer.current) clearTimeout(chimeTimer.current);
      chimeTimer.current = setTimeout(() => setChimeSent(false), 2500);
    } catch {
      // Notification construction can fail on some platforms; stay silent.
    }
  };

  const saveRhythms = () => {
    writeStoredWatches(draft);
    onClose();
  };

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {open && (
          <motion.div key="prayer-watch-root" className="fixed inset-0 z-50">
            {/* Backdrop: click to dismiss */}
            <motion.button
              type="button"
              aria-label="Close Prayer Rhythms"
              onClick={onClose}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="absolute inset-0 cursor-default bg-canvas/30 backdrop-blur-sm"
            />

            {/* Frosted-glass slide-over panel */}
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="prayer-watch-title"
              tabIndex={-1}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 34 }}
              className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-sand/80 bg-canvas/95 shadow-2xl outline-none backdrop-blur-2xl"
            >
              {/* Pinned header */}
              <header className="flex shrink-0 items-start justify-between gap-3 border-b border-sand/80 px-6 py-5">
                <div>
                  <h2
                    id="prayer-watch-title"
                    className="flex items-center gap-2 font-serif text-xl font-bold tracking-tight text-espresso"
                  >
                    <BellIcon className="h-5 w-5 text-gold-deep" />
                    Prayer Rhythms
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    The four fixed-hour watches of the ancient liturgy, tuned to your day.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close Prayer Rhythms"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-sand bg-pill text-muted transition hover:border-gold hover:text-pill-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </header>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto px-6 py-6">
                {/* Permission status badge */}
                <div className="rounded-2xl border border-sand/80 bg-pill/80 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-bold text-espresso">Reminder chimes</p>
                    {permission === 'granted' && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-bold text-green-700">
                        <CheckIcon className="h-3.5 w-3.5" />
                        Notifications Enabled
                      </span>
                    )}
                    {permission === 'denied' && (
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                        Permission Blocked
                      </span>
                    )}
                    {permission === 'unsupported' && (
                      <span className="inline-flex items-center rounded-full bg-pill px-3 py-1 text-xs font-bold text-muted">
                        Notifications Not Supported
                      </span>
                    )}
                    {permission === 'default' && (
                      <motion.button
                        type="button"
                        onClick={() => void requestPermission()}
                        whileTap={{ scale: 0.96 }}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-gold px-4 text-xs font-bold text-canvas shadow-sm transition hover:bg-gold-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
                      >
                        <BellIcon className="h-3.5 w-3.5" />
                        Enable Reminders
                      </motion.button>
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted">
                    Reminders arrive as quiet browser notifications at each watch hour. Your
                    rhythm stays on this device — nothing is uploaded.
                  </p>
                  {permission === 'denied' && (
                    <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                      Your browser has blocked notifications for this site. Re-enable them in
                      the address-bar settings to receive watch-hour chimes.
                    </p>
                  )}
                  <motion.button
                    type="button"
                    onClick={sendTestChime}
                    disabled={permission !== 'granted'}
                    whileTap={{ scale: permission === 'granted' ? 0.96 : 1 }}
                    className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-sand bg-pill px-4 text-sm font-bold text-espresso transition hover:border-gold hover:text-pill-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {chimeSent ? (
                      <CheckIcon className="h-4 w-4" />
                    ) : (
                      <BellIcon className="h-4 w-4" />
                    )}
                    {chimeSent ? 'Chime Sent' : 'Send Test Chime'}
                  </motion.button>
                  <span role="status" aria-live="polite" className="sr-only">
                    {chimeSent ? 'A sample prayer watch notification was sent.' : ''}
                  </span>
                </div>

                {/* The four canonical watches */}
                <ul className="mt-5 space-y-3">
                  {WATCH_DEFINITIONS.map((definition) => {
                    const config = draft[definition.id];
                    const timeId = `watch-time-${definition.id}`;
                    return (
                      <li
                        key={definition.id}
                        className="rounded-2xl border border-sand bg-pill p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-espresso">
                              <span className="text-pill-ink">{definition.numeral}.</span>{' '}
                              {definition.name}
                            </p>
                            <p className="mt-0.5 text-xs leading-5 text-muted">
                              {definition.liturgy}
                            </p>
                          </div>
                          <WatchSwitch
                            checked={config.enabled}
                            onToggle={() => toggleWatch(definition.id)}
                            label={`${definition.numeral}. ${definition.name} reminder`}
                          />
                        </div>
                        <div className="mt-3 flex items-center gap-3">
                          <label
                            htmlFor={timeId}
                            className="text-xs font-bold uppercase tracking-[0.14em] text-muted"
                          >
                            Time
                          </label>
                          <input
                            id={timeId}
                            type="time"
                            value={config.time}
                            onChange={(event) => {
                              if (TIME_PATTERN.test(event.target.value)) {
                                setWatchTime(definition.id, event.target.value);
                              }
                            }}
                            disabled={!config.enabled}
                            className="min-h-[44px] rounded-xl border border-sand bg-canvas/70 px-3 py-2 text-sm font-semibold tabular-nums text-espresso outline-none transition focus:border-gold focus:ring-2 focus:ring-gold/25 disabled:cursor-not-allowed disabled:opacity-50"
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Pinned footer */}
              <footer className="shrink-0 border-t border-sand/80 bg-canvas/95 px-6 py-4 backdrop-blur-2xl">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs leading-5 text-muted">Saved on this device only.</p>
                  <motion.button
                    type="button"
                    onClick={saveRhythms}
                    whileTap={{ scale: 0.96 }}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-gold px-5 text-sm font-bold text-canvas shadow-sm transition hover:bg-gold-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
                  >
                    <CheckIcon className="h-4 w-4" />
                    Save Rhythms
                  </motion.button>
                </div>
              </footer>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}