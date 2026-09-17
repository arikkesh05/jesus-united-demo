'use client';

import { useCallback, useEffect, useState } from 'react';
import PrayerSubmissionModal from '@/app/components/PrayerSubmissionModal';
import { CheckIcon, HeartIcon, PlusIcon, UsersIcon } from '@/app/components/icons';
import {
  getLocalIntercessionIds,
  getPrayerRequests,
  PRAYER_TOPICS,
  recordIntercession,
  type PrayerFilter,
} from '@/lib/prayers';
import type { PrayerRequest } from '@/lib/types';

const FILTER_PILL_CLASS =
  'inline-flex items-center rounded-full border px-3.5 py-1.5 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50';

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Everything the wall view needs after a (re)load of the filtered request list. */
interface LoadResult {
  prayers: PrayerRequest[];
  intercededIds: string[];
}

export default function PrayerWall() {
  const [prayers, setPrayers] = useState<PrayerRequest[] | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [answeredOnly, setAnsweredOnly] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [optimisticCounts, setOptimisticCounts] = useState<Record<string, number>>({});
  const [intercededIds, setIntercededIds] = useState<string[]>([]);
  const [pulseId, setPulseId] = useState<string | null>(null);

  const applyResult = useCallback((result: LoadResult) => {
    setPrayers(result.prayers);
    setIntercededIds(result.intercededIds);
  }, []);

  const fetchWall = useCallback(async (): Promise<LoadResult> => {
    const filter: PrayerFilter = { topic: topic ?? undefined, answeredOnly };
    const [prayerList, localIntercessionIds] = await Promise.all([
      getPrayerRequests(filter),
      Promise.resolve(getLocalIntercessionIds()),
    ]);
    return { prayers: prayerList, intercededIds: localIntercessionIds };
  }, [topic, answeredOnly]);

  useEffect(() => {
    let active = true;
    void fetchWall().then((result) => {
      if (active) applyResult(result);
    });
    return () => {
      active = false;
    };
  }, [fetchWall, applyResult]);

  const handleIntercede = async (prayer: PrayerRequest) => {
    if (intercededIds.includes(prayer.id)) return;

    const current = optimisticCounts[prayer.id] ?? prayer.intercession_count;
    setOptimisticCounts((currentCounts) => ({
      ...currentCounts,
      [prayer.id]: current + 1,
    }));
    setIntercededIds((currentIds) => [...currentIds, prayer.id]);
    setPulseId(prayer.id);

    const result = await recordIntercession(prayer.id);
    if (!result.ok) {
      // Roll back the optimistic update so the counter stays truthful.
      setOptimisticCounts((currentCounts) => {
        const next = { ...currentCounts };
        delete next[prayer.id];
        return next;
      });
      setIntercededIds((currentIds) => currentIds.filter((id) => id !== prayer.id));
      console.warn('Prayer wall: intercession could not be recorded:', result.error);
    }
  };

  return (
    <div className="rounded-3xl border border-sand bg-white p-4 shadow-soft sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div
          role="group"
          aria-label="Filter prayers by topic"
          className="flex flex-wrap items-center gap-2"
        >
          <button
            type="button"
            aria-pressed={topic === null && !answeredOnly}
            onClick={() => {
              setTopic(null);
              setAnsweredOnly(false);
            }}
            className={`${FILTER_PILL_CLASS} ${
              topic === null && !answeredOnly
                ? 'border-gold bg-pill text-pill-ink'
                : 'border-sand bg-white text-muted hover:border-gold'
            }`}
          >
            All prayers
          </button>
          {PRAYER_TOPICS.map((wallTopic) => {
            const selected = topic === wallTopic;
            return (
              <button
                key={wallTopic}
                type="button"
                aria-pressed={selected}
                onClick={() => setTopic(selected ? null : wallTopic)}
                className={`${FILTER_PILL_CLASS} ${
                  selected
                    ? 'border-gold bg-pill text-pill-ink'
                    : 'border-sand bg-white text-muted hover:border-gold'
                }`}
              >
                {wallTopic}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={answeredOnly}
            onClick={() => setAnsweredOnly(!answeredOnly)}
            className={`${FILTER_PILL_CLASS} ${
              answeredOnly
                ? 'border-gold bg-pill text-pill-ink'
                : 'border-sand bg-white text-muted hover:border-gold'
            }`}
          >
            Answered
          </button>
        </div>

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-xs font-bold text-espresso transition hover:bg-gold-deep hover:shadow-md"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Share a Prayer
        </button>
      </div>

      <p aria-live="polite" className="mt-4 text-xs font-medium text-muted">
        {prayers === null
          ? 'Gathering the prayer wall…'
          : `${prayers.length} ${prayers.length === 1 ? 'prayer' : 'prayers'}${
              topic ? ` in ${topic}` : ''
            }${answeredOnly ? ' · answered only' : ''}`}
      </p>

      {prayers === null ? (
        <div role="status" aria-busy="true" className="mt-2 grid grid-cols-1 gap-6 md:grid-cols-2">
          {[0, 1].map((skeleton) => (
            <div
              key={skeleton}
              className="h-40 animate-pulse rounded-3xl border border-sand bg-canvas"
            />
          ))}
        </div>
      ) : prayers.length === 0 ? (
        <div className="mt-2 rounded-3xl border border-dashed border-sand bg-white p-8 text-center">
          <p className="text-sm font-bold text-espresso">No prayers in this view yet</p>
          <p className="mt-1 text-sm leading-6 text-muted">
            Try another topic &mdash; or be the first to share a prayer for this need.
          </p>
        </div>
      ) : (
        <ul className="mt-2 grid list-none grid-cols-1 gap-6 md:grid-cols-2">
          {prayers.map((prayer) => {
            const interceded = intercededIds.includes(prayer.id);
            const count = optimisticCounts[prayer.id] ?? prayer.intercession_count;
            const author =
              prayer.author_name.trim() === '' ? 'Anonymous' : prayer.author_name.trim();
            return (
              <li
                key={prayer.id}
                className="flex flex-col rounded-3xl border border-sand bg-canvas p-6 shadow-soft transition hover:border-gold/60 hover:shadow-lift"
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pill text-sm font-extrabold text-pill-ink"
                  >
                    {author.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-espresso">{author}</p>
                    <p className="text-xs text-muted">
                      {formatDate(prayer.created_at)}
                      {prayer.is_answered ? ' · Answered' : ''}
                    </p>
                  </div>
                  {prayer.is_answered ? (
                    <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-gold bg-pill px-2.5 py-1 text-[11px] font-bold text-pill-ink">
                      <CheckIcon className="h-3 w-3" />
                      Answered
                    </span>
                  ) : null}
                </div>

                <h3 className="mt-4 text-base font-extrabold tracking-tight text-espresso">
                  {prayer.title}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-6 text-espresso/90">{prayer.body}</p>

                {prayer.answered_note ? (
                  <p className="mt-3 rounded-2xl border border-gold/40 bg-pill px-3 py-2 text-xs italic leading-5 text-pill-ink">
                    {prayer.answered_note}
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {prayer.topics.map((prayerTopic) => (
                    <span
                      key={prayerTopic}
                      className="inline-flex items-center rounded-full bg-pill px-2.5 py-1 text-[11px] font-bold text-pill-ink"
                    >
                      {prayerTopic}
                    </span>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-sand pt-4">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
                    <UsersIcon className="h-3.5 w-3.5" />
                    <span aria-live="polite" className="font-bold tabular-nums text-espresso">
                      {count}
                    </span>
                    praying
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleIntercede(prayer)}
                    disabled={interceded}
                    onAnimationEnd={() => setPulseId(null)}
                    aria-pressed={interceded}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${
                      pulseId === prayer.id ? 'prayer-pulse' : ''
                    } ${
                      interceded
                        ? 'border-gold bg-pill text-pill-ink'
                        : 'border-sand bg-white text-espresso hover:border-gold hover:bg-pill'
                    } disabled:cursor-not-allowed`}
                  >
                    <HeartIcon
                      className={`h-3.5 w-3.5 ${interceded ? 'fill-gold/30 text-gold-deep' : ''}`}
                    />
                    {interceded ? 'You prayed' : 'I Prayed'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <PrayerSubmissionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmitted={() => void fetchWall().then(applyResult)}
      />
    </div>
  );
}