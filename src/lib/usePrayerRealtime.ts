'use client';

import { useEffect, useRef, useState } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { parsePrayerRow } from '@/lib/prayers';
import { createClient } from '@/lib/supabaseBrowser';
import type { PrayerRequest } from '@/lib/types';

/**
 * Prayer Wall realtime subscription layer (Phase 2 — Task 1).
 *
 * Subscribes once to `postgres_changes` on the `public.prayer_requests` table
 * and funnels normalised changes into the component's list state:
 *
 * - INSERT: newly submitted/approved public prayers are prepended to the wall
 *   (duplicate ids are ignored, and non-public rows are dropped — RLS should
 *   already filter them, but the client never trusts the wire).
 * - UPDATE: `intercession_count`, `is_answered` and `answered_note` are patched
 *   in place on the matching card; when a *remote* believer bumps a counter,
 *   `onRemoteActivity(requestId)` fires so the wall can pulse that badge.
 * - DELETE: the prayer leaves the public wall.
 *
 * Guest / offline resilience: the channel status degrades to `unavailable`
 * (never throws) when Supabase is unreachable, the environment variables are
 * missing, or realtime is not enabled for the table — the wall simply keeps
 * working off the last fetch.
 */

export type PrayerRealtimeStatus = 'connecting' | 'live' | 'unavailable';

/** Pure functional list update, compatible with a `useState` setter. */
export type PrayerListUpdater = (update: (prev: PrayerRequest[]) => PrayerRequest[]) => void;

export interface UsePrayerRealtimeOptions {
  /** The currently rendered wall list (kept in an internal ref for event reads). */
  prayers: PrayerRequest[];
  /** Applies a pure functional update to the wall list state. */
  setPrayers: PrayerListUpdater;
  /** Fired when a remote believer bumps a prayer's intercession count. */
  onRemoteActivity?: (requestId: string) => void;
}

const CHANNEL_NAME = 'prayer-wall:public:prayer_requests';

export function usePrayerRealtime({
  prayers,
  setPrayers,
  onRemoteActivity,
}: UsePrayerRealtimeOptions): PrayerRealtimeStatus {
  const [status, setStatus] = useState<PrayerRealtimeStatus>('connecting');

  // The subscription mounts once, so handlers read the freshest values through
  // refs instead of closing over stale props.
  const prayersRef = useRef(prayers);
  useEffect(() => {
    prayersRef.current = prayers;
  }, [prayers]);

  const activityRef = useRef(onRemoteActivity);
  useEffect(() => {
    activityRef.current = onRemoteActivity;
  }, [onRemoteActivity]);

  useEffect(() => {
    let client: ReturnType<typeof createClient>;
    try {
      client = createClient();
    } catch (error) {
      // Missing/malformed Supabase env vars: the wall still renders from the
      // fetch layer; realtime just stays dark. The status flip is deferred
      // (not synchronous in the effect body) to avoid a cascading render.
      console.warn('Prayer wall: realtime unavailable, no Supabase client:', error);
      queueMicrotask(() => setStatus('unavailable'));
      return;
    }
    return setupChannel(client, prayersRef, setPrayers, activityRef, setStatus);
  }, [setPrayers]);

  return status;
}

// ---------------------------------------------------------------------------
// Channel wiring (hoisted so the hook body stays readable).
// ---------------------------------------------------------------------------

type PrayerRef = { current: PrayerRequest[] };

function prependIfPublic(
  prayer: PrayerRequest,
  prayersRef: PrayerRef,
  setPrayers: PrayerListUpdater
): void {
  // Duplicate guard: the same prayer can arrive twice (e.g. a local
  // submission's refetch racing this event) — never render it twice.
  if (prayersRef.current.some((existing) => existing.id === prayer.id)) return;
  setPrayers((current) =>
    current.some((existing) => existing.id === prayer.id) ? current : [prayer, ...current]
  );
}

function handleRealtimePayload(
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
  prayersRef: PrayerRef,
  setPrayers: PrayerListUpdater,
  onRemoteActivity: (requestId: string) => void
): void {
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    console.warn('Prayer wall: realtime payload carried errors:', payload.errors);
    return;
  }

  if (payload.eventType === 'INSERT') {
    const prayer = parsePrayerRow(payload.new);
    // Only approved/public prayers belong on the wall.
    if (prayer && prayer.is_public) prependIfPublic(prayer, prayersRef, setPrayers);
    return;
  }

  if (payload.eventType === 'UPDATE') {
    const next = parsePrayerRow(payload.new);
    if (!next) return;

    const current = prayersRef.current.find((prayer) => prayer.id === next.id);
    if (!current) {
      // A prayer that was private and just became public appears live.
      if (next.is_public) prependIfPublic(next, prayersRef, setPrayers);
      return;
    }

    if (!next.is_public) {
      // The author withdrew the prayer (or it was unapproved): remove it.
      setPrayers((currentList) => currentList.filter((prayer) => prayer.id !== next.id));
      return;
    }

    const countChanged = current.intercession_count !== next.intercession_count;
    setPrayers((currentList) =>
      currentList.map((prayer) =>
        prayer.id === next.id
          ? {
              ...prayer,
              intercession_count: next.intercession_count,
              is_answered: next.is_answered,
              answered_note: next.answered_note,
            }
          : prayer
      )
    );
    if (countChanged) onRemoteActivity(next.id);
    return;
  }

  if (payload.eventType === 'DELETE') {
    const removedId =
      typeof payload.old === 'object' &&
      payload.old !== null &&
      typeof payload.old.id === 'string'
        ? payload.old.id
        : '';
    if (removedId === '') return;
    setPrayers((currentList) => currentList.filter((prayer) => prayer.id !== removedId));
  }
}

function setupChannel(
  client: ReturnType<typeof createClient>,
  prayersRef: PrayerRef,
  setPrayers: PrayerListUpdater,
  activityRef: { current: ((requestId: string) => void) | undefined },
  setStatus: (status: PrayerRealtimeStatus) => void
): () => void {
  const channel = client
    .channel(CHANNEL_NAME)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'prayer_requests' },
      (payload) =>
        handleRealtimePayload(payload, prayersRef, setPrayers, (requestId) =>
          activityRef.current?.(requestId)
        )
    )
    .subscribe((subscribeStatus) => {
      if (subscribeStatus === 'SUBSCRIBED') {
        setStatus('live');
      } else if (
        subscribeStatus === 'CHANNEL_ERROR' ||
        subscribeStatus === 'TIMED_OUT' ||
        subscribeStatus === 'CLOSED'
      ) {
        setStatus('unavailable');
      }
    });

  return () => {
    // removeChannel() unsubscribes and tears the channel down server-side so
    // unmounting (including React StrictMode's double mount) leaks nothing.
    void client.removeChannel(channel);
  };
}
