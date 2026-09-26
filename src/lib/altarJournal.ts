import {
  JOURNAL_BURDEN_MAX,
  clampJournalText,
  isDateKey,
  rhythmStreak,
  sanitizeExamenAnswers,
  sanitizeJournalDraft,
  sanitizeJournalEntry,
  type ExamenStepId,
  type JournalDraft,
  type JournalEntry,
  type RhythmPhase,
  type RhythmStreak,
} from "@/lib/altarRhythms";

/**
 * The private journal store (`src/lib/altarJournal.ts`).
 *
 * The Examen is the one place on this site where a visitor says something they
 * have not said out loud, so its storage has one rule above every other: **it
 * stays on the device.** There is no cloud write here, no sync, and no
 * anonymous upload — `localStorage` under a single versioned key, exactly like
 * the Grace-Based Habit Engine's guest-first mirror. The only way a journal
 * leaves the device is a deliberate act in the UI: carrying the *burden* (one
 * short line) to the public prayer wall through the same privacy screen every
 * other share passes.
 *
 * Everything that comes back off disk is re-sanitised by `altarRhythms`, so a
 * corrupted key, a half-written row or a stale schema version degrades to "no
 * journal yet" rather than to a render error. Reads are SSR-safe (`window` is
 * never touched on the server) and writes are non-fatal: a private-mode quota
 * error costs the autosave, never the writing.
 */

export const ALTAR_JOURNAL_STORAGE_KEY = "jesusunited:altar-journal:v1";

/** Bump when the persisted shape changes; older payloads are discarded. */
export const ALTAR_JOURNAL_VERSION = 1;

/** ~8 months of one-entry-a-day, newest kept. */
export const JOURNAL_ENTRY_CAP = 240;

/** Unfinished drafts kept for recovery; older ones fall away. */
export const JOURNAL_DRAFT_CAP = 8;

export interface AltarJournalStore {
  version: number;
  /** Sealed altars, newest first. */
  entries: JournalEntry[];
  /** Unfinished work-in-progress, newest first. */
  drafts: JournalDraft[];
}

export function emptyAltarJournal(): AltarJournalStore {
  return { version: ALTAR_JOURNAL_VERSION, entries: [], drafts: [] };
}

function draftId(dateKey: string, phase: RhythmPhase): string {
  return `${dateKey}:${phase}`;
}

function entryOrder(a: JournalEntry, b: JournalEntry): number {
  if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return 0;
}

/** Drops duplicates, junk rows and anything past the cap, newest first. */
function normaliseEntries(rows: unknown): JournalEntry[] {
  if (!Array.isArray(rows)) return [];
  const byId = new Map<string, JournalEntry>();
  for (const row of rows) {
    const entry = sanitizeJournalEntry(row);
    if (entry === null || byId.has(entry.id)) continue;
    byId.set(entry.id, entry);
  }
  return [...byId.values()].sort(entryOrder).slice(0, JOURNAL_ENTRY_CAP);
}

/** Drops duplicates, empty drafts and anything past the cap, newest first. */
function normaliseDrafts(rows: unknown): JournalDraft[] {
  if (!Array.isArray(rows)) return [];
  const byId = new Map<string, JournalDraft>();
  for (const row of rows) {
    const draft = sanitizeJournalDraft(row);
    if (draft === null) continue;
    const id = draftId(draft.dateKey, draft.phase);
    if (byId.has(id)) continue;
    byId.set(id, draft);
  }
  return [...byId.values()]
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0))
    .slice(0, JOURNAL_DRAFT_CAP);
}

/**
 * The whole journal, or an empty one. Never throws: an unparsable payload, a
 * version this build does not understand, or a missing `window` all mean "no
 * journal yet".
 */
export function readAltarJournal(): AltarJournalStore {
  if (typeof window === "undefined") return emptyAltarJournal();
  try {
    const raw = window.localStorage.getItem(ALTAR_JOURNAL_STORAGE_KEY);
    if (!raw) return emptyAltarJournal();

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyAltarJournal();
    const record = parsed as { version?: unknown; entries?: unknown; drafts?: unknown };
    if (record.version !== ALTAR_JOURNAL_VERSION) return emptyAltarJournal();

    return {
      version: ALTAR_JOURNAL_VERSION,
      entries: normaliseEntries(record.entries),
      drafts: normaliseDrafts(record.drafts),
    };
  } catch (error) {
    console.warn("Private journal: unreadable on this device, starting clean:", error);
    return emptyAltarJournal();
  }
}

/** Non-fatal write — `false` means the quota is gone, the writing is not. */
export function writeAltarJournal(store: AltarJournalStore): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      ALTAR_JOURNAL_STORAGE_KEY,
      JSON.stringify({
        version: ALTAR_JOURNAL_VERSION,
        entries: store.entries,
        drafts: store.drafts,
      }),
    );
    return true;
  } catch (error) {
    // Private browsing and full quotas both land here. The visitor keeps typing;
    // only the autosave promise is downgraded.
    console.warn("Private journal: could not save on this device:", error);
    return false;
  }
}


// ---------------------------------------------------------------------------
// Drafts — the autosave that makes a half-written day survive a reload
// ---------------------------------------------------------------------------

export interface JournalDraftInput {
  dateKey: string;
  phase: RhythmPhase;
  /** The step the cursor is on, so recovery resumes exactly where it stopped. */
  stepId: ExamenStepId;
  answers: Partial<Record<ExamenStepId, string>>;
  burden: string;
  /** Injectable timestamp; `""` stamps now at save time. */
  updatedAt?: string;
}

/** The unfinished draft for one rhythm on one altar day, or `null`. */
export function loadJournalDraft(
  dateKey: string,
  phase: RhythmPhase,
): JournalDraft | null {
  if (!isDateKey(dateKey)) return null;
  const found = readAltarJournal().drafts.find(
    (draft) => draft.dateKey === dateKey && draft.phase === phase,
  );
  return found ?? null;
}

/**
 * Upserts a draft and returns the stored shape, or `null` when the draft held
 * nothing to keep (every answer blank) or the device refused the write. The
 * caller keeps its own in-memory copy either way — losing the autosave must
 * never interrupt the writing.
 */
export function saveJournalDraft(input: JournalDraftInput): JournalDraft | null {
  const draft = sanitizeJournalDraft({
    dateKey: input.dateKey,
    phase: input.phase,
    stepId: input.stepId,
    answers: sanitizeExamenAnswers(input.answers),
    burden: clampJournalText(input.burden, JOURNAL_BURDEN_MAX),
    updatedAt:
      input.updatedAt === undefined || input.updatedAt === ""
        ? new Date().toISOString()
        : input.updatedAt,
  });
  if (draft === null) return null;

  const store = readAltarJournal();
  const id = draftId(draft.dateKey, draft.phase);
  // Newest *day* wins the cap, not newest write: saving an old day's draft must
  // never push today's unfinished examen off the end.
  store.drafts = [
    draft,
    ...store.drafts.filter((row) => draftId(row.dateKey, row.phase) !== id),
  ]
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0))
    .slice(0, JOURNAL_DRAFT_CAP);
  if (!writeAltarJournal(store)) return null;
  return draft;
}

/** Forgets one unfinished draft. Called when the examen is sealed. */
export function clearJournalDraft(dateKey: string, phase: RhythmPhase): boolean {
  if (!isDateKey(dateKey)) return false;
  const store = readAltarJournal();
  const id = draftId(dateKey, phase);
  const before = store.drafts.length;
  store.drafts = store.drafts.filter(
    (draft) => draftId(draft.dateKey, draft.phase) !== id,
  );
  if (store.drafts.length === before) return false;
  return writeAltarJournal(store);
}

/** Drafts left behind on an earlier altar day — offered back, never assumed. */
export function staleJournalDrafts(todayKey: string): JournalDraft[] {
  if (!isDateKey(todayKey)) return [];
  return readAltarJournal().drafts.filter((draft) => draft.dateKey < todayKey);
}

// ---------------------------------------------------------------------------
// Entries — sealed altars
// ---------------------------------------------------------------------------

/**
 * Seals an examen. Re-sealing the same rhythm on the same altar day replaces
 * the earlier entry (one altar per rhythm per day, by design) and retires that
 * day's draft, so the autosave can never resurrect sealed work.
 */
export function appendJournalEntry(entry: JournalEntry): AltarJournalStore {
  const store = readAltarJournal();
  const sealed: JournalEntry = {
    ...entry,
    createdAt:
      entry.createdAt === "" ? new Date().toISOString() : entry.createdAt,
  };
  store.entries = [
    sealed,
    ...store.entries.filter((row) => row.id !== sealed.id),
  ]
    .sort(entryOrder)
    .slice(0, JOURNAL_ENTRY_CAP);
  store.drafts = store.drafts.filter(
    (draft) => draftId(draft.dateKey, draft.phase) !== sealed.id,
  );
  writeAltarJournal(store);
  return store;
}

/** Records that the burden went to the public wall (or never did). */
export function markJournalEntryShared(
  dateKey: string,
  phase: RhythmPhase,
  shared: boolean,
): AltarJournalStore {
  const store = readAltarJournal();
  const id = draftId(dateKey, phase);
  store.entries = store.entries.map((entry) =>
    entry.id === id ? { ...entry, sharedToWall: shared } : entry,
  );
  writeAltarJournal(store);
  return store;
}

/** The sealed altar for one rhythm on one day, or `null`. */
export function sealedExamenFor(
  dateKey: string,
  phase: RhythmPhase,
): JournalEntry | null {
  if (!isDateKey(dateKey)) return null;
  const id = draftId(dateKey, phase);
  return readAltarJournal().entries.find((entry) => entry.id === id) ?? null;
}

export function journalEntries(): JournalEntry[] {
  return readAltarJournal().entries;
}

export function entriesForDay(dateKey: string): JournalEntry[] {
  if (!isDateKey(dateKey)) return [];
  return readAltarJournal().entries.filter((entry) => entry.dateKey === dateKey);
}

/** Every altar day with a sealed entry, newest first — the streak's input. */
export function journalDayKeys(): string[] {
  const keys = new Set<string>();
  for (const entry of readAltarJournal().entries) keys.add(entry.dateKey);
  return [...keys].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/**
 * The rhythm count for the private journal: `rhythmStreak` over the sealed
 * days, with the caller's Grace-Season test injected so the journal and the
 * habit compass can never disagree about what a resting day is.
 */
export function journalStreak(
  todayKey: string,
  isResting?: (dateKey: string) => boolean,
): RhythmStreak {
  return rhythmStreak({ keptKeys: journalDayKeys(), todayKey, isResting });
}

/**
 * Removes every journal entry and draft from this device. The private journal
 * has no cloud copy to delete, so this is the whole erasure — which is also
 * why the UI offers it without ceremony.
 */
export function clearAltarJournal(): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(ALTAR_JOURNAL_STORAGE_KEY);
    return true;
  } catch (error) {
    console.warn("Private journal: could not clear on this device:", error);
    return false;
  }
}
