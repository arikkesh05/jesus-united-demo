/**
 * Altar OS v2 — the liturgical clock, the examen state machine and the
 * rhythm-keeping count (`src/lib/altarRhythms.ts`).
 *
 * Three ideas live here, all of them deliberately free of React, the DOM and
 * the network so the whole rule set can be pinned by `node --test`:
 *
 *  1. **Time-gated rhythms.** Every altar rhythm has a canonical hour. Outside
 *     its hour a rhythm is *waiting*, never *missing* — the gate is advisory
 *     copy ("opens in 2h 14m"), not a lock. The altar day rolls at dawn
 *     (05:00 local), so an examen prayed at 01:00 still belongs to yesterday.
 *
 *  2. **A rhythm count, not a punishment.** The chain only breaks on a day that
 *     was genuinely lived and unkept. Days inside a Grace Season bridge the
 *     chain without adding to it, and today is always still open — see
 *     {@link rhythmStreak}.
 *
 *  3. **The Examen as a state machine.** Five Ignatian steps, validated one at a
 *     time, with a draft shape that can survive a reload or a dead browser.
 *
 * Dates are local-date keys (`YYYY-MM-DD`), matching `src/lib/altar.ts` and
 * `src/lib/habitEngine.ts`. Clocks are always injected — nothing in this module
 * reads `Date.now()` on its own.
 */

// ---------------------------------------------------------------------------
// Canonical hours — the time-gated rhythm windows
// ---------------------------------------------------------------------------

export type RhythmPhase = "morning" | "midday" | "evening";

export const RHYTHM_PHASES: readonly RhythmPhase[] = [
  "morning",
  "midday",
  "evening",
];

/** All minutes are minutes since local midnight. */
export interface RhythmWindow {
  phase: RhythmPhase;
  /** Tab / heading label. */
  label: string;
  /** Liturgical hint shown beside the hours. */
  cadence: string;
  /** Inclusive opening minute. */
  startMinute: number;
  /** Exclusive closing minute. */
  endMinute: number;
}

/**
 * The three gated hours. `midday` has no Altar OS panel yet — it exists here so
 * the quiet gaps either side of it read as *waiting* rather than as a closed
 * panel, and so the gate can name the next hour honestly.
 */
export const RHYTHM_WINDOWS: readonly RhythmWindow[] = [
  {
    phase: "morning",
    label: "Morning Altar",
    cadence: "First light, before the noise",
    startMinute: 5 * 60,
    endMinute: 11 * 60 + 30,
  },
  {
    phase: "midday",
    label: "Midday Breath",
    cadence: "The sixth hour — a pause, not a task",
    startMinute: 11 * 60 + 30,
    endMinute: 15 * 60,
  },
  {
    phase: "evening",
    label: "Evening Examen",
    cadence: "Closing the day with Him",
    startMinute: 17 * 60,
    endMinute: 21 * 60 + 30,
  },
];

/** The altar day begins here (05:00 local) — the hours before it are yesterday. */
export const DAWN_MINUTE = 5 * 60;

/** Minutes in a local day. */
const DAY_MINUTES = 1440;

function isRhythmPhase(value: unknown): value is RhythmPhase {
  return (
    typeof value === "string" &&
    (RHYTHM_PHASES as readonly string[]).includes(value)
  );
}

/** The window for a phase; morning is the fallback so the type stays total. */
export function windowForPhase(phase: RhythmPhase): RhythmWindow {
  const found = RHYTHM_WINDOWS.find((window) => window.phase === phase);
  return found ?? RHYTHM_WINDOWS[0];
}

/** Whole minutes after local midnight, floored — 0…1439. */
export function minutesOfDay(now: Date): number {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return 0;
  return now.getHours() * 60 + now.getMinutes();
}

/** `YYYY-MM-DD` in the machine's local zone. */
export function toDateKey(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The altar day a clock reading belongs to: anything before dawn still belongs
 * to the day that just ended, so a 01:00 examen seals yesterday's altar.
 */
export function altarDayKey(now: Date): string {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return "";
  const date = new Date(now.getTime());
  if (minutesOfDay(date) < DAWN_MINUTE) date.setDate(date.getDate() - 1);
  return toDateKey(date);
}

/**
 * A local date key shifted by whole days. Anchored at local noon so a DST
 * transition — which can delete local midnight — can never skip a day.
 */
export function shiftDayKey(dateKey: string, deltaDays: number): string {
  if (!isDateKey(dateKey)) return "";
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + Math.trunc(deltaDays || 0));
  return toDateKey(date);
}


/** A well-formed, real `YYYY-MM-DD` local key. */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  return toDateKey(date) === value;
}

/** `1020` → `"5:30 PM"`. Fixed 12-hour format: no locale drift in the copy. */
export function formatClock(minuteOfDayValue: number): string {
  const minute = Math.min(
    DAY_MINUTES,
    Math.max(
      0,
      Math.trunc(Number.isFinite(minuteOfDayValue) ? minuteOfDayValue : 0),
    ),
  );
  // 1440 is midnight again: normalise first, then read the meridiem off the
  // normalised value (720 is noon, so 0 and 1440 both land on 12 o'clock).
  const normalized = minute % DAY_MINUTES;
  const meridiem = normalized < 12 * 60 ? "AM" : "PM";
  const withinHalfDay = normalized % (12 * 60);
  const hour = Math.floor(withinHalfDay / 60) || 12;
  return `${hour}:${`${withinHalfDay % 60}`.padStart(2, "0")} ${meridiem}`;
}

/** `"5:00 PM – 9:30 PM"` for a window. */
export function formatWindowHours(window: RhythmWindow): string {
  return `${formatClock(window.startMinute)} – ${formatClock(
    Math.min(window.endMinute, DAY_MINUTES - 1),
  )}`;
}

/** A duration in whole minutes: `"2h 14m"`, `"45 min"`, `"less than a minute"`. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(minutes) ? minutes : 0));
  if (total === 0) return "less than a minute";
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** The window open at this clock reading, or `null` in the quiet hours. */
export function phaseForTime(now: Date): RhythmPhase | null {
  const minute = minutesOfDay(now);
  for (const window of RHYTHM_WINDOWS) {
    if (minute >= window.startMinute && minute < window.endMinute) {
      return window.phase;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The gate — advisory copy about the canonical hour, never a lock
// ---------------------------------------------------------------------------

/** How a gated rhythm relates to the clock right now. */
export type RhythmGateStatus =
  /** Inside the hour. */
  | "open"
  /** The hour has passed today; it returns tomorrow. */
  | "later"
  /** The hour has not opened yet today. */
  | "waiting";

export interface RhythmGate {
  phase: RhythmPhase;
  label: string;
  cadence: string;
  hours: string;
  status: RhythmGateStatus;
  /** Whole minutes until the hour closes — 0 while the hour is not open. */
  closesInMinutes: number;
  /** Whole minutes until the hour opens — 0 while the hour is open. */
  opensInMinutes: number;
  /** `"5:00 PM today"` / `"5:00 PM tomorrow"` — when the hour next opens. */
  opensLabel: string;
  /** Pastoral one-liner for the panel header. */
  notice: string;
}

/** Whole minutes from `minute` until `target`, wrapping into tomorrow. */
function minutesUntil(minute: number, target: number): number {
  return (target - minute + DAY_MINUTES) % DAY_MINUTES;
}

/**
 * The state of one rhythm's canonical hour at a given clock reading.
 *
 * Nothing here blocks a visitor. A closed hour yields copy — the hour a rhythm
 * belongs to and how far off it is — because an altar is not a turnstile:
 * anyone may write at any hour, and the gate exists to teach the rhythm, not to
 * enforce it.
 */
export function rhythmGate(phase: RhythmPhase, now: Date): RhythmGate {
  const window = windowForPhase(phase);
  const minute = minutesOfDay(now);
  const opensAt = window.startMinute;
  const closesAt = window.endMinute;

  const base = {
    phase: window.phase,
    label: window.label,
    cadence: window.cadence,
    hours: formatWindowHours(window),
  };

  if (minute >= opensAt && minute < closesAt) {
    const closesInMinutes = closesAt - minute;
    return {
      ...base,
      status: "open",
      closesInMinutes,
      opensInMinutes: 0,
      opensLabel: `${formatClock(opensAt)} today`,
      notice: `${window.label} is open until ${formatClock(
        Math.min(closesAt, DAY_MINUTES - 1),
      )} — about ${formatDuration(closesInMinutes)} of quiet ahead.`,
    };
  }

  const opensInMinutes = minutesUntil(minute, opensAt);
  const tomorrow = opensInMinutes >= DAY_MINUTES - minute;
  const opensLabel = `${formatClock(opensAt)} ${tomorrow ? "tomorrow" : "today"}`;

  if (minute >= closesAt) {
    return {
      ...base,
      status: "later",
      closesInMinutes: 0,
      opensInMinutes,
      opensLabel,
      notice: `Today's hour has passed — ${window.label} returns at ${opensLabel}. Writing now still counts, and it is filed under today.`,
    };
  }

  return {
    ...base,
    status: "waiting",
    closesInMinutes: 0,
    opensInMinutes,
    opensLabel,
    notice: `${window.label} opens at ${opensLabel} — about ${formatDuration(
      opensInMinutes,
    )} away. You can still begin now; nothing here expires.`,
  };
}

/**
 * The `notice` for whatever the clock currently reads: the open hour's own
 * line, or the next hour's — "the hours are quiet, Evening Examen opens at
 * 5:00 PM". `null` only for an unusable clock.
 */
export function quietHoursNotice(now: Date): string | null {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  const open = phaseForTime(now);
  if (open !== null) return rhythmGate(open, now).notice;

  const minute = minutesOfDay(now);
  let next = RHYTHM_WINDOWS[0];
  let shortest = DAY_MINUTES;
  for (const window of RHYTHM_WINDOWS) {
    const wait = minutesUntil(minute, window.startMinute);
    if (wait < shortest) {
      shortest = wait;
      next = window;
    }
  }
  const tomorrow = shortest >= DAY_MINUTES - minute;
  return `The hours are quiet. ${next.label} opens at ${formatClock(
    next.startMinute,
  )} ${tomorrow ? "tomorrow" : "today"} — about ${formatDuration(shortest)} away. Anything you write now is kept.`;
}


// ---------------------------------------------------------------------------
// The rhythm count — a chain that only breaks on a day actually lived
// ---------------------------------------------------------------------------

/** How far back the chain walk will look before it stops counting. */
export const STREAK_MAX_LOOKBACK_DAYS = 400;

/** What today looks like from the outside. */
export type RhythmStreakState =
  /** Today is written. */
  | "practised"
  /** Today sits inside a Grace Season. */
  | "resting"
  /** Nothing today yet, but the chain behind it is alive. */
  | "open"
  /** Nothing to hold yet — including the very first day. */
  | "held";

export interface RhythmStreak {
  /** Consecutive kept days, with resting days bridging but not counting. */
  days: number;
  keptToday: boolean;
  restingToday: boolean;
  /** Grace-Season days bridged since the most recent kept day. */
  restingRun: number;
  /** A day lived, left unkept and un-resting sits between the chain and today. */
  broken: boolean;
  state: RhythmStreakState;
  /** Pastoral one-liner — the count is never phrased as a loss. */
  label: string;
}

export interface RhythmStreakInput {
  /** Every altar-day key with a sealed journal entry — any order, any noise. */
  keptKeys: Iterable<string>;
  /** Today's altar-day key (dawn-rolled), from {@link altarDayKey}. */
  todayKey: string;
  /** Grace-Season test, supplied by the caller from `habitEngine`. */
  isResting?: (dateKey: string) => boolean;
  /** Defaults to {@link STREAK_MAX_LOOKBACK_DAYS}. */
  maxLookbackDays?: number;
}

function streakLabel(state: RhythmStreakState, days: number, restingRun: number): string {
  const count = `${days} day${days === 1 ? "" : "s"}`;
  if (state === "practised" && days === 1) {
    return "One altar kept. Begin again tomorrow — that is the whole rhythm.";
  }
  if (state === "practised") {
    return `${count} of rhythm — grace one day at a time, never a chain to guard.`;
  }
  if (state === "resting") {
    return restingRun > 0 && days === 0
      ? "Resting is being formed too. Nothing here is broken."
      : `Resting through a Grace Season with ${count} held behind you.`;
  }
  if (state === "open") {
    return `${count} kept so far — today is still open, and nothing expires.`;
  }
  return "No count to keep yet. Today is the first page.";
}

/**
 * Days of kept rhythm, ending today or yesterday.
 *
 * Three mercies make this different from a streak counter:
 *  - **Today is never a break.** Unkept and un-resting today leaves the chain
 *    standing on yesterday — the hour may still be ahead of the visitor.
 *  - **Grace-Season days bridge, they do not count.** A rested day is honoured
 *    as rest (so `restingRun` records it) rather than padded into the count.
 *  - **The walk stops at a day that was lived and left**, so the number can
 *    never leap a gap and claim a run that never happened.
 */
export function rhythmStreak(input: RhythmStreakInput): RhythmStreak {
  const todayKey = isDateKey(input.todayKey) ? input.todayKey : "";
  const test =
    typeof input.isResting === "function" ? input.isResting : () => false;

  const blank = (state: RhythmStreakState): RhythmStreak => ({
    days: 0,
    keptToday: false,
    restingToday: false,
    restingRun: 0,
    broken: state === "held",
    state,
    label: streakLabel(state, 0, 0),
  });

  if (todayKey === "") return blank("held");

  const kept = new Set<string>();
  const source = input.keptKeys;
  if (source && typeof source === "object" && typeof source[Symbol.iterator] === "function") {
    for (const key of source) if (isDateKey(key)) kept.add(key);
  }

  const maxLookback = Math.max(
    1,
    Math.trunc(
      typeof input.maxLookbackDays === "number" &&
        Number.isFinite(input.maxLookbackDays)
        ? input.maxLookbackDays
        : STREAK_MAX_LOOKBACK_DAYS,
    ),
  );

  const keptToday = kept.has(todayKey);
  const restingToday = keptToday ? false : test(todayKey) === true;
  let days = 0;
  let restingRun = 0;
  if (keptToday) days += 1;
  else if (restingToday) restingRun += 1;

  // Today is never the break day, so the walk starts at yesterday.
  let cursor = shiftDayKey(todayKey, -1);
  for (let walked = 0; walked < maxLookback; walked += 1) {
    if (cursor === "") break;
    if (kept.has(cursor)) {
      days += 1;
      cursor = shiftDayKey(cursor, -1);
      continue;
    }
    if (test(cursor) === true) {
      restingRun += 1;
      cursor = shiftDayKey(cursor, -1);
      continue;
    }
    break;
  }

  const state: RhythmStreakState = keptToday
    ? "practised"
    : restingToday
      ? "resting"
      : days > 0
        ? "open"
        : "held";

  return {
    days,
    keptToday,
    restingToday,
    restingRun,
    broken: state === "held",
    state,
    label: streakLabel(state, days, restingRun),
  };
}


// ---------------------------------------------------------------------------
// Text hygiene — prose keeps its line breaks, control characters do not
// ---------------------------------------------------------------------------

/**
 * Journal-safe clamp. Unlike the wall sanitiser (which flattens everything to
 * one line for a compact card), a journal keeps paragraph breaks: only runs of
 * three or more are folded. Control characters, zero-width joiners and bidi
 * overrides are dropped because they are how a pasted string hides content —
 * and everything is capped at a word boundary so a pasted wall of text cannot
 * balloon a stored draft.
 */
export function clampJournalText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  const limit = Math.max(1, Math.trunc(Number.isFinite(maxChars) ? maxChars : 1));
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit);
  const boundary = clipped.lastIndexOf(" ");
  const cut = boundary > limit * 0.6 ? clipped.slice(0, boundary) : clipped;
  return cut.trimEnd();
}

/** A storage timestamp, or `""` when the value cannot be read as one. */
export function normalizeIso(value: unknown): string {
  if (typeof value !== "string") return "";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString();
}

// ---------------------------------------------------------------------------
// The Examen — five Ignatian steps, validated one at a time
// ---------------------------------------------------------------------------

export type ExamenStepId =
  | "gratitude"
  | "review"
  | "contrition"
  | "grace"
  | "release";

export interface ExamenStep {
  id: ExamenStepId;
  /** Short rail label. */
  label: string;
  /** The question put to the visitor. */
  prompt: string;
  /** A gentle model answer, shown under the prompt. */
  hint: string;
}

export const EXAMEN_STEPS: readonly ExamenStep[] = [
  {
    id: "gratitude",
    label: "Gratitude",
    prompt:
      "Name the gifts of today — however small. Where did good come from?",
    hint: "Three named gifts are enough: coffee, a text message, a green light.",
  },
  {
    id: "review",
    label: "Review",
    prompt: "Where was He today, and where did you drift?",
    hint: "Both halves count. The drifting is not the point of the exercise.",
  },
  {
    id: "contrition",
    label: "Honesty",
    prompt:
      "What needs to be set down? Name it plainly — no rehearsal, no defence.",
    hint: "One sentence. He already knows it; the telling is for you.",
  },
  {
    id: "grace",
    label: "Grace",
    prompt:
      "What do you need from Him for tomorrow — for yourself, and for whom?",
    hint: "Ask for the plain thing. Vague requests teach vague patience.",
  },
  {
    id: "release",
    label: "Release",
    prompt: "What are you leaving here, so that you can sleep?",
    hint: "The unfinished thing is allowed to stay unfinished overnight.",
  },
];

export const EXAMEN_STEP_IDS: readonly ExamenStepId[] = EXAMEN_STEPS.map(
  (step) => step.id,
);

/** A few words — enough to know the visitor actually answered. */
export const EXAMEN_MIN_CHARS = 12;

/** Per-step ceiling. */
export const EXAMEN_ANSWER_MAX = 900;

/** The single burden handed over at the end of the examen. */
export const JOURNAL_BURDEN_MAX = 320;

/**
 * The wall's own ceiling for a quick share (`DROP_IN_BODY_MAX` in
 * `intercessionPulse.ts`). Kept as a local constant so this module stays
 * dependency-free, and so a burden can be handed to the prayer wall without
 * being re-trimmed on the way.
 */
export const WALL_SHARE_MAX = 320;

/** One honest answer is enough to seal — this is not a five-paragraph exam. */
export const EXAMEN_MIN_TO_SEAL = 1;


function isExamenStepId(value: unknown): value is ExamenStepId {
  return (
    typeof value === "string" &&
    (EXAMEN_STEP_IDS as readonly string[]).includes(value)
  );
}

export function examenStepById(id: ExamenStepId): ExamenStep {
  const found = EXAMEN_STEPS.find((step) => step.id === id);
  return found ?? EXAMEN_STEPS[0];
}

/** The next step, or `null` on the last one — the rail never wraps. */
export function nextExamenStepId(id: ExamenStepId): ExamenStepId | null {
  const index = EXAMEN_STEP_IDS.indexOf(id);
  if (index < 0 || index >= EXAMEN_STEP_IDS.length - 1) return null;
  return EXAMEN_STEP_IDS[index + 1];
}

/** The previous step, or `null` on the first one. */
export function previousExamenStepId(id: ExamenStepId): ExamenStepId | null {
  const index = EXAMEN_STEP_IDS.indexOf(id);
  if (index <= 0) return null;
  return EXAMEN_STEP_IDS[index - 1];
}

/** `stepId` when usable, otherwise the first step — the draft's recovery path. */
export function resolveExamenStepId(value: unknown): ExamenStepId {
  return isExamenStepId(value) ? value : EXAMEN_STEP_IDS[0];
}

export function emptyExamenAnswers(): Record<ExamenStepId, string> {
  return { gratitude: "", review: "", contrition: "", grace: "", release: "" };
}

/** Every value clamped to its step's ceiling; unknown keys dropped. */
export function sanitizeExamenAnswers(
  value: unknown,
): Record<ExamenStepId, string> {
  const answers = emptyExamenAnswers();
  if (!value || typeof value !== "object") return answers;
  const record = value as Record<string, unknown>;
  for (const id of EXAMEN_STEP_IDS) {
    answers[id] = clampJournalText(record[id], EXAMEN_ANSWER_MAX);
  }
  return answers;
}

/** An answer worth keeping: long enough to be an answer. */
export function examenAnswerReady(text: string): boolean {
  return text.trim().length >= EXAMEN_MIN_CHARS;
}

export function examenAnswerCount(
  answers: Partial<Record<ExamenStepId, string>> | null | undefined,
): number {
  let ready = 0;
  for (const id of EXAMEN_STEP_IDS) {
    if (examenAnswerReady(answers?.[id] ?? "")) ready += 1;
  }
  return ready;
}

export interface ExamenProgress {
  answered: number;
  total: number;
  remaining: number;
  /** Every step answered. */
  complete: boolean;
  /** Enough has been written to seal the examen. */
  canSeal: boolean;
  /** Rail copy — guidance, never a gate. */
  label: string;
}

/**
 * Progress across the five steps. `canSeal` deliberately asks for almost
 * nothing (one honest line, or a burden handed over): a rhythm that can only be
 * kept on a good day is not a rhythm, it is a performance.
 */
export function examenProgress(
  answers: Partial<Record<ExamenStepId, string>> | null | undefined,
  burden = "",
): ExamenProgress {
  const total = EXAMEN_STEP_IDS.length;
  const answered = examenAnswerCount(answers);
  const hasBurden = typeof burden === "string" && burden.trim().length > 0;
  const complete = answered === total;
  const canSeal = answered >= EXAMEN_MIN_TO_SEAL || hasBurden;
  return {
    answered,
    total,
    remaining: total - answered,
    complete,
    canSeal,
    label: canSeal
      ? `${answered} of ${total} steps answered${hasBurden ? ", burden handed over" : ""}.`
      : `Write a line wherever it is true — ${total} steps, no minimum.`,
  };
}


// ---------------------------------------------------------------------------
// The private journal — entry and draft shapes
// ---------------------------------------------------------------------------

/** A sealed examen. It never leaves the device unless the wall share is used. */
export interface JournalEntry {
  /** `${dateKey}:${phase}` — one sealed examen per rhythm per altar day. */
  id: string;
  /** The dawn-rolled altar day this belongs to. */
  dateKey: string;
  phase: RhythmPhase;
  answers: Record<ExamenStepId, string>;
  /** The one thing handed over at the end. */
  burden: string;
  createdAt: string;
  /** True once the visitor carried the burden to the public wall. */
  sharedToWall: boolean;
}

/** The autosaved work-in-progress, so a reload cannot lose the day. */
export interface JournalDraft {
  dateKey: string;
  phase: RhythmPhase;
  /** The step the cursor was on — recovery resumes exactly where they stopped. */
  stepId: ExamenStepId;
  answers: Record<ExamenStepId, string>;
  burden: string;
  updatedAt: string;
}

/** One sealed examen per rhythm per altar day, so the id is derivable. */
export function journalEntryId(dateKey: string, phase: RhythmPhase): string {
  if (!isDateKey(dateKey)) return "";
  return `${dateKey}:${phase}`;
}

/** Text anywhere in the entry — an empty entry is never stored. */
export function journalEntryHasText(entry: JournalEntry): boolean {
  return examenAnswerCount(entry.answers) > 0 || entry.burden.trim() !== "";
}

/** A stored entry, or `null` when the row cannot be trusted. */
export function sanitizeJournalEntry(raw: unknown): JournalEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (!isDateKey(record.dateKey)) return null;

  const phase = isRhythmPhase(record.phase) ? record.phase : null;
  if (phase === null) return null;

  const answers = sanitizeExamenAnswers(record.answers);
  const burden = clampJournalText(record.burden, JOURNAL_BURDEN_MAX);
  const entry: JournalEntry = {
    id: journalEntryId(record.dateKey, phase),
    dateKey: record.dateKey,
    phase,
    answers,
    burden,
    createdAt: normalizeIso(record.createdAt),
    sharedToWall: record.sharedToWall === true,
  };
  return journalEntryHasText(entry) ? entry : null;
}

/** A stored draft, or `null` when it cannot be trusted or holds nothing. */
export function sanitizeJournalDraft(raw: unknown): JournalDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (!isDateKey(record.dateKey)) return null;

  const phase = isRhythmPhase(record.phase) ? record.phase : null;
  if (phase === null) return null;

  const answers = sanitizeExamenAnswers(record.answers);
  const burden = clampJournalText(record.burden, JOURNAL_BURDEN_MAX);
  if (examenAnswerCount(answers) === 0 && burden.trim() === "") return null;

  return {
    dateKey: record.dateKey,
    phase,
    stepId: resolveExamenStepId(record.stepId),
    answers,
    burden,
    updatedAt: normalizeIso(record.updatedAt),
  };
}


export interface ExamenSealInput {
  dateKey: string;
  phase: RhythmPhase;
  answers: Record<ExamenStepId, string>;
  burden: string;
  /** Injectable clock value; `""` lets the store stamp it on write. */
  createdAt?: string;
  /** Carried to the wall already (the share normally happens after sealing). */
  sharedToWall?: boolean;
}

/**
 * Turns the draft into a sealed entry. Returns `null` when nothing was written,
 * which is the only way a seal is refused — an empty altar is still an honest
 * answer, the store simply has nothing to keep.
 */
export function sealExamen(input: ExamenSealInput): JournalEntry | null {
  const dateKey = isDateKey(input.dateKey) ? input.dateKey : "";
  if (dateKey === "" || !isRhythmPhase(input.phase)) return null;

  const entry: JournalEntry = {
    id: journalEntryId(dateKey, input.phase),
    dateKey,
    phase: input.phase,
    answers: sanitizeExamenAnswers(input.answers),
    burden: clampJournalText(input.burden, JOURNAL_BURDEN_MAX),
    createdAt: normalizeIso(input.createdAt),
    sharedToWall: input.sharedToWall === true,
  };
  return journalEntryHasText(entry) ? entry : null;
}

/** Ceiling for the text mirrored into the cloud-synced `evening_journal`. */
export const CLOUD_NOTE_MAX = 2000;

/**
 * The longhand note the Altar OS cloud layer keeps (`altar_completions.
 * evening_journal`). The private journal is the record of truth; this mirror
 * exists so a signed-in believer's account still shows what the day said, and
 * so the guest and cloud paths never disagree out loud.
 */
export function composeExamenNote(entry: JournalEntry): string {
  const lines: string[] = [];
  for (const step of EXAMEN_STEPS) {
    const text = entry.answers[step.id];
    if (text.trim() !== "") lines.push(`${step.label}: ${text}`);
  }
  if (entry.burden.trim() !== "") lines.push(`Burden: ${entry.burden}`);
  return clampJournalText(lines.join("\n\n"), CLOUD_NOTE_MAX);
}

/** The minimum the prayer wall asks of a quick share (`DROP_IN_BODY_MIN`). */
export const WALL_SHARE_MIN = 8;

/**
 * The burden, ready to hand to the intercession wall — or `""` when it is too
 * short to pray on. Privacy screening is deliberately *not* duplicated here:
 * the share runs through `sanitizeDropInDraft`, the same screen every other
 * share passes, so the two paths can never drift apart.
 */
export function shareableBurden(entry: JournalEntry): string {
  const burden = clampJournalText(entry.burden, WALL_SHARE_MAX);
  return burden.length >= WALL_SHARE_MIN ? burden : "";
}

/** One-line summary for the "recent altars" list. */
export function journalEntrySummary(entry: JournalEntry): string {
  const answered = examenAnswerCount(entry.answers);
  const parts = [`${answered} of ${EXAMEN_STEP_IDS.length} steps answered`];
  if (entry.burden.trim() !== "") {
    parts.push(entry.sharedToWall ? "burden shared" : "burden handed over");
  }
  return parts.join(" · ");
}

/** A draft left behind on an earlier altar day — offered, never assumed. */
export function draftIsStale(draft: JournalDraft, todayKey: string): boolean {
  if (!isDateKey(todayKey)) return false;
  return draft.dateKey < todayKey;
}
