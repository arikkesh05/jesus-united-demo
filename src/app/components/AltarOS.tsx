'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import {
  EMPTY_ALTAR_DAY,
  HABIT_MAX,
  clampHabitMinutes,
  loadAltarDay,
  persistAltarDay,
  todayLocalDate,
  type AltarDayState,
  type AltarPersistMode,
} from '@/lib/altar';
import {
  RHYTHMS,
  RHYTHM_MINUTE_STEP,
  RHYTHM_PRACTICE_MINUTES,
  RHYTHM_WEEK_TARGET,
  dayFullness,
  dayMinutes,
  emptyRhythmDay,
  formationLabel,
  hasPractised,
  isRestingDay,
  readEngineDay,
  readHabitEngine,
  rhythmProgress,
  saveEngineDay,
  setGraceMode,
  stepRhythmMinutes,
  toggleRhythmCompleted,
  weekDatesFor,
  weekdayInitial,
  type HabitEngineStore,
  type RhythmDaySnapshot,
  type RhythmDefinition,
  type RhythmId,
} from '@/lib/habitEngine';
import {
  BookIcon,
  CheckIcon,
  ClockIcon,
  HandHeartIcon,
  MoonIcon,
  SunIcon,
  WindIcon,
} from '@/app/components/icons';

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
  { id: 'habits', label: 'Rhythms of Grace' },
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

/** Icon per rhythm, keyed by the engine's rhythm ids (compass + cards). */
const RHYTHM_ICONS: Record<RhythmId, (props: { className?: string }) => React.JSX.Element> = {
  morning: SunIcon,
  word: BookIcon,
  midday: WindIcon,
  community: HandHeartIcon,
};

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

  /** Grace-Based Habit Engine (identity-first formation). */
  const [engine, setEngine] = useState<HabitEngineStore | null>(null);
  /** Pulse rings from the most recent consecration tap, by rhythm id. */
  const [rhythmPulse, setRhythmPulse] = useState<RhythmId | null>(null);

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
      // The grace engine is a pure client-side mirror: load it inside the same
      // mount-gated async pass so the first client render matches the skeleton.
      setEngine(readHabitEngine());
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

  // -------------------------------------------------------------------------
  // Grace-Based Habit Engine — rhythms, not streaks
  // -------------------------------------------------------------------------

  /**
   * Today's rhythm snapshot. The engine record wins once it exists (it mirrors
   * every write on this device); on a first visit the day is derived from the
   * Altar OS layer so cloud-synced minutes stay continuous.
   */
  const todayDay = useMemo<RhythmDaySnapshot>(() => {
    const stored = engine?.days[today];
    if (stored) return stored;
    if (!today) return emptyRhythmDay();
    return {
      morning: { minutes: state.habits.prayer, completed: state.morningCompleted },
      word: { minutes: state.habits.scripture, completed: false },
      midday: { minutes: state.habits.worship, completed: false },
      community: { minutes: state.habits.service, completed: false },
    };
  }, [engine, today, state.habits, state.morningCompleted]);

  /** True when today sits inside an open (or past) Grace Season. */
  const restingToday = engine !== null && today !== '' && isRestingDay(engine, today);

  /** The seven-day compass window, richness and resting days included. */
  const compassWeek = useMemo(() => {
    if (engine === null || today === '') return [];
    return weekDatesFor(today).map((date) => {
      const day = readEngineDay(engine, date);
      const resting = isRestingDay(engine, date);
      return {
        date,
        weekday: weekdayInitial(date),
        fullness: resting ? 1 : dayFullness(day),
        minutes: dayMinutes(day),
        resting,
        isToday: date === today,
        upcoming: date > today,
      };
    });
  }, [engine, today]);

  const weekFullness = useMemo(() => {
    const lived = compassWeek.filter((day) => !day.upcoming);
    if (lived.length === 0) return 0;
    return lived.reduce((sum, day) => sum + day.fullness, 0) / lived.length;
  }, [compassWeek]);

  /** Persists the engine day and mirrors minutes into the cloud habit row. */
  const commitRhythmDay = useCallback(
    (nextDay: RhythmDaySnapshot, altarDay: AltarDayState) => {
      if (todayRef.current === '') return;
      saveEngineDay(todayRef.current, nextDay);
      setEngine(readHabitEngine());
      updateState(altarDay);
      void persist(altarDay);
    },
    // `persist` and `updateState` are stable helpers defined in this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /** Logs or removes minutes for a rhythm (counters freeze in a Grace Season). */
  const adjustRhythm = (rhythm: RhythmDefinition, delta: number) => {
    if (restingToday) return;
    const nextDay = stepRhythmMinutes(todayDay, rhythm.id, delta);
    const nextAltar: AltarDayState = {
      ...stateRef.current,
      habits: {
        ...stateRef.current.habits,
        [rhythm.habit]: clampHabitMinutes(stateRef.current.habits[rhythm.habit] + delta),
      },
    };
    setRhythmPulse(rhythm.id);
    commitRhythmDay(nextDay, nextAltar);
  };

  /** Toggles a rhythm's consecration check; the Morning Altar stays in step. */
  const toggleRhythm = (rhythm: RhythmDefinition) => {
    const nextDay = toggleRhythmCompleted(todayDay, rhythm.id);
    const nextAltar: AltarDayState = {
      ...stateRef.current,
      morningCompleted:
        rhythm.id === 'morning' ? nextDay.morning.completed : stateRef.current.morningCompleted,
    };
    setRhythmPulse(rhythm.id);
    commitRhythmDay(nextDay, nextAltar);
  };

  /** Enters or leaves a Grace Season: counters rest, history is preserved. */
  const toggleGraceMode = () => {
    if (engine === null || today === '') return;
    setEngine(setGraceMode(engine, !engine.graceMode, today));
  };

  /** Clears the consecration pulse so the tap animation is per-interaction. */
  useEffect(() => {
    if (rhythmPulse === null) return undefined;
    const timer = setTimeout(() => setRhythmPulse(null), 1100);
    return () => clearTimeout(timer);
  }, [rhythmPulse]);

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
          <MotionConfig reducedMotion="user">
          {/* Identity Rhythm Heading + Grace Season freeze switch */}
          <div className="relative overflow-hidden rounded-3xl border border-gold/20 bg-gradient-to-br from-pill/80 to-canvas/60 p-5 sm:p-6">
            {engine?.graceMode ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(125%_125%_at_50%_0%,rgba(245,158,11,0.12),transparent_58%)]"
              />
            ) : null}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h3
                  id="grace-rhythm-heading"
                  className="text-lg font-extrabold leading-snug tracking-tight text-espresso sm:text-xl"
                >
                  A Person Who Walks in Rhythms of Grace
                </h3>
                <p className="mt-1 max-w-md text-sm leading-6 text-muted">
                  Consistency rooted in His faithfulness, not your performance.
                </p>
              </div>

              <motion.button
                type="button"
                role="switch"
                aria-checked={engine?.graceMode ?? false}
                aria-label="Grace Season - pause the rhythm counters"
                onClick={toggleGraceMode}
                whileTap={{ scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                disabled={engine === null || today === ''}
                className={`inline-flex min-h-[44px] min-w-[144px] items-center gap-3 rounded-full border px-4 text-xs font-bold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:opacity-60 ${
                  engine?.graceMode
                    ? 'border-gold/50 bg-gold/15 text-gold'
                    : 'border-white/10 bg-canvas/50 text-slate-300 hover:border-gold/40 hover:text-gold'
                }`}
              >
                <span className="flex h-5 w-9 shrink-0 items-center rounded-full bg-canvas/70 p-0.5 ring-1 ring-inset ring-white/10">
                  <motion.span
                    layout
                    transition={{ type: 'spring', stiffness: 430, damping: 32 }}
                    className={`block h-4 w-4 rounded-full ${engine?.graceMode ? 'ml-auto bg-gold' : 'bg-slate-400'}`}
                  />
                </span>
                Grace Season
              </motion.button>
            </div>

            {engine?.graceMode ? (
              <motion.p
                key="grace-badge"
                role="status"
                aria-live="polite"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                className="relative mt-4 inline-flex items-start gap-2 rounded-2xl border border-gold/30 bg-gold/10 px-4 py-3 text-xs font-semibold leading-5 text-gold shadow-[0_0_22px_rgba(245,158,11,0.18)]"
              >
                <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold amen-breath" />
                Rest is Consecration &mdash; Grace Mode active. No streaks broken.
              </motion.p>
            ) : (
              <p className="mt-3 text-xs leading-5 text-muted">
                Going into a resting season? Switch this on and every counter pauses &mdash; the days you
                rest are honoured, never counted against you.
              </p>
            )}
          </div>

          {/* Weekly Formation Compass */}
          <div className="mt-6 rounded-3xl border border-sand bg-pill p-5 shadow-soft sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h4 className={eyebrowClass}>This Week&apos;s Compass</h4>
              <p className="text-xs font-medium text-muted">
                {Math.round(weekFullness * 100)}% of days lived in rhythm &middot; {formationLabel(weekFullness * 100)}
              </p>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-1.5 text-center">
              {compassWeek.map((day) => (
                <div key={day.date} className="flex flex-col items-center gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted">{day.weekday}</span>
                  <div
                    className={`relative h-10 w-10 rounded-full border transition-colors duration-300 ${
                      day.resting
                        ? 'border-gold/40 bg-gold/15'
                        : day.isToday
                        ? 'border-gold bg-gold/25'
                        : 'border-sand bg-canvas/60'
                    }`}
                  >
                    {day.resting ? <MoonIcon className="absolute inset-0 m-auto h-5 w-5 text-gold" /> : null}
                    {!day.resting ? (
                      <div
                        className="absolute inset-1 rounded-full"
                        style={{
                          background: `conic-gradient(rgba(245,158,11,0.85) 0% ${day.fullness * 100}%, rgba(30,46,66,0.25) ${day.fullness * 100}% 100%)`,
                        }}
                      />
                    ) : null}
                    {day.isToday ? <span className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-gold amen-breath" /> : null}
                  </div>
                  <span className="text-[11px] font-medium tabular-nums text-slate-400">{day.minutes}</span>
                </div>
              ))}
            </div>

            <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-sand">
              <motion.div
                className="h-full rounded-full bg-gold"
                initial={{ width: 0 }}
                animate={{ width: `${weekFullness * 100}%` }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              />
              <span className="sr-only">{Math.round(weekFullness * 100)}% of days lived in rhythm</span>
            </div>

            <p className="mt-1 text-[11px] leading-5 text-muted">
              {weekFullness >= 0.75
                ? `${Math.round(weekFullness * RHYTHMS.length)} of ${RHYTHMS.length * RHYTHM_WEEK_TARGET} rhythms marked practised this week`
                : 'Each day counts. Begin where you are.'}
            </p>
          </div>

          {/* Tactile Rhythm Cards */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {RHYTHMS.map((rhythm) => {
              const snapshot = todayDay[rhythm.id];
              const progress = rhythmProgress(snapshot);
              const practiced = hasPractised(todayDay, rhythm.id);
              const pulsed = rhythmPulse === rhythm.id;
              const canAdd = !restingToday && snapshot.minutes < HABIT_MAX;
              const canRemove = !restingToday && snapshot.minutes > 0;

              return (
                <motion.div
                  key={rhythm.id}
                  layout
                  whileHover={{ y: -2 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                  className={`${whiteCardClass} relative p-4`}
                >
                  <div className="flex items-center gap-1">
                    <span
                      aria-hidden="true"
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${practiced ? 'border-gold/35 bg-gold/15 text-gold' : 'border-sand bg-canvas/60 text-muted'}`}
                    >
                      {RHYTHM_ICONS[rhythm.id]({ className: 'h-5 w-5' })}
                    </span>
                    <div className="min-w-0 flex-1 px-2">
                      <p className="break-words text-xs font-semibold uppercase leading-tight tracking-wider text-espresso">
                        {rhythm.name}
                      </p>
                      <p className="mt-0.5 break-words text-xs leading-tight text-muted">
                        {rhythm.discipline}
                      </p>
                    </div>

                    <motion.button
                      type="button"
                      aria-pressed={snapshot.completed}
                      onClick={() => toggleRhythm(rhythm)}
                      whileTap={{ scale: 0.95 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      disabled={restingToday}
                      className={`relative h-9 w-9 shrink-0 rounded-full text-xs font-bold transition disabled:opacity-40 ${
                        snapshot.completed
                          ? 'bg-gold text-canvas hover:bg-gold-deep'
                          : 'border border-sand bg-pill text-espresso hover:border-gold hover:bg-gold/10'
                      }`}
                      aria-label={snapshot.completed ? 'Mark not completed' : 'Mark consecrated for the day'}
                    >
                      <CheckIcon className="absolute inset-0 m-auto h-4 w-4" />
                    </motion.button>
                  </div>

                  <div className="mt-3 flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-sand">
                        <motion.div
                          className="h-full rounded-full bg-gold"
                          initial={false}
                          animate={{ width: `${progress * 100}%` }}
                          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                        />
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                        <span className="shrink-0 tabular-nums text-muted">
                          {snapshot.minutes} min logged
                        </span>
                        <span className="min-w-0 truncate text-right text-muted">
                          {RHYTHM_PRACTICE_MINUTES - snapshot.minutes > 0
                            ? `${RHYTHM_PRACTICE_MINUTES - snapshot.minutes}m to goal`
                            : 'Goal achieved'}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <motion.button
                        type="button"
                        onClick={() => adjustRhythm(rhythm, -RHYTHM_MINUTE_STEP)}
                        disabled={!canRemove}
                        whileTap={{ scale: 0.95 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        aria-label={`Remove ${RHYTHM_MINUTE_STEP} min from ${rhythm.name.toLowerCase()}`}
                        className={`flex h-7 w-7 items-center justify-center rounded-full border text-lg font-bold transition disabled:cursor-not-allowed disabled:opacity-30 ${
                          canRemove ? 'border-sand bg-pill text-espresso hover:border-gold hover:bg-gold/10' : 'border-sand bg-canvas/50 text-muted'
                        }`}
                      >
                        &minus;
                      </motion.button>
                      <motion.button
                        type="button"
                        onClick={() => adjustRhythm(rhythm, RHYTHM_MINUTE_STEP)}
                        disabled={!canAdd}
                        whileTap={{ scale: 0.95 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        aria-label={`Add ${RHYTHM_MINUTE_STEP} min to ${rhythm.name.toLowerCase()}`}
                        className={`flex h-7 w-7 items-center justify-center rounded-full border text-lg font-bold transition disabled:cursor-not-allowed disabled:opacity-30 ${
                          canAdd ? 'border-sand bg-pill text-espresso hover:border-gold hover:bg-gold/10' : 'border-sand bg-canvas/50 text-muted'
                        }`}
                      >
                        +
                      </motion.button>
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {pulsed ? (
                      <motion.span
                        key="pulse"
                        initial={{ opacity: 0.6, scale: 0.6 }}
                        animate={{ opacity: 0, scale: 2.2 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.9, ease: 'easeOut' }}
                        className="absolute -inset-1 rounded-full border-2 border-gold"
                      />
                    ) : null}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>

          <p className="mt-5 text-xs leading-5 text-muted">
            Signed-in believers sync daily totals to their account; guests keep everything safely on this
            device. Days within a Grace Season rest in consecration &mdash; no rhythms kept, none lost.
          </p>
          </MotionConfig>
        </section>
      ) : null}

    </div>
  );
}
