import { createClient } from "@/lib/supabaseBrowser";
import type { AltarCompletion, HabitEntry } from "@/lib/types";

/**
 * Altar OS v1 data access layer.
 *
 * Cloud mode persists to the Phase 1 tables (`altar_completions`, `habits`)
 * keyed by (user_id, date) upserts. Guest mode mirrors the exact same day
 * state into localStorage so unauthenticated visitors get the full
 * interactive experience with zero errors. Every cloud failure transparently
 * degrades to the on-device copy.
 */

export interface HabitMinutes {
  prayer: number;
  scripture: number;
  worship: number;
  service: number;
}

export interface AltarDayState {
  morningCompleted: boolean;
  eveningCompleted: boolean;
  eveningJournal: string;
  habits: HabitMinutes;
}

export type AltarPersistMode = "cloud" | "guest";

export interface AltarPersistResult {
  ok: boolean;
  mode: AltarPersistMode;
}

export const EMPTY_HABITS: HabitMinutes = {
  prayer: 0,
  scripture: 0,
  worship: 0,
  service: 0,
};

export const EMPTY_ALTAR_DAY: AltarDayState = {
  morningCompleted: false,
  eveningCompleted: false,
  eveningJournal: "",
  habits: { ...EMPTY_HABITS },
};

export const HABIT_STEP = 5;
export const HABIT_MAX = 600;

const STORAGE_KEY = "jesusunited:altar-os:v1";

/** Today's local date as `YYYY-MM-DD` (client-side only; do not SSR this). */
export function todayLocalDate(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Keeps habit counters within 0..HABIT_MAX on whole-minute boundaries. */
export function clampHabitMinutes(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(HABIT_MAX, Math.max(0, Math.round(value)));
}

function emptyDay(): AltarDayState {
  return { ...EMPTY_ALTAR_DAY, habits: { ...EMPTY_HABITS } };
}

function readLocalStore(): Record<string, AltarDayState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "days" in parsed) {
      const days = (parsed as { days?: Record<string, AltarDayState> }).days;
      return days && typeof days === "object" ? days : {};
    }
    return {};
  } catch {
    // Corrupt or blocked storage: behave like a first-time guest.
    return {};
  }
}

function writeLocalDay(date: string, state: AltarDayState): void {
  if (typeof window === "undefined") return;
  try {
    const days = readLocalStore();
    days[date] = state;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ days }));
  } catch {
    // Private-browsing quota errors are non-fatal; state stays in memory.
  }
}

/** Resolves the signed-in user id, or `null` for the graceful guest path. */
export async function getCurrentUserId(): Promise<string | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Loads today's altar state. Signed-in users read `altar_completions` +
 * `habits`; guests (or readers hitting a DB error) fall back to the
 * on-device copy so the UI is never empty or broken.
 */
export async function loadAltarDay(
  date: string,
): Promise<{
  state: AltarDayState;
  mode: AltarPersistMode;
  userId: string | null;
}> {
  const userId = await getCurrentUserId();

  if (!userId) {
    return {
      state: readLocalStore()[date] ?? emptyDay(),
      mode: "guest",
      userId: null,
    };
  }

  try {
    const supabase = createClient();
    const [altarResult, habitsResult] = await Promise.all([
      supabase
        .from("altar_completions")
        .select("morning_completed, evening_completed, evening_journal")
        .eq("user_id", userId)
        .eq("date", date)
        .maybeSingle(),
      supabase
        .from("habits")
        .select(
          "prayer_minutes, bible_reading_minutes, worship_minutes, service_minutes",
        )
        .eq("user_id", userId)
        .eq("date", date)
        .maybeSingle(),
    ]);

    if (altarResult.error) throw altarResult.error;
    if (habitsResult.error) throw habitsResult.error;

    const altar = (altarResult.data ?? null) as Pick<
      AltarCompletion,
      "morning_completed" | "evening_completed" | "evening_journal"
    > | null;
    const habits = (habitsResult.data ?? null) as Pick<
      HabitEntry,
      | "prayer_minutes"
      | "bible_reading_minutes"
      | "worship_minutes"
      | "service_minutes"
    > | null;

    const state: AltarDayState = {
      morningCompleted: altar?.morning_completed ?? false,
      eveningCompleted: altar?.evening_completed ?? false,
      eveningJournal: altar?.evening_journal ?? "",
      habits: {
        prayer: habits?.prayer_minutes ?? 0,
        scripture: habits?.bible_reading_minutes ?? 0,
        worship: habits?.worship_minutes ?? 0,
        service: habits?.service_minutes ?? 0,
      },
    };

    return { state, mode: "cloud", userId };
  } catch (error) {
    console.warn("Altar OS: cloud read failed, using on-device state:", error);
    return {
      state: readLocalStore()[date] ?? emptyDay(),
      mode: "cloud",
      userId,
    };
  }
}

/**
 * Persists the whole day. Guests write straight to localStorage; signed-in
 * users upsert both rows on the (user_id, date) conflict target. A failed
 * cloud write always leaves a localStorage backup behind so nothing is lost.
 */
export async function persistAltarDay(
  date: string,
  state: AltarDayState,
  userId: string | null,
): Promise<AltarPersistResult> {
  if (!userId) {
    writeLocalDay(date, state);
    return { ok: true, mode: "guest" };
  }

  try {
    const supabase = createClient();
    const altarRow = {
      user_id: userId,
      date,
      morning_completed: state.morningCompleted,
      evening_completed: state.eveningCompleted,
      evening_journal: state.eveningJournal,
    };
    const habitsRow = {
      user_id: userId,
      date,
      prayer_minutes: clampHabitMinutes(state.habits.prayer),
      bible_reading_minutes: clampHabitMinutes(state.habits.scripture),
      worship_minutes: clampHabitMinutes(state.habits.worship),
      service_minutes: clampHabitMinutes(state.habits.service),
    };

    const [altarResult, habitsResult] = await Promise.all([
      supabase
        .from("altar_completions")
        .upsert(altarRow, { onConflict: "user_id,date" }),
      supabase.from("habits").upsert(habitsRow, { onConflict: "user_id,date" }),
    ]);

    if (altarResult.error) throw altarResult.error;
    if (habitsResult.error) throw habitsResult.error;

    return { ok: true, mode: "cloud" };
  } catch (error) {
    console.warn("Altar OS: cloud save failed, keeping local backup:", error);
    writeLocalDay(date, state);
    return { ok: false, mode: "cloud" };
  }
}
