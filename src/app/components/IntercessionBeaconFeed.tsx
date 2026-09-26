"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import {
  BellIcon,
  HeartIcon,
  PlusIcon,
  UsersIcon,
} from "@/app/components/icons";
import {
  createLocalBeacon,
  fetchIntercessionBeacons,
  formatRelativeTime,
  prependBeacon,
  subscribeToAmenPulses,
  type BeaconFeed,
  type IntercessionBeacon,
} from "@/lib/intercessionPulse";
import { subscribeToPrayerSubmissions } from "@/lib/prayers";

/**
 * Sprint 2 — the live intercession beacon feed.
 *
 * A quiet strip of what just happened on the wall: this visitor's own Amen, a
 * remote believer's (relayed by the wall's realtime layer over the amen-pulse
 * bridge), and prayers that just joined. It reads as a heartbeat, not a ledger.
 *
 * Two invariants shape it:
 *
 * 1. **Fail-open.** `fetchIntercessionBeacons` never rejects and never returns
 *    an empty list: when the live read is denied, unreachable or empty, the
 *    feed renders the deterministic preview stream and *says so* ("Preview
 *    stream"), rather than showing an error or a blank panel. The visitor
 *    always sees the community moving.
 * 2. **No anonymous identity leaks.** Entries carry a prayer title and topic —
 *    never a name, an email or an exact location. Region labels exist only on
 *    the clearly-labelled simulated entries.
 *
 * Motion and a11y follow the house contract: entries spring in (transform +
 * opacity only), the panel re-announces each new beacon through a single
 * `role="status"` line instead of making the whole list a live region, and
 * `MotionConfig reducedMotion="user"` settles every entrance instantly for
 * visitors who asked for stillness.
 */

/** Entries rendered at once; the feed itself keeps the newest twelve. */
const VISIBLE_BEACONS = 5;

/** How often the relative ages re-render ("just now" → "2m ago"). */
const CLOCK_TICK_MS = 30_000;

interface BeaconRowProps {
  beacon: IntercessionBeacon;
  /** Client clock; `null` until mount so no relative age is server-rendered. */
  now: number | null;
  /** True while this row wears its arrival pulse. */
  fresh: boolean;
  onPulseEnd: () => void;
}

function BeaconRow({ beacon, now, fresh, onPulseEnd }: BeaconRowProps) {
  const relative =
    now === null || beacon.at === "" ? "" : formatRelativeTime(beacon.at, now);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      onAnimationEnd={fresh ? onPulseEnd : undefined}
      className={`relative flex items-center gap-3 rounded-2xl border border-white/10 bg-pill/70 px-3 py-2.5 ${
        fresh ? "prayer-pulse" : ""
      }`}
    >
      <span
        aria-hidden
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
          beacon.kind === "amen"
            ? "border-gold/40 bg-gold/10 text-gold"
            : "border-sky-400/40 bg-sky-400/10 text-sky-300"
        }`}
      >
        {beacon.kind === "amen" ? (
          <HeartIcon className="h-3.5 w-3.5" />
        ) : (
          <PlusIcon className="h-3.5 w-3.5" />
        )}
      </span>

      <p
        className="min-w-0 flex-1 truncate text-xs font-medium text-espresso"
        title={beacon.title}
      >
        {beacon.title}
      </p>

      {beacon.topic ? (
        <span className="hidden shrink-0 items-center rounded-full border border-white/10 bg-gold/10 px-2 py-0.5 text-[10px] font-bold text-gold sm:inline-flex">
          {beacon.topic}
        </span>
      ) : null}

      {beacon.region ? (
        <span className="hidden shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-muted md:inline">
          {beacon.region}
        </span>
      ) : null}

      {relative === "" ? null : (
        <time
          dateTime={beacon.at}
          className="shrink-0 text-[11px] font-medium tabular-nums text-muted"
        >
          {relative}
        </time>
      )}
    </motion.li>
  );
}

export default function IntercessionBeaconFeed() {
  const [feed, setFeed] = useState<BeaconFeed | null>(null);
  /** Client clock, set after mount so no relative age is server-rendered. */
  const [now, setNow] = useState<number | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  /** One line for assistive tech per new beacon; the list itself stays quiet. */
  const [announcement, setAnnouncement] = useState("");

  /** Mount-gated load — the fail-open fetch resolves, it never rejects. */
  useEffect(() => {
    let active = true;
    void fetchIntercessionBeacons(Date.now()).then((result) => {
      if (active) setFeed(result);
    });
    return () => {
      active = false;
    };
  }, []);

  /** Mount-gated clock: ages tick while the visitor is looking at the wall. */
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const frame = requestAnimationFrame(tick);
    const interval = window.setInterval(tick, CLOCK_TICK_MS);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(interval);
    };
  }, []);

  /**
   * Live bridges. Amen pulses arrive from this visitor's "I Prayed" *and* from
   * the wall's realtime layer when a remote believer prays; share announcements
   * arrive from any mounted share dialog. Both are additive: the feed only ever
   * grows, so a dropped event degrades to "slightly older news", never an error.
   */
  useEffect(() => {
    const add = (beacon: IntercessionBeacon, message: string) => {
      setFeed((current) =>
        current === null ? current : prependBeacon(current, beacon),
      );
      setFreshId(beacon.id);
      setAnnouncement(message);
    };

    const unsubscribePulses = subscribeToAmenPulses((detail) => {
      if (detail === null) return;
      add(
        createLocalBeacon({
          title: detail.title,
          topic: detail.topic,
          kind: "amen",
          at: detail.at === "" ? undefined : detail.at,
        }),
        detail.source === "remote"
          ? `A believer somewhere just prayed for ${detail.title}.`
          : `Your prayer for ${detail.title} is rising with the community.`,
      );
    });

    const unsubscribeShares = subscribeToPrayerSubmissions((detail) => {
      if (detail === null) return;
      add(
        createLocalBeacon({
          title: detail.title,
          topic: detail.topic,
          kind: "shared",
        }),
        `A new prayer joined the wall: ${detail.title}.`,
      );
    });

    return () => {
      unsubscribePulses();
      unsubscribeShares();
    };
  }, []);

  const source = feed?.source ?? "preview";
  const totals = feed?.totals ?? { total: 0, byTopic: [] };
  const beacons = feed === null ? [] : feed.beacons.slice(0, VISIBLE_BEACONS);

  return (
    <MotionConfig reducedMotion="user">
      <section
        aria-labelledby="intercession-beacons-title"
        className="mt-4 rounded-3xl border border-white/10 bg-pill/60 p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3
            id="intercession-beacons-title"
            className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-muted"
          >
            <BellIcon className="h-3.5 w-3.5 text-gold-deep" />
            Intercession beacons
          </h3>

          <div className="flex flex-wrap items-center gap-2">
            {feed === null ? null : source === "live" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-pill px-2.5 py-0.5 text-[11px] font-bold text-pill-ink">
                <span
                  aria-hidden
                  className="amen-breath h-1.5 w-1.5 rounded-full bg-gold"
                />
                Live
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-white/10 bg-pill px-2.5 py-0.5 text-[11px] font-bold text-muted">
                Preview stream
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted">
              <UsersIcon className="h-3.5 w-3.5" />
              <span className="font-bold tabular-nums text-espresso">
                {totals.total}
              </span>
              {totals.total === 1 ? "intercession" : "intercessions"} in view
            </span>
          </div>
        </div>

        {totals.byTopic.length === 0 ? null : (
          <ul className="mt-3 flex list-none flex-wrap gap-2">
            {totals.byTopic.map((tally) => (
              <li key={tally.topic}>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-slate-300">
                  {tally.topic}
                  <span aria-hidden className="tabular-nums text-gold">
                    {tally.count}
                  </span>
                  <span className="sr-only">
                    {tally.count === 1
                      ? "1 intercession"
                      : `${tally.count} intercessions`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {feed === null ? (
          <div role="status" aria-busy="true" className="mt-3 space-y-2">
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="h-11 animate-pulse rounded-2xl border border-white/10 bg-pill/60"
              />
            ))}
          </div>
        ) : (
          <ul className="mt-3 grid list-none grid-cols-1 gap-2 lg:grid-cols-2">
            <AnimatePresence mode="popLayout" initial={false}>
              {beacons.map((beacon) => (
                <BeaconRow
                  key={beacon.id}
                  beacon={beacon}
                  now={now}
                  fresh={freshId === beacon.id}
                  onPulseEnd={() =>
                    setFreshId((current) =>
                      current === beacon.id ? null : current,
                    )
                  }
                />
              ))}
            </AnimatePresence>
          </ul>
        )}

        {feed === null ? null : (
          <p className="mt-3 text-[11px] leading-5 text-muted">
            {source === "live"
              ? "Names stay private — a beacon shows the prayer, never the person."
              : "The live intercession stream is unavailable right now, so this is a preview of the community's pulse."}
          </p>
        )}

        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </section>
    </MotionConfig>
  );
}

