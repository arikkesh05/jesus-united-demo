'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  CheckIcon,
  CloseIcon,
  UsersIcon,
} from '@/app/components/icons';
import {
  deletePrayerRequest,
  getModerationAccess,
  getModeratedPrayers,
  getPendingGatherings,
  moderateGathering,
  setPrayerVisibility,
  type ModerateGatheringAction,
} from '@/lib/moderation';
import type { GatheringSubmission, PrayerRequest } from '@/lib/types';

/**
 * Admin Moderation Deck (Phase 2 — Task 2).
 *
 * Editor-only surface: pending gathering review + community prayer oversight.
 * Brand: Warm Linen Ivory canvas, white cards on Sand borders, Honey Gold
 * accents; Approve is gold, Reject is a subtle destructive (sand-outline,
 * deep red text) — per the antigravity-design-expert palette.
 *
 * Access is checked before loading queues and again for every data operation.
 * The database membership check, RLS, and transactional RPC enforce authorization.
 * Missing configuration or an unauthorized session renders a restricted shell.
 */

type TabId = 'gatherings' | 'prayers';

const TABS: { id: TabId; label: string }[] = [
  { id: 'gatherings', label: 'Pending Gatherings' },
  { id: 'prayers', label: 'Prayer Oversight' },
];

const REVIEW_PILL_CLASS =
  'inline-flex items-center rounded-full border px-3.5 py-1.5 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50';

interface NoticeState {
  kind: 'success' | 'error';
  text: string;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatCoordinates(
  latitude: number | null,
  longitude: number | null
): string | null {
  if (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return `${Math.abs(latitude).toFixed(5)}° ${latitude >= 0 ? 'N' : 'S'}, ${Math.abs(longitude).toFixed(5)}° ${longitude >= 0 ? 'E' : 'W'}`;
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabId>('gatherings');

  // Gathering queue state
  const [submissions, setSubmissions] = useState<GatheringSubmission[] | null>(null);
  const [busySubmissionIds, setBusySubmissionIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [access, setAccess] = useState<'checking' | 'allowed' | 'denied'>('checking');
  const [notice, setNotice] = useState<NoticeState | null>(null);

  // Prayer oversight state
  const [prayers, setPrayers] = useState<PrayerRequest[] | null>(null);
  const [busyPrayerIds, setBusyPrayerIds] = useState<string[]>([]);
  const [prayerNotice, setPrayerNotice] = useState<NoticeState | null>(null);

  // Pure async fetcher (no setState inside) so the mount effect can apply the
  // result behind an `active` flag — the pattern the react-hooks lint rules
  // require (see MEMORY.md, Phase 1 Task 4 lint gotcha).
  const fetchModerationData = useCallback(
    async (): Promise<{ submissions: GatheringSubmission[]; prayers: PrayerRequest[] }> => {
      const [pendingGatherings, moderatedPrayers] = await Promise.all([
        getPendingGatherings(),
        getModeratedPrayers(),
      ]);
      return { submissions: pendingGatherings, prayers: moderatedPrayers };
    },
    []
  );

  const load = useCallback(async () => {
    const allowed = await getModerationAccess();
    if (!allowed) return { allowed, submissions: [], prayers: [], error: null };
    try {
      const data = await fetchModerationData();
      return { allowed, ...data, error: null };
    } catch {
      return { allowed, submissions: [], prayers: [], error: 'The review queues could not be loaded. Please retry.' };
    }
  }, [fetchModerationData]);

  const refresh = useCallback(() => {
    setLoadError(null);
    void load().then((result) => {
      setAccess(result.allowed ? 'allowed' : 'denied');
      setSubmissions(result.submissions);
      setPrayers(result.prayers);
      setLoadError(result.error);
    });
  }, [load]);

  useEffect(() => {
    let active = true;
    void load().then((result) => {
      if (active) {
        setAccess(result.allowed ? 'allowed' : 'denied');
        setSubmissions(result.submissions);
        setPrayers(result.prayers);
        setLoadError(result.error);
      }
    });
    return () => { active = false; };
  }, [load]);

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const index = TABS.findIndex((tab) => tab.id === activeTab);
    const next = event.key === 'Home' ? TABS[0] : event.key === 'End' ? TABS[TABS.length - 1] : TABS[(index + offset + TABS.length) % TABS.length];
    setActiveTab(next.id);
    document.getElementById(`admin-tab-${next.id}`)?.focus();
  };

  const handleModerate = async (
    submission: GatheringSubmission,
    action: ModerateGatheringAction
  ) => {
    setBusySubmissionIds((current) => [...current, submission.id]);
    setNotice(null);

    // Optimistic removal: the card leaves the queue immediately.
    setSubmissions(
      (current) => current?.filter((row) => row.id !== submission.id) ?? null
    );

    const result = await moderateGathering(submission.id, action);
    if (result.ok) {
      setNotice({
        kind: 'success',
        text:
          action === 'approve'
            ? `“${submission.gathering_data.name}” was approved and published to the gathering map.`
            : `“${submission.gathering_data.name}” was rejected.`,
      });
    } else {
      // Roll back: the card returns to the queue.
      setSubmissions((current) =>
        current === null ? null : [submission, ...current.filter((row) => row.id !== submission.id)]
      );
      setNotice({ kind: 'error', text: result.error ?? 'The moderation action failed.' });
    }
    setBusySubmissionIds((current) => current.filter((id) => id !== submission.id));
  };

  const handleVisibility = async (prayer: PrayerRequest) => {
    const nextPublic = !prayer.is_public;
    setBusyPrayerIds((current) => [...current, prayer.id]);
    setPrayerNotice(null);

    // Optimistic toggle.
    setPrayers(
      (current) =>
        current?.map((row) => (row.id === prayer.id ? { ...row, is_public: nextPublic } : row)) ??
        null
    );

    const result = await setPrayerVisibility(prayer.id, nextPublic);
    if (result.ok) {
      setPrayerNotice({
        kind: 'success',
        text: nextPublic
          ? `“${prayer.title}” is visible on the public wall again.`
          : `“${prayer.title}” was hidden from the public wall.`,
      });
    } else {
      setPrayers(
        (current) =>
          current?.map((row) =>
            row.id === prayer.id ? { ...row, is_public: prayer.is_public } : row
          ) ?? null
      );
      setPrayerNotice({
        kind: 'error',
        text: result.error ?? 'The visibility change failed.',
      });
    }
    setBusyPrayerIds((current) => current.filter((id) => id !== prayer.id));
  };

  const handleDelete = async (prayer: PrayerRequest) => {
    setBusyPrayerIds((current) => [...current, prayer.id]);
    setPrayerNotice(null);

    // Optimistic removal (spam cleanup).
    setPrayers((current) => current?.filter((row) => row.id !== prayer.id) ?? null);

    const result = await deletePrayerRequest(prayer.id);
    if (result.ok) {
      setPrayerNotice({
        kind: 'success',
        text: `“${prayer.title}” was removed from the community.`,
      });
    } else {
      setPrayers((current) =>
        current === null ? null : [prayer, ...current.filter((row) => row.id !== prayer.id)]
      );
      setPrayerNotice({ kind: 'error', text: result.error ?? 'The prayer could not be removed.' });
    }
    setBusyPrayerIds((current) => current.filter((id) => id !== prayer.id));
  };

  const loading = submissions === null || prayers === null;

  if (access !== 'allowed') {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <section className="rounded-3xl border border-sand bg-pill p-8 shadow-soft">
          <p className="text-xs font-bold uppercase tracking-widest text-pill-ink">Administrative · Restricted</p>
          <h1 className="mt-3 text-3xl font-extrabold">Moderation Deck</h1>
          <p role="status" className="mt-4 text-sm leading-6 text-muted">
            {access === 'checking' ? 'Verifying moderator access…' : 'Moderator access is required. Use your authorized Supabase session and retry. Guests, expired sessions, and unavailable moderation services cannot access this deck.'}
          </p>
          <div className="mt-6 flex gap-4">
            <Link href="/" className="rounded-full border border-sand px-4 py-2 text-sm font-bold focus-visible:ring-2 focus-visible:ring-gold">Back to site</Link>
            {access === 'denied' ? <button type="button" onClick={refresh} className="rounded-full bg-[#F59E0B] px-4 py-2 text-sm font-bold text-canvas focus-visible:ring-2 focus-visible:ring-gold">Retry access</button> : null}
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-canvas font-sans text-espresso">
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-gold/50 bg-pill p-6 shadow-soft sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold-deep"
              >
                <UsersIcon className="h-5 w-5" />
              </span>
              <div>
                <span className="inline-flex items-center rounded-full bg-pill px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-pill-ink">
                  Administrative · Restricted
                </span>
                <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-espresso sm:text-3xl">
                  Moderation Deck
                </h1>
                <p className="mt-1 text-sm leading-6 text-muted">
                  Pending gathering submissions and community prayer oversight. Moderator access
                  is verified by the database; all changes remain subject to database policies.
                </p>
              </div>
            </div>
            <Link
              href="/"
              className="inline-flex shrink-0 items-center rounded-full border border-sand bg-pill px-4 py-2 text-xs font-bold text-espresso transition hover:border-gold hover:bg-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
            >
              Back to site
            </Link>
          </div>

          <div
            role="tablist"
            aria-label="Moderation queues"
            onKeyDown={handleTabKeyDown}
            className="mt-6 flex flex-wrap items-center gap-2"
          >
            {TABS.map((tab) => {
              const isActive = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  id={`admin-tab-${tab.id}`}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`admin-panel-${tab.id}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveTab(tab.id)}
                  className={`${REVIEW_PILL_CLASS} ${
                    isActive
                      ? 'border-gold bg-pill text-pill-ink'
                      : 'border-sand bg-pill text-muted hover:border-gold'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </header>

        {loadError ? <p role="status" className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">{loadError}</p> : null}
        <button type="button" onClick={refresh} disabled={busySubmissionIds.length > 0 || busyPrayerIds.length > 0}
          className="mt-4 rounded-full border border-sand bg-pill px-4 py-2 text-sm font-bold focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-50">Refresh queues</button>
        <p role="status" aria-live="polite" className="mt-4 text-xs font-medium text-muted">
          {loadError ? 'Queues unavailable — refresh to retry.' : loading
            ? 'Preparing the moderation deck…'
            : activeTab === 'gatherings'
              ? `${(submissions ?? []).length} pending ${(submissions ?? []).length === 1 ? 'gathering' : 'gatherings'} awaiting review.`
              : `${(prayers ?? []).length} recent ${(prayers ?? []).length === 1 ? 'prayer' : 'prayers'} under oversight.`}
        </p>

        {activeTab === 'gatherings' ? (
          <section
            id="admin-panel-gatherings"
            role="tabpanel"
            tabIndex={0}
            aria-labelledby="admin-tab-gatherings"
            className="mt-2"
          >
            {notice ? (
              <p
                role="status"
                className={`mb-4 rounded-2xl border px-4 py-3 text-sm font-medium ${
                  notice.kind === 'success'
                    ? 'border-[#F59E0B] bg-pill text-pill-ink'
                    : 'border-red-300 bg-red-50 text-red-700'
                }`}
              >
                {notice.text}
              </p>
            ) : null}

            {loadError ? null : submissions === null ? (
              <div role="status" aria-busy="true" className="grid grid-cols-1 gap-6">
                {[0, 1].map((skeleton) => (
                  <div
                    key={skeleton}
                    className="h-44 animate-pulse rounded-3xl border border-sand bg-pill"
                  />
                ))}
              </div>
            ) : submissions.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-sand bg-pill p-8 text-center">
                <p className="text-sm font-bold text-espresso">The review queue is clear</p>
                <p className="mt-1 text-sm leading-6 text-muted">
                  New guest-submitted gatherings will appear here for verification.
                </p>
              </div>
            ) : (
              <ul className="grid list-none grid-cols-1 gap-6">
                {submissions.map((submission) => {
                  const gathering = submission.gathering_data;
                  const coordinates = formatCoordinates(gathering.latitude, gathering.longitude);
                  const busy = busySubmissionIds.includes(submission.id);
                  return (
                    <li
                      key={submission.id}
                      className="rounded-3xl border border-sand bg-pill p-6 shadow-soft"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-base font-extrabold tracking-tight text-espresso">
                            {gathering.name || 'Untitled gathering'}
                          </p>
                          <p className="mt-0.5 text-xs text-muted">
                            Submitted {formatDateTime(submission.created_at)}
                          </p>
                        </div>
                        <span className="inline-flex shrink-0 items-center rounded-full border border-gold bg-pill px-2.5 py-1 text-[11px] font-bold text-pill-ink">
                          Pending review
                        </span>
                      </div>

                      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-sand bg-canvas px-4 py-3">
                          <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                            Submitter
                          </dt>
                          <dd className="mt-1 truncate text-sm font-bold text-espresso">
                            {submission.submitter_name || 'Anonymous'}
                          </dd>
                          <dd className="truncate text-xs text-muted">
                            {submission.submitter_email || 'No email provided'}
                          </dd>
                        </div>
                        <div className="rounded-2xl border border-sand bg-canvas px-4 py-3">
                          <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                            Meeting times
                          </dt>
                          <dd className="mt-1 text-sm font-bold text-espresso">
                            {gathering.meeting_time || 'Not provided'}
                          </dd>
                        </div>
                        <div className="rounded-2xl border border-sand bg-canvas px-4 py-3">
                          <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                            Address
                          </dt>
                          <dd className="mt-1 text-sm font-bold text-espresso">
                            {gathering.address || 'Not provided'}
                          </dd>
                          {coordinates ? (
                            <dd className="text-xs tabular-nums text-muted">{coordinates}</dd>
                          ) : <dd className="text-xs text-red-700">Coordinates must be verified before approval.</dd>}
                        </div>
                        <div className="rounded-2xl border border-sand bg-canvas px-4 py-3">
                          <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                            Denomination / notes
                          </dt>
                          <dd className="mt-1 text-sm font-bold text-espresso">
                            {gathering.description ?? 'Not provided'}
                          </dd>
                          <dd className="truncate text-xs text-muted">
                            Contact: {gathering.contact_email ?? submission.submitter_email}
                          </dd>
                        </div>
                      </dl>

                      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-sand pt-4">
                        <button
                          type="button"
                          disabled={busy || coordinates === null}
                          title={coordinates === null ? 'Verify coordinates in the submission before approving.' : undefined}
                          onClick={() => void handleModerate(submission, 'approve')}
                          className="inline-flex items-center gap-1.5 rounded-full bg-[#F59E0B] px-4 py-2 text-xs font-bold text-canvas transition hover:bg-[#D97706] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <CheckIcon className="h-3.5 w-3.5" />
                          {busy ? 'Approving…' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleModerate(submission, 'reject')}
                          className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-pill px-4 py-2 text-xs font-bold text-red-700 transition hover:border-red-300 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <CloseIcon className="h-3.5 w-3.5" />
                          {busy ? 'Rejecting…' : 'Reject'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}
        {activeTab === 'prayers' ? (
          <section id="admin-panel-prayers" role="tabpanel" aria-labelledby="admin-tab-prayers" tabIndex={0} className="mt-4">
            <p role="status" aria-live="polite" className={`mb-4 text-sm ${prayerNotice?.kind === 'error' ? 'text-red-700' : 'text-espresso'}`}>
              {prayerNotice?.text ?? 'Review the 50 most recent requests, including hidden prayers.'}
            </p>
            {loadError ? null : prayers === null ? (
              <p role="status">Loading prayer requests…</p>
            ) : prayers.length === 0 ? (
              <p className="rounded-3xl border border-dashed border-sand bg-pill p-8 text-center">No prayer requests to review.</p>
            ) : (
              <ul className="space-y-4">
                {prayers.map((prayer) => {
                  const busy = busyPrayerIds.includes(prayer.id);
                  return (
                    <li key={prayer.id} className="rounded-3xl border border-sand bg-pill p-6 shadow-soft">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h2 className="break-words text-lg font-bold">{prayer.title || 'Untitled prayer'}</h2>
                        <span className="rounded-full bg-pill px-3 py-1 text-xs font-bold text-pill-ink">
                          {prayer.is_public ? 'Public' : 'Hidden'}{prayer.is_answered ? ' · Answered' : ''}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted">{prayer.author_name || 'Anonymous'} · {formatDateTime(prayer.created_at)}</p>
                      <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6">{prayer.body}</p>
                      <p className="mt-3 text-xs text-muted">{prayer.intercession_count} intercessions{prayer.topics.length ? ` · ${prayer.topics.join(', ')}` : ''}</p>
                      <div className="mt-5 flex flex-wrap gap-3 border-t border-sand pt-4">
                        <button type="button" disabled={busy} aria-pressed={!prayer.is_public}
                          aria-label={`${prayer.is_public ? 'Hide' : 'Publish'} prayer: ${prayer.title}`}
                          onClick={() => void handleVisibility(prayer)}
                          className="rounded-full border border-sand px-4 py-2 text-sm font-bold transition hover:bg-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-50">
                          {busy ? 'Saving…' : prayer.is_public ? 'Hide from wall' : 'Publish to wall'}
                        </button>
                        <button type="button" disabled={busy}
                          aria-label={`Remove spam: ${prayer.title}`}
                          onClick={() => { if (window.confirm('Permanently remove this prayer and its intercessions? This cannot be undone.')) void handleDelete(prayer); }}
                          className="rounded-full border border-red-200 px-4 py-2 text-sm font-bold text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 disabled:opacity-50">
                          Remove spam
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}
