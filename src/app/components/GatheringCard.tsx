'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, MotionConfig } from 'framer-motion';
import {
  CalendarIcon,
  ChatIcon,
  CheckIcon,
  DirectionsIcon,
  MailIcon,
  MapPinIcon,
  UserIcon,
  UsersIcon,
} from '@/app/components/icons';
import {
  getAttendanceCount,
  hasLocalAttendance,
  recordAttendance,
} from '@/lib/gatheringsSubmissions';
import type { Gathering } from '@/lib/types';

interface GatheringCardProps {
  gathering: Gathering;
}

function buildWhatsAppHref(gathering: Gathering): string {
  const greeting = `Hi ${gathering.leader_name}, I found ${gathering.name} on JesusUnited and would love to know more about joining your gathering.`;
  return `https://wa.me/?text=${encodeURIComponent(greeting)}`;
}

function buildMapsHref(gathering: Gathering): string {
  const { latitude, longitude, address } = gathering;

  if (latitude !== undefined && longitude !== undefined) {
    return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function buildEmailHref(gathering: Gathering): string | null {
  if (!gathering.contact_email) return null;
  const subject = encodeURIComponent(`Question about ${gathering.name}`);
  return `mailto:${gathering.contact_email}?subject=${subject}`;
}

const secondaryLinkClass =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-white/10 bg-pill/70 px-3 py-2 text-xs font-bold text-slate-200 outline-none transition hover:border-gold/50 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-gold/50';

/** Formats a PostGIS-computed `distance_meters` into a short imperial badge. */
function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '';
  return `${(meters / 1609.34).toFixed(1)} mi away`;
}

/** Weekly-cadence gatherings read as fellowship; anything else is a micro-church. */
function resolveStatus(meetingTime: string): { label: string; tone: string } {
  if (/week|sun|mon|tue|wed|thu|fri|sat/i.test(meetingTime)) {
    return { label: 'Weekly Fellowship', tone: 'bg-emerald-400' };
  }
  return { label: 'Active Micro-Church', tone: 'bg-gold' };
}

const PULSE_DURATION_MS = 900;

export default function GatheringCard({ gathering }: GatheringCardProps) {
  const emailHref = buildEmailHref(gathering);
  const distanceLabel =
    gathering.distance_meters !== undefined ? formatDistance(gathering.distance_meters) : '';

  const [attendanceCount, setAttendanceCount] = useState<number | null>(null);
  const [attended, setAttended] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pulsing, setPulsing] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const pulseTimer = useRef<number | null>(null);

  // Counts are fetched client-side only: the prerendered HTML renders the
  // neutral "—" badge, so server and first client render always match.
  useEffect(() => {
    let active = true;
    void getAttendanceCount(gathering.id).then((value) => {
      if (active) setAttendanceCount(value);
    });
    void hasLocalAttendance(gathering.id).then((value) => {
      if (active) setAttended(value);
    });
    return () => {
      active = false;
    };
  }, [gathering.id]);

  useEffect(
    () => () => {
      if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
    },
    []
  );

  const triggerPulse = () => {
    setPulsing(true);
    setPulseKey((key) => key + 1);
    if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
    pulseTimer.current = window.setTimeout(() => setPulsing(false), PULSE_DURATION_MS);
  };

  const handleAttendance = async () => {
    if (busy || attended) return;
    setBusy(true);
    setAttended(true);
    setAttendanceCount((value) => (value ?? 0) + 1);
    triggerPulse();

    const result = await recordAttendance(gathering.id);
    if (result.ok) {
      setNotice(
        result.mode === 'cloud' ? 'You are counted — see you there!' : 'Counted on this device.'
      );
    } else {
      setAttended(false);
      setAttendanceCount((value) => (value === null ? null : Math.max(0, value - 1)));
      setNotice('We could not count you just now — please try again.');
    }
    setBusy(false);
  };

  const countLabel = attendanceCount ?? 0;
  const status = resolveStatus(gathering.meeting_time);

  return (
    <MotionConfig reducedMotion="user">
      <motion.article
        whileHover={{ y: -4 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="relative flex w-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-pill/75 p-6 shadow-xl backdrop-blur-2xl"
      >
        {/* Specular edge highlight — Layers-style glass rim light */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/10"
        />

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-200">
            <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
              <span
                className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:animate-none ${status.tone}`}
              />
              <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${status.tone}`} />
            </span>
            {status.label}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-gold/10 px-2 py-0.5 text-[11px] font-extrabold tabular-nums text-gold">
            <UsersIcon className="h-3 w-3" />
            {countLabel} gathered
          </span>
        </div>

        <h3 className="mt-3 text-base font-bold leading-6 text-espresso">{gathering.name}</h3>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-pill/70 px-2.5 py-1 text-xs font-bold text-slate-200">
            <CalendarIcon className="h-3.5 w-3.5 text-gold" />
            {gathering.meeting_time}
          </span>
          {distanceLabel ? (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-pill/70 px-2.5 py-1 text-xs font-bold text-slate-200">
              <MapPinIcon className="h-3.5 w-3.5 text-gold" />
              {distanceLabel}
            </span>
          ) : null}
        </div>

        {gathering.description ? (
          <p className="mt-3 text-sm leading-6 text-muted">{gathering.description}</p>
        ) : null}

        <dl className="mt-3 space-y-1.5 text-sm text-slate-200">
          <div className="flex items-start gap-2">
            <dt className="sr-only">Address</dt>
            <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
            <dd className="leading-6">{gathering.address}</dd>
          </div>
          <div className="flex items-start gap-2">
            <dt className="sr-only">Hosted by</dt>
            <UserIcon className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
            <dd className="leading-6">{gathering.leader_name}</dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-1 flex-col justify-end gap-2">
          <motion.button
            type="button"
            onClick={handleAttendance}
            disabled={busy || attended}
            aria-pressed={attended}
            aria-label={
              attended
                ? `You attended ${gathering.name} — ${countLabel} ${
                    countLabel === 1 ? 'person' : 'people'
                  } counted`
                : `Count me as attending ${gathering.name}`
            }
            whileTap={attended ? undefined : { scale: 0.96 }}
            whileHover={attended ? undefined : { y: -1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className={
              attended
                ? 'relative inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full border border-gold/60 bg-gold/10 px-4 py-2.5 text-sm font-bold text-gold'
                : 'relative inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-bold text-espresso outline-none transition hover:border-gold/50 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-gold/50 disabled:cursor-not-allowed disabled:opacity-70'
            }
          >
            {pulsing ? (
              <span
                key={pulseKey}
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-full bg-gold/30 motion-safe:animate-ping"
              />
            ) : null}
            <motion.span
              key={attended ? 'attended' : 'idle'}
              initial={{ scale: 0.6, rotate: attended ? -12 : 0 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 18 }}
              className="inline-flex"
              aria-hidden
            >
              {attended ? <CheckIcon className="h-4 w-4" /> : <UsersIcon className="h-4 w-4" />}
            </motion.span>
            {attended ? 'You attended' : 'I attended'}
            <span
              aria-hidden
              className="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-xs font-extrabold tabular-nums text-pill-ink"
            >
              {attendanceCount === null ? '—' : countLabel}
            </span>
          </motion.button>
          <p role="status" className="h-4 text-center text-xs text-muted">
            {notice ?? ''}
          </p>

          <motion.a
            href={buildWhatsAppHref(gathering)}
            target="_blank"
            rel="noopener noreferrer"
            whileTap={{ scale: 0.96 }}
            whileHover={{ y: -1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-gold px-4 py-2.5 text-sm font-bold text-canvas shadow-lg shadow-gold/20 outline-none transition hover:bg-gold-deep focus-visible:ring-2 focus-visible:ring-gold/50"
          >
            <ChatIcon className="h-4 w-4" />
            Connect via WhatsApp
          </motion.a>

          <div className="grid grid-cols-2 gap-2">
            {emailHref ? (
              <a href={emailHref} className={secondaryLinkClass}>
                <MailIcon className="h-4 w-4 text-gold" />
                Email
              </a>
            ) : null}
            <a
              href={buildMapsHref(gathering)}
              target="_blank"
              rel="noopener noreferrer"
              className={secondaryLinkClass}
            >
              <DirectionsIcon className="h-4 w-4 text-gold" />
              Google Maps
            </a>
          </div>
        </div>
      </motion.article>
    </MotionConfig>
  );
}