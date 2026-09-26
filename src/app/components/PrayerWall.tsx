"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import IntercessionBeaconFeed from "@/app/components/IntercessionBeaconFeed";
import PrayerDropInModal from "@/app/components/PrayerDropInModal";
import PrayerSubmissionModal from "@/app/components/PrayerSubmissionModal";
import {
  CheckIcon,
  HeartIcon,
  PlusIcon,
  UsersIcon,
} from "@/app/components/icons";
import {
  announceAmenPulse,
  createPulseGate,
  createSelfEchoGuard,
  formatRetryAfter,
  type PulseGate,
  type SelfEchoGuard,
} from "@/lib/intercessionPulse";
import {
  getLocalIntercessionIds,
  getPrayerRequests,
  PRAYER_TOPICS,
  recordIntercession,
  subscribeToPrayerSubmissions,
  type PrayerFilter,
} from "@/lib/prayers";
import type { PrayerRequest } from "@/lib/types";
import { usePrayerRealtime } from "@/lib/usePrayerRealtime";

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
  const [dropInOpen, setDropInOpen] = useState(false);
  /** Copy shown when the pulse gate refuses a burst of rapid Amens. */
  const [pulseNotice, setPulseNotice] = useState<string | null>(null);
  const [optimisticCounts, setOptimisticCounts] = useState<
    Record<string, number>
  >({});
  const [intercededIds, setIntercededIds] = useState<string[]>([]);
  const [pulseId, setPulseId] = useState<string | null>(null);
  /** Card whose counter badge is pulsing from a *remote* believer's "I Prayed". */
  const [remotePulseId, setRemotePulseId] = useState<string | null>(null);

  /**
   * Freshest wall list for callbacks that must not re-subscribe the realtime
   * channel when the list changes (mirrors `usePrayerRealtime`'s own ref bridge).
   */
  const prayersRef = useRef<PrayerRequest[]>([]);

  /** One sliding-window gate per session: this visitor's Amen budget is shared wall-wide. */
  const pulseGateRef = useRef<PulseGate | null>(null);

  /** Recognises this device's own realtime echo so it is never re-announced. */
  const selfEchoRef = useRef<SelfEchoGuard | null>(null);

  /** Retires the rate-limit notice once it has been read. */
  const pulseNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    prayersRef.current = prayers ?? [];
  }, [prayers]);

  useEffect(
    () => () => {
      if (pulseNoticeTimer.current) clearTimeout(pulseNoticeTimer.current);
    },
    [],
  );

  /** Shows the gentle "one prayer at a time" notice, then clears it. */
  const showPulseNotice = useCallback((message: string) => {
    setPulseNotice(message);
    if (pulseNoticeTimer.current) clearTimeout(pulseNoticeTimer.current);
    pulseNoticeTimer.current = setTimeout(() => setPulseNotice(null), 4000);
  }, []);

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

  /**
   * Examen-to-intercession bridge: a share from anywhere on the page (the
   * Examen card, this wall's own dialog, a future surface) announces itself via
   * the prayer data layer, and the wall reloads so the new request appears
   * immediately — no page refresh required. This is the single refresh path.
   */
  useEffect(
    () =>
      subscribeToPrayerSubmissions(() => {
        // The shared prayer is filed under its own category (the Examen bridge
        // uses "Guidance"), so clear any active filter and reload: the newest
        // request is then guaranteed to be visible in the grid below.
        setTopic(null);
        setAnsweredOnly(false);
        void fetchWall().then(applyResult);
      }),
    [fetchWall, applyResult],
  );

  /**
   * Realtime layer: bridges `postgres_changes` events into the wall state.
   * Updates are ignored while the initial fetch is still in flight (the fetch
   * result replaces the list wholesale anyway).
   */
  const updatePrayerList = useCallback(
    (update: (prev: PrayerRequest[]) => PrayerRequest[]) => {
      setPrayers((current) => (current === null ? current : update(current)));
    },
    [],
  );

  const handleRemoteActivity = useCallback((requestId: string) => {
    // A remote believer's bump also covers this visitor's own optimistic +1
    // once it reaches the server — drop the override so the counter shows the
    // server truth (and future remote bumps) instead of a stale snapshot.
    setOptimisticCounts((currentCounts) => {
      if (!(requestId in currentCounts)) return currentCounts;
      const next = { ...currentCounts };
      delete next[requestId];
      return next;
    });
    setRemotePulseId(requestId);

    // The community pulse: the Watchman hero answers with its shipped thumbs-up
    // gesture and the beacon feed logs the entry. The title is looked up through
    // a ref so this callback keeps a stable identity (no channel churn).
    //
    // Our own write arriving back over the wire is not news, though: consume the
    // pending self-echo and stop (the counter override above is already released
    // by then, so the tally still settles on the server's truth).
    if (selfEchoRef.current?.consume(requestId) === true) return;

    const activity = prayersRef.current.find(
      (prayer) => prayer.id === requestId,
    );
    announceAmenPulse({
      title: activity?.title ?? "A prayer on the wall",
      topic: activity?.topics[0] ?? null,
      source: "remote",
    });
  }, []);

  const realtimeStatus = usePrayerRealtime({
    prayers: prayers ?? [],
    setPrayers: updatePrayerList,
    onRemoteActivity: handleRemoteActivity,
  });

  const handleIntercede = async (prayer: PrayerRequest) => {
    if (intercededIds.includes(prayer.id)) return;

    // Sprint 2 pulse gate: a sliding window (6/minute, 700ms apart) so an
    // excited burst cannot inflate counters or hammer the cloud. Refused
    // pulses change nothing — no optimistic bump, no network write. The gate
    // reads the clock itself (`attempt`), keeping this render function pure.
    const gate = (pulseGateRef.current ??= createPulseGate());
    const decision = gate.attempt();
    if (!decision.allowed) {
      const wait = formatRetryAfter(decision.retryAfterMs);
      showPulseNotice(
        wait === ""
          ? "Take a breath — one prayer at a time."
          : `Take a breath — the wall is catching up. Try again in ${wait}.`,
      );
      return;
    }
    setPulseNotice(null);

    const current = optimisticCounts[prayer.id] ?? prayer.intercession_count;
    setOptimisticCounts((currentCounts) => ({
      ...currentCounts,
      [prayer.id]: current + 1,
    }));
    setIntercededIds((currentIds) => [...currentIds, prayer.id]);
    setPulseId(prayer.id);

    // Announce the pulse before the write: the celebration is the visitor's
    // own act of prayer, and it must not wait on the network (the counter
    // rollback below only affects the tally, never the hero or the feed).
    (selfEchoRef.current ??= createSelfEchoGuard()).mark(prayer.id);
    announceAmenPulse({
      title: prayer.title,
      topic: prayer.topics[0] ?? null,
      source: "local",
    });

    const result = await recordIntercession(prayer.id);
    if (!result.ok) {
      // Roll back the optimistic update so the counter stays truthful.
      setOptimisticCounts((currentCounts) => {
        const next = { ...currentCounts };
        delete next[prayer.id];
        return next;
      });
      setIntercededIds((currentIds) =>
        currentIds.filter((id) => id !== prayer.id),
      );
      console.warn(
        "Prayer wall: intercession could not be recorded:",
        result.error,
      );
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="rounded-3xl border border-white/10 bg-pill/75 p-4 shadow-xl backdrop-blur-2xl sm:p-6">
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
              className={`relative inline-flex min-h-[44px] items-center rounded-full px-3.5 py-1.5 text-xs font-bold outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-gold/50 ${
                topic === null && !answeredOnly
                  ? "text-canvas"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              {topic === null && !answeredOnly ? (
                <motion.span
                  layoutId="prayer-filter-pill"
                  transition={{ type: "spring", stiffness: 420, damping: 32 }}
                  className="absolute inset-0 rounded-full bg-gold shadow-lg shadow-gold/20"
                  aria-hidden="true"
                />
              ) : null}
              <span className="relative">All prayers</span>
            </button>
            {PRAYER_TOPICS.map((wallTopic) => {
              const selected = topic === wallTopic;
              return (
                <button
                  key={wallTopic}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setTopic(selected ? null : wallTopic)}
                  className={`relative inline-flex min-h-[44px] items-center rounded-full px-3.5 py-1.5 text-xs font-bold outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-gold/50 ${
                    selected ? "text-canvas" : "text-slate-300 hover:text-white"
                  }`}
                >
                  {selected ? (
                    <motion.span
                      layoutId="prayer-filter-pill"
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 32,
                      }}
                      className="absolute inset-0 rounded-full bg-gold shadow-lg shadow-gold/20"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="relative">{wallTopic}</span>
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={answeredOnly}
              onClick={() => setAnsweredOnly(!answeredOnly)}
              className={`relative inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-gold/50 ${
                answeredOnly ? "text-canvas" : "text-slate-300 hover:text-white"
              }`}
            >
              {answeredOnly ? (
                <motion.span
                  layoutId="prayer-filter-pill"
                  transition={{ type: "spring", stiffness: 420, damping: 32 }}
                  className="absolute inset-0 rounded-full bg-gold shadow-lg shadow-gold/20"
                  aria-hidden="true"
                />
              ) : null}
              {answeredOnly ? <CheckIcon className="relative h-3 w-3" /> : null}
              <span className="relative">Answered</span>
            </button>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <motion.button
              type="button"
              onClick={() => setDropInOpen(true)}
              whileTap={{ scale: 0.96 }}
              whileHover={{ y: -1 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              aria-haspopup="dialog"
              aria-expanded={dropInOpen}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-xs font-bold text-canvas shadow-lg shadow-gold/20 outline-none transition hover:bg-gold-deep focus-visible:ring-2 focus-visible:ring-gold/50"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Drop a Prayer
            </motion.button>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={modalOpen}
              className="inline-flex min-h-[44px] items-center rounded-full border border-sand bg-pill px-3.5 py-2 text-xs font-bold text-espresso transition-colors duration-200 hover:border-gold hover:text-pill-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
            >
              Write a fuller request
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <p aria-live="polite" className="text-xs font-medium text-muted">
            {prayers === null
              ? "Gathering the prayer wall…"
              : `${prayers.length} ${prayers.length === 1 ? "prayer" : "prayers"}${
                  topic ? ` in ${topic}` : ""
                }${answeredOnly ? " · answered only" : ""}`}
          </p>
          {realtimeStatus === "live" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-pill px-2.5 py-0.5 text-[11px] font-bold text-pill-ink">
              <span
                aria-hidden
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold"
              />
              Live
            </span>
          ) : null}
          {pulseNotice ? (
            <span
              role="status"
              aria-live="polite"
              className="inline-flex items-center rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-[11px] font-bold text-gold"
            >
              {pulseNotice}
            </span>
          ) : null}
        </div>

        <IntercessionBeaconFeed />

        {prayers === null ? (
          <div
            role="status"
            aria-busy="true"
            className="mt-2 grid grid-cols-1 gap-6 md:grid-cols-2"
          >
            {[0, 1].map((skeleton) => (
              <div
                key={skeleton}
                className="h-40 animate-pulse rounded-3xl border border-white/10 bg-pill/60"
              />
            ))}
          </div>
        ) : prayers.length === 0 ? (
          <div className="mt-2 rounded-3xl border border-dashed border-white/10 bg-pill/60 p-8 text-center">
            <p className="text-sm font-bold text-espresso">
              No prayers in this view yet
            </p>
            <p className="mt-1 text-sm leading-6 text-muted">
              Try another topic &mdash; or be the first to share a prayer for
              this need.
            </p>
          </div>
        ) : (
          <motion.ul
            layout
            className="mt-2 grid list-none grid-cols-1 gap-6 md:grid-cols-2"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {prayers.map((prayer) => {
                const interceded = intercededIds.includes(prayer.id);
                const count =
                  optimisticCounts[prayer.id] ?? prayer.intercession_count;
                const author =
                  prayer.author_name.trim() === ""
                    ? "Anonymous"
                    : prayer.author_name.trim();
                return (
                  <motion.li
                    key={prayer.id}
                    layout
                    initial={{ opacity: 0, scale: 0.94, y: 16 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.94, y: 16 }}
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    className="relative flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-pill/75 p-6 shadow-xl backdrop-blur-2xl"
                  >
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/10"
                    />
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-extrabold text-slate-200"
                      >
                        {author.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-espresso">
                          {author}
                        </p>
                        <p className="text-xs text-muted">
                          {formatDate(prayer.created_at)}
                          {prayer.is_answered ? " · Answered" : ""}
                        </p>
                      </div>
                      {prayer.is_answered ? (
                        <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-bold text-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.25)]">
                          <CheckIcon className="h-3 w-3" />
                          Answered
                        </span>
                      ) : null}
                    </div>

                    <h3 className="mt-4 text-base font-extrabold tracking-tight text-espresso">
                      {prayer.title}
                    </h3>
                    <p className="mt-2 flex-1 text-sm leading-6 text-slate-300">
                      {prayer.body}
                    </p>

                    {prayer.answered_note ? (
                      <p className="mt-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/5 px-3 py-2 text-xs italic leading-5 text-emerald-200">
                        {prayer.answered_note}
                      </p>
                    ) : null}

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {prayer.topics.map((prayerTopic) => (
                        <span
                          key={prayerTopic}
                          className="inline-flex items-center rounded-full border border-white/10 bg-gold/10 px-2.5 py-1 text-[11px] font-bold text-gold"
                        >
                          {prayerTopic}
                        </span>
                      ))}
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
                        <UsersIcon className="h-3.5 w-3.5" />
                        <span
                          aria-live="polite"
                          onAnimationEnd={() => setRemotePulseId(null)}
                          className={`font-bold tabular-nums text-espresso ${
                            remotePulseId === prayer.id ? "prayer-pulse" : ""
                          }`}
                        >
                          {count}
                        </span>
                        praying
                      </span>
                      <motion.button
                        type="button"
                        onClick={() => void handleIntercede(prayer)}
                        disabled={interceded}
                        onAnimationEnd={() => setPulseId(null)}
                        aria-pressed={interceded}
                        whileTap={interceded ? undefined : { scale: 0.95 }}
                        whileHover={interceded ? undefined : { y: -1 }}
                        transition={{
                          type: "spring",
                          stiffness: 430,
                          damping: 30,
                        }}
                        className={`relative inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-bold outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-gold/50 ${
                          pulseId === prayer.id ? "prayer-pulse" : ""
                        } ${
                          interceded
                            ? "border-gold/60 bg-gold/10 text-gold"
                            : "border-white/10 bg-white/5 text-espresso hover:border-gold/50 hover:bg-white/10"
                        } disabled:cursor-not-allowed`}
                      >
                        <motion.span
                          key={interceded ? "prayed" : "idle"}
                          initial={{ scale: 0.6, rotate: interceded ? -12 : 0 }}
                          animate={{ scale: 1, rotate: 0 }}
                          transition={{
                            type: "spring",
                            stiffness: 500,
                            damping: 18,
                          }}
                          className="inline-flex"
                          aria-hidden
                        >
                          <HeartIcon
                            className={`h-3.5 w-3.5 ${interceded ? "fill-gold/40 text-gold" : ""}`}
                          />
                        </motion.span>
                        {interceded ? "You prayed" : "I Prayed"}
                      </motion.button>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </motion.ul>
        )}

        <PrayerDropInModal
          open={dropInOpen}
          onClose={() => setDropInOpen(false)}
        />

        <PrayerSubmissionModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
        />
      </div>
    </MotionConfig>
  );
}
