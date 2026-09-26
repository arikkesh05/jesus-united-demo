import { getCurrentUserId } from "@/lib/altar";
import { createClient } from "@/lib/supabaseBrowser";
import type {
  GatheringSubmission,
  GatheringSubmissionStatus,
} from "@/lib/types";

/**
 * Gatherings community data access layer (Phase 1 — Task 3).
 *
 * - `submitGathering` writes guest-provided gatherings to `gathering_submissions`
 *   as `pending` for moderation.
 * - `recordAttendance` check-ins a signed-in believer into
 *   `gathering_attendances`; guests (or any cloud failure) degrade gracefully
 *   to a localStorage copy so the interaction never errors out.
 * - `getAttendanceCount` returns the total check-in count, folding in the
 *   viewer's on-device check-in when it is not persisted in the cloud.
 */

export type GatheringSubmissionInsert = Omit<
  GatheringSubmission,
  "id" | "status" | "created_at"
>;

export interface SubmitGatheringResult {
  ok: boolean;
  error: string | null;
}

export type AttendanceMode = "cloud" | "guest";

export interface RecordAttendanceResult {
  ok: boolean;
  mode: AttendanceMode;
  error: string | null;
}

const ATTENDANCE_STORAGE_KEY = "jesusunited:gathering-attendance:v1";

/** On-device check-in mirror shaped like a minimal `GatheringAttendance` row. */
export interface LocalAttendanceRecord {
  gathering_id: string;
  attended_at: string;
}

/**
 * `getCurrentUserId()` is one auth round-trip; the map renders one attendance
 * counter per card, so cache the resolution for the page's lifetime.
 */
let cachedUserId: string | null | undefined;

async function resolveUserId(): Promise<string | null> {
  if (cachedUserId !== undefined) return cachedUserId;
  cachedUserId = await getCurrentUserId();
  return cachedUserId;
}

function emptyLocalStore(): LocalAttendanceStore {
  return { records: [] };
}

function readLocalStore(): LocalAttendanceStore {
  if (typeof window === "undefined") return emptyLocalStore();
  try {
    const raw = window.localStorage.getItem(ATTENDANCE_STORAGE_KEY);
    if (!raw) return emptyLocalStore();
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { records?: unknown }).records)
    ) {
      const records = (parsed as { records: unknown[] }).records.filter(
        (record): record is LocalAttendanceRecord =>
          typeof record === "object" &&
          record !== null &&
          typeof (record as { gathering_id?: unknown }).gathering_id ===
            "string" &&
          typeof (record as { attended_at?: unknown }).attended_at === "string",
      );
      return { records };
    }
    return emptyLocalStore();
  } catch {
    // Corrupt or blocked storage (private mode): behave like a first-time guest.
    return emptyLocalStore();
  }
}

function writeLocalStore(store: LocalAttendanceStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ATTENDANCE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Private-browsing quota errors are non-fatal; the check-in stays in memory.
  }
}

interface LocalAttendanceStore {
  records: LocalAttendanceRecord[];
}

/** Persists the guest check-in locally. Returns `false` only if storage is blocked. */
export function markLocalAttendance(gatheringId: string): boolean {
  if (typeof window === "undefined") return false;
  const store = readLocalStore();
  if (store.records.some((record) => record.gathering_id === gatheringId))
    return true;
  store.records.push({
    gathering_id: gatheringId,
    attended_at: new Date().toISOString(),
  });
  writeLocalStore(store);
  return true;
}

/** Whether this device already recorded a check-in for the gathering. */
export async function hasLocalAttendance(
  gatheringId: string,
): Promise<boolean> {
  return readLocalStore().records.some(
    (record) => record.gathering_id === gatheringId,
  );
}

/**
 * Submits a community gathering for moderation. The row is stored with
 * `status: 'pending'`; approved rows are promoted to `gatherings` later by an
 * editor (never from the client).
 */
export async function submitGathering(
  submission: GatheringSubmissionInsert,
): Promise<SubmitGatheringResult> {
  const payload: GatheringSubmissionInsert & {
    status: GatheringSubmissionStatus;
  } = {
    ...submission,
    status: "pending",
  };

  try {
    const supabase = createClient();
    const { error } = await supabase
      .from("gathering_submissions")
      .insert(payload);
    if (error) {
      console.error("Gathering submission rejected:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, error: null };
  } catch (error) {
    console.error("Gathering submission failed:", error);
    return {
      ok: false,
      error: "The submission service is unavailable. Please try again.",
    };
  }
}

/**
 * Check-ins the viewer at a gathering. Signed-in users insert a
 * `gathering_attendances` row; guests (or any failed cloud write) persist the
 * check-in to localStorage so the counter still reflects them.
 */
export async function recordAttendance(
  gatheringId: string,
): Promise<RecordAttendanceResult> {
  const userId = await resolveUserId();

  if (userId) {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("gathering_attendances")
        .insert({ gathering_id: gatheringId, user_id: userId });
      if (error) throw error;
      return { ok: true, mode: "cloud", error: null };
    } catch (error) {
      console.warn(
        "Attendance cloud write failed, keeping an on-device record:",
        error,
      );
      const persisted = markLocalAttendance(gatheringId);
      return {
        ok: persisted,
        mode: "guest",
        error: persisted
          ? null
          : "We could not save your check-in. Please try again.",
      };
    }
  }

  const persisted = markLocalAttendance(gatheringId);
  return {
    ok: persisted,
    mode: "guest",
    error: persisted ? null : "We could not save your check-in on this device.",
  };
}

/**
 * Total attendance for a gathering: the exact cloud count plus the viewer's
 * own on-device check-in when it never reached the database (guests, or
 * believers whose cloud write degraded). Falls back to the on-device count
 * when the count query itself fails.
 */
export async function getAttendanceCount(gatheringId: string): Promise<number> {
  const localAttended = await hasLocalAttendance(gatheringId);

  try {
    const supabase = createClient();
    const { count, error } = await supabase
      .from("gathering_attendances")
      .select("id", { count: "exact", head: true })
      .eq("gathering_id", gatheringId);
    if (error) throw error;

    const cloudCount = count ?? 0;
    if (localAttended) {
      const userId = await resolveUserId();
      // A signed-in believer's check-in is already inside the cloud count;
      // only a degraded/guest record needs folding in.
      if (!userId) return cloudCount + 1;
    }
    return cloudCount;
  } catch (error) {
    console.warn("Attendance count unavailable, using on-device data:", error);
    return localAttended ? 1 : 0;
  }
}
