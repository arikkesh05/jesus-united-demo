import { clampHabitMinutes, type HabitMinutes } from "@/lib/altar";

/**
 * Grace-Based Habit Engine (Altar OS — Habit Rhythms) — identity-first formation.
 *
 * Replaces punitive streak mathematics with two gentler ideas:
 *  1. **Rhythms, not streaks** — four foundational daily cadences, each logged
 *     by time (`+5 min`) or a consecration check, measured as *fullness* of the
 *     days actually lived rather than as a pass/fail chain.
 *  2. **Grace Seasons** — a freeze switch that pauses the counters while
 *     preserving every day of history. Days inside a season are marked
 *     *resting*, never *missed*: nothing is broken, so nothing can be lost.
 *
 * Guest-first persistence: the engine mirrors into localStorage under
 * `jesusunited:habit-engine:v1` (SSR-safe reads, sanitized parsing, non-fatal
 * writes). Minute totals additionally flow through the cloud-synced Altar OS
 * layer (`src/lib/altar.ts` -> `altar_completions` / `habits`), so signed-in
 * believers still sync their formation to their account.
 */

export const HABIT_ENGINE_STORAGE_KEY = "jesusunited:habit-engine:v1";

/** Minutes that count as having practised a rhythm on a given day. */
export const RHYTHM_PRACTICE_MINUTES = 5;

/** Days in the weekly compass window (Monday through Sunday). */
export const RHYTHM_WEEK_TARGET = 7;

export const RHYTHM_MINUTE_STEP = 5;

export type RhythmId = "morning" | "word" | "midday" | "community";

export interface RhythmDefinition {
  id: RhythmId;
  /** Cloud-synced minute counter this rhythm logs into (`habits` table). */
  habit: keyof HabitMinutes;
  /** Identity-first rhythm name. */
  name: string;
  /** The underlying discipline being formed. */
  discipline: string;
  /** Short liturgical cadence hint. */
  cadence: string;
}

export const RHYTHMS: readonly RhythmDefinition[] = [
  {
    id: "morning",
    habit: "prayer",
    name: "Morning Consecration",
    discipline: "Prayer",
    cadence: "First light",
  },
  {
    id: "word",
    habit: "scripture",
    name: "Word Anchoring",
    discipline: "Scripture",
    cadence: "Before the noise",
  },
  {
    id: "midday",
    habit: "worship",
    name: "Midday Breath",
    discipline: "Silence & Worship",
    cadence: "The sixth hour",
  },
  {
    id: "community",
    habit: "service",
    name: "Communal Intercession",
    discipline: "Prayer Wall / Service",
    cadence: "Carrying others",
  },
];

export const RHYTHM_IDS: readonly RhythmId[] = RHYTHMS.map(
  (rhythm) => rhythm.id,
);

export interface RhythmSnapshot {
  minutes: number;
  completed: boolean;
}

export type RhythmDaySnapshot = Record<RhythmId, RhythmSnapshot>;

/** One Grace Season: `end === null` while the rest is still open. */
export interface GraceSeason {
  start: string;
  end: string | null;
}

export interface HabitEngineStore {
  /** Freeze switch state — counters pause, history is preserved. */
  graceMode: boolean;
  /** Every season ever entered, so resting days stay honoured in the compass. */
  graceSeasons: GraceSeason[];
  /** Per local date (`YYYY-MM-DD`) rhythm snapshots. */
  days: Record<string, RhythmDaySnapshot>;
}

export function emptyRhythmDay(): RhythmDaySnapshot {
  return {
    morning: { minutes: 0, completed: false },
    word: { minutes: 0, completed: false },
    midday: { minutes: 0, completed: false },
    community: { minutes: 0, completed: false },
  };
}

export function emptyHabitEngineStore(): HabitEngineStore {
  return { graceMode: false, graceSeasons: [], days: {} };
}

function isRhythmId(value: string): value is RhythmId {
  return (RHYTHM_IDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Guest-first persistence
// ---------------------------------------------------------------------------

/** Sanitizes one stored day; unknown shapes degrade to an empty day. */
function sanitizeRhythmDay(raw: unknown): RhythmDaySnapshot {
  const day = emptyRhythmDay();
  if (!raw || typeof raw !== "object") return day;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isRhythmId(key)) continue;
    if (!value || typeof value !== "object") continue;
    const snapshot = value as { minutes?: unknown; completed?: unknown };
    day[key] = {
      minutes:
        typeof snapshot.minutes === "number"
          ? clampHabitMinutes(snapshot.minutes)
          : 0,
      completed: snapshot.completed === true,
    };
  }

  return day;
}

function sanitizeSeasons(raw: unknown): GraceSeason[] {
  if (!Array.isArray(raw)) return [];

  const seasons: GraceSeason[] = [];
  for (const entry of raw as unknown[]) {
    if (!entry || typeof entry !== "object") continue;
    const season = entry as { start?: unknown; end?: unknown };
    if (typeof season.start !== "string" || season.start === "") continue;
    seasons.push({
      start: season.start,
      end:
        typeof season.end === "string" && season.end !== "" ? season.end : null,
    });
  }
  return seasons;
}

/** Reads the whole engine; corrupt or blocked storage behaves like a first visit. */
export function readHabitEngine(): HabitEngineStore {
  if (typeof window === "undefined") return emptyHabitEngineStore();

  try {
    const raw = window.localStorage.getItem(HABIT_ENGINE_STORAGE_KEY);
    if (!raw) return emptyHabitEngineStore();

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyHabitEngineStore();

    const record = parsed as {
      graceMode?: unknown;
      graceSeasons?: unknown;
      days?: unknown;
    };
    const days: Record<string, RhythmDaySnapshot> = {};
    if (record.days && typeof record.days === "object") {
      for (const [date, day] of Object.entries(
        record.days as Record<string, unknown>,
      )) {
        days[date] = sanitizeRhythmDay(day);
      }
    }

    return {
      graceMode: record.graceMode === true,
      graceSeasons: sanitizeSeasons(record.graceSeasons),
      days,
    };
  } catch {
    // Private-mode / quota errors: behave like a first-time visitor.
    return emptyHabitEngineStore();
  }
}

/** Persists the engine; quota failures are non-fatal (state stays in memory). */
export function writeHabitEngine(store: HabitEngineStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      HABIT_ENGINE_STORAGE_KEY,
      JSON.stringify(store),
    );
  } catch {
    // Non-fatal: the in-memory store keeps the session consistent.
  }
}

/** One day's snapshot from a store, always fully populated. */
export function readEngineDay(
  store: HabitEngineStore,
  date: string,
): RhythmDaySnapshot {
  return store.days[date] ?? emptyRhythmDay();
}

// ---------------------------------------------------------------------------
// Local-time date helpers (never `toISOString`, which shifts by timezone)
// ---------------------------------------------------------------------------

/** Formats a Date to a local `YYYY-MM-DD` key. */
export function toLocalDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const dayOfMonth = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

/** Today's local key. */
export function todayDateKey(): string {
  return toLocalDate(new Date());
}

/** Monday-anchored start of the week containing `date`, at local midnight. */
export function startOfWeek(date: string): Date {
  const [year, month, day] = date
    .split("-")
    .map((part) => Number.parseInt(part, 10));
  const anchor = new Date(year, (month || 1) - 1, day || 1);
  if (Number.isNaN(anchor.getTime())) return new Date();

  // getDay(): 0 = Sunday, so Monday-anchored weeks shift by six.
  const offset = (anchor.getDay() + 6) % 7;
  anchor.setDate(anchor.getDate() - offset);
  anchor.setHours(0, 0, 0, 0);
  return anchor;
}

/** The Monday-anchored week containing `date`, oldest day first. */
export function weekDatesFor(date: string): string[] {
  const monday = startOfWeek(date);
  const keys: string[] = [];

  for (let index = 0; index < RHYTHM_WEEK_TARGET; index += 1) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    keys.push(toLocalDate(day));
  }
  return keys;
}

/** Weekday initial for a date key, used by the compass rail labels. */
export function weekdayInitial(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { weekday: "narrow" });
}

// ---------------------------------------------------------------------------
// Grace Seasons — freeze the counters, never the history
// ---------------------------------------------------------------------------

/** True when `date` falls inside any Grace Season — a resting day, never a miss. */
export function isRestingDay(store: HabitEngineStore, date: string): boolean {
  return store.graceSeasons.some(
    (season) =>
      season.start <= date && (season.end === null || date <= season.end),
  );
}

/**
 * Enters or leaves a Grace Season. Entering opens a season dated today;
 * leaving seals every open season with today as its end, so the days inside it
 * stay marked as consecrated rest forever rather than as a broken chain.
 */
export function setGraceMode(
  store: HabitEngineStore,
  enabled: boolean,
  date: string,
): HabitEngineStore {
  if (enabled) {
    const alreadyOpen = store.graceSeasons.some(
      (season) => season.end === null,
    );
    const next: HabitEngineStore = {
      ...store,
      graceMode: true,
      graceSeasons: alreadyOpen
        ? store.graceSeasons
        : [...store.graceSeasons, { start: date, end: null }],
    };
    writeHabitEngine(next);
    return next;
  }

  const next: HabitEngineStore = {
    ...store,
    graceMode: false,
    graceSeasons: store.graceSeasons.map((season) =>
      season.end === null ? { ...season, end: date } : season,
    ),
  };
  writeHabitEngine(next);
  return next;
}

// ---------------------------------------------------------------------------
// Rhythm math
// ---------------------------------------------------------------------------

/** Whether a rhythm snapshot counts as practised on its day. */
export function isPractised(snapshot: RhythmSnapshot): boolean {
  return snapshot.completed || snapshot.minutes >= RHYTHM_PRACTICE_MINUTES;
}

/** Whether one rhythm counted on `day`, addressed by id. */
export function hasPractised(day: RhythmDaySnapshot, id: RhythmId): boolean {
  return isPractised(day[id]);
}

/** How far one rhythm has come today: a consecration check counts as full. */
export function rhythmProgress(snapshot: RhythmSnapshot): number {
  if (snapshot.completed) return 1;
  return Math.min(1, snapshot.minutes / RHYTHM_PRACTICE_MINUTES);
}

/** Holistic fullness of a day (0..1): the average across all four rhythms. */
export function dayFullness(day: RhythmDaySnapshot): number {
  const total = RHYTHMS.reduce(
    (sum, rhythm) => sum + rhythmProgress(day[rhythm.id]),
    0,
  );
  return total / RHYTHMS.length;
}

/** Minutes offered across all four rhythms on one day. */
export function dayMinutes(day: RhythmDaySnapshot): number {
  return RHYTHMS.reduce((sum, rhythm) => sum + day[rhythm.id].minutes, 0);
}

/** Today's minutes per rhythm, shaped for the cloud-synced Altar OS layer. */
export function dayHabitMinutes(day: RhythmDaySnapshot): HabitMinutes {
  return {
    prayer: day.morning.minutes,
    scripture: day.word.minutes,
    worship: day.midday.minutes,
    service: day.community.minutes,
  };
}

// ---------------------------------------------------------------------------
// Store mutators (every write persists immediately — guest-first)
// ---------------------------------------------------------------------------

/** Persists one day's snapshot into the engine and returns the next store. */
export function saveEngineDay(
  date: string,
  day: RhythmDaySnapshot,
): HabitEngineStore {
  const store = readHabitEngine();
  const next: HabitEngineStore = {
    ...store,
    days: { ...store.days, [date]: day },
  };
  writeHabitEngine(next);
  return next;
}

/** Flips one rhythm's consecration check for the day (no minutes added). */
export function toggleRhythmCompleted(
  day: RhythmDaySnapshot,
  id: RhythmId,
): RhythmDaySnapshot {
  return { ...day, [id]: { ...day[id], completed: !day[id].completed } };
}

/** Adds (or subtracts) minutes on one rhythm; clamped by the Altar OS rules. */
export function stepRhythmMinutes(
  day: RhythmDaySnapshot,
  id: RhythmId,
  step: number,
): RhythmDaySnapshot {
  const snapshot = day[id];
  return {
    ...day,
    [id]: { ...snapshot, minutes: clampHabitMinutes(snapshot.minutes + step) },
  };
}

/** Gentle identity language for the compass — the inverse of streak pressure. */
export function formationLabel(fullness: number): string {
  if (fullness >= 85) return "Deeply rooted";
  if (fullness >= 60) return "Steadily forming";
  if (fullness >= 35) return "Growing tenderly";
  if (fullness > 0) return "Beginning gently";
  return "Resting at the threshold";
}
