import { getCurrentUserId } from '@/lib/altar';
import { createClient } from '@/lib/supabaseBrowser';
import type { PrayerRequest } from '@/lib/types';

/**
 * Prayer Network v1 data access layer (Phase 1 — Task 4).
 *
 * - `getPrayerRequests` fetches the latest public prayers (`created_at desc`),
 *   optionally narrowed by topic / answered state, and degrades to a bundled
 *   set of Scripture-grounded demo prayers when the table is empty or the
 *   cloud read fails — the wall is never blank.
 * - `submitPrayerRequest` inserts into `prayer_requests`; guests resolve to a
 *   `null` `user_id` (the DB column is nullable for anonymous submissions).
 * - `recordIntercession` inserts into `prayer_intercessions` and increments
 *   `intercession_count`. Guests (or any failed cloud write) degrade
 *   gracefully to localStorage (`jesusunited:prayer-intercessions:v1`) so the
 *   "I Prayed" interaction never errors out.
 */

export type PrayerRequestInsert = Omit<
  PrayerRequest,
  'id' | 'created_at' | 'intercession_count'
>;

export interface PrayerFilter {
  topic?: string;
  answeredOnly?: boolean;
}

export interface SubmitPrayerResult {
  ok: boolean;
  error: string | null;
}

export type IntercessionMode = 'cloud' | 'guest';

export interface RecordIntercessionResult {
  ok: boolean;
  mode: IntercessionMode;
  error: string | null;
}

/** Canonical wall topics; the modal selector and filter pills share this list. */
export const PRAYER_TOPICS: readonly string[] = [
  'Healing',
  'Provision',
  'Family',
  'Guidance',
  'Thanksgiving',
  'Salvation',
];

const INTERCESSION_STORAGE_KEY = 'jesusunited:prayer-intercessions:v1';

/** On-device intercession mirror shaped like a minimal `PrayerIntercession` row. */
export interface LocalIntercessionRecord {
  request_id: string;
  prayed_at: string;
}

interface LocalIntercessionStore {
  records: LocalIntercessionRecord[];
}

// ---------------------------------------------------------------------------
// Demo fallback (bundled so the prerendered wall always has content).
// ---------------------------------------------------------------------------

const DEMO_PRAYERS: PrayerRequest[] = [
  {
    id: 'a1000000-0000-4000-8000-000000000001',
    user_id: '00000000-0000-4000-8000-000000000000',
    author_name: 'Miriam A.',
    title: 'Healing for my mother',
    body: 'Please stand with me in prayer for my mother\u2019s recovery after surgery. We are trusting the Lord who \u201Cheals the brokenhearted and binds up their wounds\u201D (Psalm 147:3).',
    topics: ['Healing', 'Family'],
    is_public: true,
    is_answered: false,
    answered_note: null,
    intercession_count: 24,
    created_at: '2026-09-14T08:30:00.000Z',
  },
  {
    id: 'a1000000-0000-4000-8000-000000000002',
    user_id: '00000000-0000-4000-8000-000000000000',
    author_name: 'Anonymous',
    title: 'Work and provision',
    body: 'I have been out of work for two months. Praying daily with Philippians 4:19 that God would supply every need \u2014 for an open door, for peace while I wait, and for wisdom in the interviews ahead.',
    topics: ['Provision'],
    is_public: true,
    is_answered: false,
    answered_note: null,
    intercession_count: 41,
    created_at: '2026-09-14T06:10:00.000Z',
  },
  {
    id: 'a1000000-0000-4000-8000-000000000003',
    user_id: '00000000-0000-4000-8000-000000000000',
    author_name: 'Daniel O.',
    title: 'Wisdom for a hard decision',
    body: 'Our family is weighing a relocation that would move us far from our church family. Asking for the wisdom God promises to give generously to all who ask (James 1:5).',
    topics: ['Guidance', 'Family'],
    is_public: true,
    is_answered: false,
    answered_note: null,
    intercession_count: 17,
    created_at: '2026-09-13T19:45:00.000Z',
  },
  {
    id: 'a1000000-0000-4000-8000-000000000004',
    user_id: '00000000-0000-4000-8000-000000000000',
    author_name: 'Grace T.',
    title: 'My brother came home',
    body: 'After two years away from the faith, my brother joined us for Sunday worship and prayed to rededicate his life to Christ. \u201CHe who began a good work in you will carry it on to completion\u201D (Philippians 1:6). Thank you for praying!',
    topics: ['Salvation', 'Thanksgiving'],
    is_public: true,
    is_answered: true,
    answered_note:
      'Answered on 2026-09-07 \u2014 he rededicated his life to Christ at the Sunday service.',
    intercession_count: 63,
    created_at: '2026-09-06T09:00:00.000Z',
  },
  {
    id: 'a1000000-0000-4000-8000-000000000005',
    user_id: '00000000-0000-4000-8000-000000000000',
    author_name: 'Samuel K.',
    title: 'Thanksgiving for a new season',
    body: 'Entering this new season with a grateful heart \u2014 \u201CGive thanks in all circumstances; for this is the will of God in Christ Jesus for you\u201D (1 Thessalonians 5:18). Praying the same gratitude over everyone who reads this wall.',
    topics: ['Thanksgiving'],
    is_public: true,
    is_answered: false,
    answered_note: null,
    intercession_count: 12,
    created_at: '2026-09-12T07:20:00.000Z',
  },
];

function filterDemoPrayers(filter: PrayerFilter): PrayerRequest[] {
  return DEMO_PRAYERS.filter((prayer) => {
    if (filter.topic && !prayer.topics.includes(filter.topic)) return false;
    if (filter.answeredOnly && !prayer.is_answered) return false;
    return true;
  });
}

/**
 * Normalises a raw PostgREST row into a `PrayerRequest`. Returns `null` for
 * rows that cannot be used (not an object / missing id) instead of throwing.
 */
function parsePrayerRow(raw: unknown): PrayerRequest | null {
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
 * Latest public prayer requests, newest first. When the table is empty (or the
 * cloud read fails) the bundled demo prayers are returned so the wall always
 * renders. The filter is applied in both paths.
 */
export async function getPrayerRequests(filter: PrayerFilter = {}): Promise<PrayerRequest[]> {
  try {
    const supabase = createClient();
    let query = supabase
      .from('prayer_requests')
      .select('*')
      .eq('is_public', true)
      .order('created_at', { ascending: false });

    if (filter.topic) query = query.contains('topics', [filter.topic]);
    if (filter.answeredOnly) query = query.eq('is_answered', true);

    const { data, error } = await query;
    if (error) throw error;

    if (!Array.isArray(data) || data.length === 0) {
      return filterDemoPrayers(filter);
    }

    const prayers: PrayerRequest[] = [];
    for (const row of data as unknown[]) {
      const prayer = parsePrayerRow(row);
      if (prayer) prayers.push(prayer);
    }
    if (prayers.length === 0) return filterDemoPrayers(filter);
    return prayers;
  } catch (error) {
    console.warn('Prayer wall: cloud read unavailable, showing demo prayers:', error);
    return filterDemoPrayers(filter);
  }
}

/**
 * Shares a prayer on the wall. The signed-in believer's id is resolved here so
 * guests submit with a `null` `user_id` (anonymous submissions stay nullable);
 * a blank `user_id` on the payload is treated as "guest".
 */
export async function submitPrayerRequest(
  prayer: PrayerRequestInsert
): Promise<SubmitPrayerResult> {
  const userId = await getCurrentUserId();
  const resolvedUserId = userId ?? (prayer.user_id.trim() === '' ? null : prayer.user_id.trim());

  const payload: Omit<PrayerRequestInsert, 'user_id'> & { user_id: string | null } = {
    ...prayer,
    user_id: resolvedUserId,
  };

  try {
    const supabase = createClient();
    const { error } = await supabase.from('prayer_requests').insert(payload);
    if (error) {
      console.error('Prayer submission rejected:', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, error: null };
  } catch (error) {
    console.error('Prayer submission failed:', error);
    return { ok: false, error: 'The prayer service is unavailable. Please try again.' };
  }
}

// ---------------------------------------------------------------------------
// Write path — intercessions ("I Prayed")
// ---------------------------------------------------------------------------

function emptyLocalStore(): LocalIntercessionStore {
  return { records: [] };
}

function readLocalStore(): LocalIntercessionStore {
  if (typeof window === 'undefined') return emptyLocalStore();
  try {
    const raw = window.localStorage.getItem(INTERCESSION_STORAGE_KEY);
    if (!raw) return emptyLocalStore();
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { records?: unknown }).records)
    ) {
      const records = (parsed as { records: unknown[] }).records.filter(
        (record): record is LocalIntercessionRecord =>
          typeof record === 'object' &&
          record !== null &&
          typeof (record as { request_id?: unknown }).request_id === 'string' &&
          typeof (record as { prayed_at?: unknown }).prayed_at === 'string'
      );
      return { records };
    }
    return emptyLocalStore();
  } catch {
    // Corrupt or blocked storage (private mode): behave like a first-time guest.
    return emptyLocalStore();
  }
}

function writeLocalStore(store: LocalIntercessionStore): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(INTERCESSION_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Private-browsing quota errors are non-fatal; the intercession stays in memory.
  }
}

function isSameLocalDay(iso: string, day: string): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const dayOfMonth = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${dayOfMonth}` === day;
}

function todayLocalDay(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Persists a guest intercession locally (deduplicated per local day). */
function markLocalIntercession(requestId: string): boolean {
  if (typeof window === 'undefined') return false;
  const store = readLocalStore();
  const today = todayLocalDay();
  const already = store.records.some(
    (record) => record.request_id === requestId && isSameLocalDay(record.prayed_at, today)
  );
  if (!already) {
    store.records.push({ request_id: requestId, prayed_at: new Date().toISOString() });
    writeLocalStore(store);
  }
  return true;
}

/** True when this visitor already interceded for the request today on-device. */
export function hasLocalIntercession(requestId: string): boolean {
  const today = todayLocalDay();
  return readLocalStore().records.some(
    (record) => record.request_id === requestId && isSameLocalDay(record.prayed_at, today)
  );
}

/** Every request id this visitor interceded for today on-device. */
export function getLocalIntercessionIds(): string[] {
  const today = todayLocalDay();
  return readLocalStore()
    .records.filter((record) => isSameLocalDay(record.prayed_at, today))
    .map((record) => record.request_id);
}

/**
 * Increments `intercession_count` on `prayer_requests`. PostgREST cannot
 * express `count = count + 1` without an RPC, so the current value is read
 * first; the bump is best-effort — the intercession row itself is the source
 * of truth for the person having prayed.
 */
async function bumpIntercessionCount(
  supabase: ReturnType<typeof createClient>,
  requestId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('prayer_requests')
      .select('intercession_count')
      .eq('id', requestId)
      .maybeSingle();
    if (error) throw error;

    const currentCount =
      data !== null &&
      typeof (data as { intercession_count?: unknown }).intercession_count === 'number'
        ? (data as { intercession_count: number }).intercession_count
        : 0;

    const { error: updateError } = await supabase
      .from('prayer_requests')
      .update({ intercession_count: currentCount + 1 })
      .eq('id', requestId);
    if (updateError) throw updateError;
    return true;
  } catch (error) {
    console.warn('Prayer wall: intercession count bump failed:', error);
    return false;
  }
}

/**
 * Records "I prayed for this". Signed-in believers insert a
 * `prayer_intercessions` row (unique per request+user+day) and bump the wall
 * counter; guests (or any failed cloud write) persist the intercession to
 * localStorage so the interaction still counts on this device.
 */
export async function recordIntercession(requestId: string): Promise<RecordIntercessionResult> {
  const userId = await getCurrentUserId();

  if (userId) {
    try {
      const supabase = createClient();
      const { error } = await supabase.from('prayer_intercessions').insert({
        request_id: requestId,
        user_id: userId,
      });
      if (error) {
        // Unique violation: this believer already prayed today — count the
        // person, not the error.
        if (error.code !== '23505') throw error;
        return { ok: true, mode: 'cloud', error: null };
      }
      await bumpIntercessionCount(supabase, requestId);
      return { ok: true, mode: 'cloud', error: null };
    } catch (error) {
      console.warn('Intercession cloud write failed, keeping an on-device record:', error);
      const persisted = markLocalIntercession(requestId);
      return {
        ok: persisted,
        mode: 'guest',
        error: persisted ? null : 'We could not save your intercession. Please try again.',
      };
    }
  }

  const persisted = markLocalIntercession(requestId);
  return {
    ok: persisted,
    mode: 'guest',
    error: persisted ? null : 'We could not save your intercession on this device.',
  };
}