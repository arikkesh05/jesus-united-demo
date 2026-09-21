'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  EMPTY_ALTAR_DAY,
  HABIT_MAX,
  HABIT_STEP,
  clampHabitMinutes,
  loadAltarDay,
  persistAltarDay,
  todayLocalDate,
  type AltarDayState,
  type AltarPersistMode,
  type HabitMinutes,
} from '@/lib/altar';
import { BookIcon, CheckIcon, ClockIcon } from '@/app/components/icons';

export interface ScriptureFocus {
  title: string;
  reference: string;
  excerpt: string;
}

interface AltarOSProps {
  scriptureFocus?: ScriptureFocus | null;
}

type TabId = 'morning' | 'evening' | 'habits';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const TABS: { id: TabId; label: string }[] = [
  { id: 'morning', label: 'Morning Altar' },
  { id: 'evening', label: 'Evening Examen' },
  { id: 'habits', label: 'Habit Logger' },
];

const MORNING_PROMPTS: string[] = [
  'What are you carrying into today that you need to hand to God first?',
  'Which promise of Scripture do you most need to stand on before tonight?',
  'Who has God placed in your path today, and how will you serve them?',
];

const EVENING_PROMPTS: { label: string; prompt: string }[] = [
  {
    label: 'Gratitude',
    prompt: 'Name three gifts from today — however small — and thank God for each one.',
  },
  {
    label: 'Awareness',
    prompt: 'When were you most aware of His presence today, and when did you drift?',
  },
  {
    label: 'Grace',
    prompt: 'Where do you need His grace tonight? Name it, receive it, and release the day.',
  },
];

const FALLBACK_SCRIPTURE: ScriptureFocus = {
  title: 'Mercies New Every Morning',
  reference: 'Lamentations 3:22–23',
  excerpt:
    'The steadfast love of the LORD never ceases; his mercies never come to an end; they are new every morning; great is your faithfulness.',
};

const HABIT_COUNTERS: { key: keyof HabitMinutes; label: string }[] = [
  { key: 'prayer', label: 'Prayer' },
  { key: 'scripture', label: 'Scripture' },
  { key: 'worship', label: 'Worship' },
  { key: 'service', label: 'Service' },
];

const eyebrowClass = 'text-xs font-bold uppercase tracking-[0.18em] text-pill-ink';
const whiteCardClass = 'rounded-2xl border border-sand bg-pill shadow-soft';

function formatDisplayDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export default function AltarOS({ scriptureFocus }: AltarOSProps) {
  const focus = scriptureFocus ?? FALLBACK_SCRIPTURE;

  const [mounted, setMounted] = useState(false);
  const [today, setToday] = useState('');
  const [state, setState] = useState<AltarDayState>(EMPTY_ALTAR_DAY);
  const [mode, setMode] = useState<AltarPersistMode>('guest');
  const [activeTab, setActiveTab] = useState<TabId>('morning');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  const userIdRef = useRef<string | null>(null);
  const todayRef = useRef('');
  const stateRef = useRef<AltarDayState>(EMPTY_ALTAR_DAY);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Single mutation path: keeps the ref in sync synchronously so debounced
   * journal writes and rapid counter taps always persist the latest state.
   */
  const updateState = (next: AltarDayState) => {
    stateRef.current = next;
    setState(next);
  };

  /** Mount-gated load: the date is computed client-side only, so the server
   * HTML (skeleton) always matches the first client render — no hydration
   * mismatch from timezone differences. */
  useEffect(() => {
    let cancelled = false;
    const date = todayLocalDate();
    (async () => {
      const loaded = await loadAltarDay(date);
      if (cancelled) return;
      todayRef.current = date;
      userIdRef.current = loaded.userId;
      setToday(date);
      setMode(loaded.mode);
      stateRef.current = loaded.state;
      setState(loaded.state);
      setMounted(true);
    })();
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const persist = useCallback(async (next: AltarDayState) => {
    setSaveStatus('saving');
    const result = await persistAltarDay(todayRef.current, next, userIdRef.current);
    setSaveStatus(result.ok ? 'saved' : 'error');
    if (result.ok) setMode(result.mode);
  }, []);

  const toggleMorning = () => {
    const next = { ...stateRef.current, morningCompleted: !stateRef.current.morningCompleted };
    updateState(next);
    void persist(next);
  };

  const toggleEvening = () => {
    const next = { ...stateRef.current, eveningCompleted: !stateRef.current.eveningCompleted };
    updateState(next);
    void persist(next);
  };

  const adjustHabit = (key: keyof HabitMinutes, delta: number) => {
    const current = stateRef.current.habits[key];
    const next = {
      ...stateRef.current,
      habits: { ...stateRef.current.habits, [key]: clampHabitMinutes(current + delta) },
    };
    updateState(next);
    void persist(next);
  };

  /** Journal autosave: debounced so every keystroke does not hit Supabase. */
  const handleJournalChange = (value: string) => {
    const next = { ...stateRef.current, eveningJournal: value };
    updateState(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void persist(stateRef.current);
    }, 800);
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = TABS.findIndex((tab) => tab.id === activeTab);
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    setActiveTab(TABS[(index + offset + TABS.length) % TABS.length].id);
  };

  if (!mounted) {
    return (
      <div
        className="mx-auto w-full max-w-4xl rounded-3xl border border-sand bg-canvas p-8 text-center shadow-soft"
        role="status"
        aria-live="polite"
      >
        <p className="text-sm font-medium text-muted">Preparing your altar&hellip;</p>
      </div>
    );
  }

  const modeBadge =
    mode === 'cloud' ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-pill px-3 py-1 text-xs font-bold text-pill-ink">
        <CheckIcon className="h-3.5 w-3.5" />
        Signed in &mdash; syncing to your account
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gold px-3 py-1 text-xs font-bold text-canvas">
        Guest mode &mdash; saved on this device
      </span>
    );

  const saveNotice =
    saveStatus === 'saving'
      ? 'Saving\u2026'
      : saveStatus === 'saved'
        ? mode === 'cloud'
          ? 'Saved to your account'
          : 'Saved on this device'
        : saveStatus === 'error'
          ? 'Save failed \u2014 your entries are kept safely on this device'
          : '';

  return (
    <div className="mx-auto w-full max-w-4xl rounded-3xl border border-sand bg-canvas p-5 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-pill px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-pill-ink">
          Altar OS
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-pill px-3 py-1 text-xs font-semibold text-muted">
          <ClockIcon className="h-3.5 w-3.5" />
          {formatDisplayDate(today)}
        </span>
        {modeBadge}
      </div>

      <h3 className="mt-3 text-xl font-extrabold tracking-tight text-espresso sm:text-2xl">
        Your Daily Altar
      </h3>
      <p className="mt-1 text-sm leading-6 text-muted">
        Bookend the day with God &mdash; a morning consecration, an evening examen, and a running
        habit log in between.
      </p>

      <div
        role="tablist"
        aria-label="Altar OS sections"
        onKeyDown={handleTabKeyDown}
        className="mt-5 flex flex-wrap gap-1 rounded-full border border-sand bg-pill p-1"
      >
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              id={`altar-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`altar-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              className={
                isActive
                  ? 'flex-1 rounded-full bg-gold px-3 py-2 text-xs font-bold text-canvas shadow-sm transition-all duration-200 sm:text-sm'
                  : 'flex-1 rounded-full px-3 py-2 text-xs font-bold text-muted transition-all duration-200 hover:bg-pill/60 hover:text-espresso sm:text-sm'
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'morning' ? (
        <section
          id="altar-panel-morning"
          role="tabpanel"
          aria-labelledby="altar-tab-morning"
          className="mt-5"
        >
          <div className={`${whiteCardClass} p-5`}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-pill px-2.5 py-1 text-xs font-bold text-pill-ink">
              <BookIcon className="h-3.5 w-3.5" />
              {focus.reference}
            </span>
            <h4 className="mt-3 text-lg font-bold text-espresso">{focus.title}</h4>
            <p className="mt-1.5 text-sm italic leading-6 text-muted">
              &ldquo;{focus.excerpt}&rdquo;
            </p>
          </div>

          <h4 className={`mt-5 ${eyebrowClass}`}>Guided Reflection</h4>
          <ol className="mt-3 space-y-3">
            {MORNING_PROMPTS.map((prompt, index) => (
              <li key={prompt} className={`${whiteCardClass} flex items-start gap-3 p-4`}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold text-xs font-bold text-canvas">
                  {index + 1}
                </span>
                <p className="text-sm leading-6 text-espresso/80">{prompt}</p>
              </li>
            ))}
          </ol>

          <button
            type="button"
            onClick={toggleMorning}
            aria-pressed={state.morningCompleted}
            className={
              state.morningCompleted
                ? 'mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold px-4 py-3 text-sm font-bold text-canvas transition hover:bg-gold-deep hover:shadow-md'
                : 'mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full border border-sand bg-pill px-4 py-3 text-sm font-bold text-espresso transition hover:border-gold hover:bg-pill'
            }
          >
            {state.morningCompleted ? <CheckIcon className="h-4 w-4" /> : null}
            {state.morningCompleted ? 'Morning altar complete' : 'Mark morning complete'}
          </button>
        </section>
      ) : null}

      {activeTab === 'evening' ? (
        <section
          id="altar-panel-evening"
          role="tabpanel"
          aria-labelledby="altar-tab-evening"
          className="mt-5"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {EVENING_PROMPTS.map((item) => (
              <div key={item.label} className={`${whiteCardClass} p-4`}>
                <p className={eyebrowClass}>{item.label}</p>
                <p className="mt-2 text-sm leading-6 text-muted">{item.prompt}</p>
              </div>
            ))}
          </div>

          <label htmlFor="altar-evening-journal" className={`mt-5 block ${eyebrowClass}`}>
            Journal Reflection
          </label>
          <textarea
            id="altar-evening-journal"
            value={state.eveningJournal}
            onChange={(event) => handleJournalChange(event.target.value)}
            rows={5}
            placeholder="Pour out the day — what you saw, felt, and learned…"
            className="mt-2 w-full rounded-2xl border border-sand bg-pill px-4 py-3 text-sm leading-6 text-espresso outline-none transition placeholder:text-muted/80 focus:border-gold focus:ring-2 focus:ring-gold/25"
          />
          <p
            role="status"
            aria-live="polite"
            className={`mt-2 text-xs ${saveStatus === 'error' ? 'font-semibold text-pill-ink' : 'text-muted'}`}
          >
            {saveNotice || 'Your journal saves automatically as you write.'}
          </p>

          <button
            type="button"
            onClick={toggleEvening}
            aria-pressed={state.eveningCompleted}
            className={
              state.eveningCompleted
                ? 'mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold px-4 py-3 text-sm font-bold text-canvas transition hover:bg-gold-deep hover:shadow-md'
                : 'mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full border border-sand bg-pill px-4 py-3 text-sm font-bold text-espresso transition hover:border-gold hover:bg-pill'
            }
          >
            {state.eveningCompleted ? <CheckIcon className="h-4 w-4" /> : null}
            {state.eveningCompleted ? 'Evening examen complete' : 'Mark evening complete'}
          </button>
        </section>
      ) : null}

      {activeTab === 'habits' ? (
        <section
          id="altar-panel-habits"
          role="tabpanel"
          aria-labelledby="altar-tab-habits"
          className="mt-5"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HABIT_COUNTERS.map((habit) => {
              const minutes = state.habits[habit.key];
              return (
                <div key={habit.key} className={`${whiteCardClass} p-4`}>
                  <p className={eyebrowClass}>{habit.label}</p>
                  <p className="mt-2 text-3xl font-extrabold tabular-nums text-espresso">
                    {minutes}
                    <span className="ml-1 text-sm font-bold text-muted">min</span>
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => adjustHabit(habit.key, -HABIT_STEP)}
                      disabled={minutes === 0}
                      aria-label={`Remove ${HABIT_STEP} minutes from ${habit.label.toLowerCase()}`}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-sand bg-pill text-lg font-bold text-espresso transition hover:border-gold hover:bg-pill disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      &minus;
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustHabit(habit.key, HABIT_STEP)}
                      disabled={minutes >= HABIT_MAX}
                      aria-label={`Add ${HABIT_STEP} minutes to ${habit.label.toLowerCase()}`}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-sand bg-pill text-lg font-bold text-espresso transition hover:border-gold hover:bg-pill disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      +
                    </button>
                    <span className="ml-auto text-xs text-muted">+{HABIT_STEP} min</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs leading-5 text-muted">
            Signed-in believers sync daily totals to their account; guests keep everything safely on
            this device.
          </p>
        </section>
      ) : null}
    </div>
  );
}
