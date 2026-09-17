import { createClient } from '@/lib/supabaseBrowser';
import type { ModerateGatheringArgs, PrayerVisibilityUpdate } from '@/lib/types';
import type { GatheringSubmission, PrayerRequest } from '@/lib/types';

/**
 * Admin Moderation Deck data layer (Phase 2 — Task 2).
 *
 * Editor-only moderation surface over the community tables:
 *
 * - `getPendingGatherings()` reads `gathering_submissions` rows whose status is
 *   `pending`, newest first, for the review queue.
 * - `moderateGathering(id, 'approve')` promotes the verified `gathering_data`
 *   jsonb into `gatherings` (the public map) and marks the submission
 *   `approved`; `moderateGathering(id, 'reject')` only marks it `rejected`.
 * - `getModeratedPrayers()` reads recent `prayer_requests` for oversight;
 *   `setPrayerVisibility()` toggles `is_public` and `deletePrayerRequest()`
 *   removes spam outright.
 *
 * Reads reject with a safe error so the UI can distinguish failures from empty
 * queues. Writes return `{ ok: false, error }` for denied or failed operations.
 * No service-role credentials or user-editable role metadata are used.
 */

export type ModerateGatheringAction = 'approve' | 'reject';

export interface ModerationResult {
  ok: boolean;
  error: string | null;
}

export async function getModerationAccess(): Promise<boolean> {
  try {
    const { data, error } = await createClient().rpc('can_moderate');
    return !error && data === true;
  } catch {
    return false;
  }
}

async function requireModerator() {
  const client = createClient();
  const { data, error } = await client.rpc('can_moderate');
  if (error || data !== true) throw new Error('Moderator access required');
  return client;
}


// ---------------------------------------------------------------------------
// Gathering review queue
// ---------------------------------------------------------------------------

/**
 * Normalises a raw `gathering_submissions` row. The `gathering_data` jsonb is
 * parsed defensively so a malformed payload can never crash the admin deck.
 */
function parseSubmissionRow(raw: unknown): GatheringSubmission | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const id = typeof record.id === 'string' ? record.id : '';
  if (id === '') return null;

  const data =
    typeof record.gathering_data === 'object' && record.gathering_data !== null
      ? (record.gathering_data as Record<string, unknown>)
      : {};

  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  const nullableText = (value: unknown): string | null => {
    const parsed = text(value);
    return parsed === '' ? null : parsed;
  };
  const coordinate = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

  return {
    id,
    submitter_name: text(record.submitter_name),
    submitter_email: text(record.submitter_email),
    gathering_data: {
      name: text(data.name),
      meeting_time: text(data.meeting_time),
      address: text(data.address),
      leader_name: text(data.leader_name),
      description: nullableText(data.description),
      contact_email: nullableText(data.contact_email),
      latitude: coordinate(data.latitude),
      longitude: coordinate(data.longitude),
    },
    status:
      record.status === 'approved' || record.status === 'rejected' ? record.status : 'pending',
    created_at: text(record.created_at),
  };
}

/** Pending submissions, newest first. Rejects on unavailable or denied reads. */
export async function getPendingGatherings(): Promise<GatheringSubmission[]> {
  try {
    const supabase = await requireModerator();
    const { data, error } = await supabase
      .from('gathering_submissions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!Array.isArray(data)) return [];

    const submissions: GatheringSubmission[] = [];
    for (const row of data as unknown[]) {
      const submission = parseSubmissionRow(row);
      if (submission) submissions.push(submission);
    }
    return submissions;
  } catch {
    throw new Error('Pending gatherings could not be loaded.');
  }
}

/**
 * Approve promotes the canonical submission and changes its status in one
 * database transaction. Row locking prevents duplicate publication. Reject
 * changes only status. The database validates authorization and coordinates.
 */
export async function moderateGathering(
  submissionId: string,
  action: ModerateGatheringAction
): Promise<ModerationResult> {
  try {
    if (action !== 'approve' && action !== 'reject') throw new Error('Invalid action');
    const supabase = await requireModerator();
    const args: ModerateGatheringArgs = { p_submission_id: submissionId, p_action: action };
    const { data, error } = await supabase.rpc('moderate_gathering', args);
    if (error || data !== true) throw new Error('Moderation failed or submission already reviewed');

    return { ok: true, error: null };
  } catch {
    return {
      ok: false,
      error: 'The moderation action could not be completed. Please try again.',
    };
  }
}

// ---------------------------------------------------------------------------
// Prayer oversight
// ---------------------------------------------------------------------------

/** Oversight cap — the deck reviews the most recent prayer requests only. */
const PRAYER_OVERSIGHT_LIMIT = 50;

/**
 * Recent prayer requests (any visibility, newest first) for moderator review.
 * The public wall only reads `is_public = true`; this read intentionally does
 * NOT filter so hidden/flagged rows stay visible to oversight. Rejects on
 * unavailable or denied reads rather than presenting a false empty state.
 */
export async function getModeratedPrayers(): Promise<PrayerRequest[]> {
  try {
    const supabase = await requireModerator();
    const { data, error } = await supabase
      .from('prayer_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(PRAYER_OVERSIGHT_LIMIT);

    if (error) throw error;
    if (!Array.isArray(data)) return [];

    const prayers: PrayerRequest[] = [];
    for (const row of data as unknown[]) {
      const prayer = parsePrayerModerationRow(row);
      if (prayer) prayers.push(prayer);
    }
    return prayers;
  } catch {
    throw new Error('Prayer oversight could not be loaded.');
  }
}

function parsePrayerModerationRow(raw: unknown): PrayerRequest | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const id = typeof record.id === 'string' ? record.id : '';
  if (id === '') return null;

  return {
    id,
    user_id: typeof record.user_id === 'string' ? record.user_id : '',
    author_name: typeof record.author_name === 'string' ? record.author_name : '',
    title: typeof record.title === 'string' ? record.title : '',
    body: typeof record.body === 'string' ? record.body : '',
    topics: Array.isArray(record.topics)
      ? record.topics.filter((topic): topic is string => typeof topic === 'string')
      : [],
    is_public: record.is_public !== false,
    is_answered: record.is_answered === true,
    answered_note: typeof record.answered_note === 'string' ? record.answered_note : null,
    intercession_count:
      typeof record.intercession_count === 'number' && Number.isFinite(record.intercession_count)
        ? record.intercession_count
        : 0,
    created_at: typeof record.created_at === 'string' ? record.created_at : '',
  };
}

/**
 * Toggles a prayer request's wall visibility (`is_public`). Hidden prayers
 * stay in the database (recoverable) but disappear from the public wall.
 */
export async function setPrayerVisibility(
  requestId: string,
  isPublic: boolean
): Promise<ModerationResult> {
  try {
    const supabase = await requireModerator();
    const payload: PrayerVisibilityUpdate = { is_public: isPublic };
    const { data, error } = await supabase
      .from('prayer_requests')
      .update(payload)
      .eq('id', requestId)
      .select('id');
    if (error || !Array.isArray(data) || data.length !== 1) throw new Error('Prayer not updated');
    return { ok: true, error: null };
  } catch {
    return {
      ok: false,
      error: 'The visibility change could not be saved. Please try again.',
    };
  }
}

/** Removes a prayer request outright (spam / abuse cleanup). */
export async function deletePrayerRequest(requestId: string): Promise<ModerationResult> {
  try {
    const supabase = await requireModerator();
    const { data, error } = await supabase.from('prayer_requests').delete().eq('id', requestId).select('id');
    if (error || !Array.isArray(data) || data.length !== 1) throw new Error('Prayer not removed');
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: 'The prayer could not be removed. Please try again.' };
  }
}
