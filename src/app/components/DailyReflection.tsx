'use client';

import type { Reflection } from '@/lib/types';
import AudioPlayer from '@/app/components/AudioPlayer';

interface DailyReflectionProps {
  reflection: Reflection | null;
}

/**
 * Formats a `reflection_date` value into a human-readable date.
 * Date-only values (YYYY-MM-DD) are anchored to local midnight so the
 * displayed day does not shift backwards in negative UTC offsets.
 */
function formatReflectionDate(value: string): string {
  if (!value) return '';

  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(isDateOnly ? `${value}T00:00:00` : value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function DailyReflection({ reflection }: DailyReflectionProps) {
  if (!reflection) {
    return (
      <section className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <span className="inline-flex items-center rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
          Daily Bread
        </span>
        <h2 className="mt-4 text-xl font-semibold text-slate-900">
          No reflection available today
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Today&apos;s reflection has not been published yet. Please check back soon and keep
          abiding in His word.
        </p>
      </section>
    );
  }

  return (
    <article className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center rounded-full bg-teal-700 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
          Daily Bread
        </span>
        <time
          dateTime={reflection.reflection_date}
          className="text-sm font-medium text-slate-500"
        >
          {formatReflectionDate(reflection.reflection_date)}
        </time>
      </div>

      <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
        {reflection.title}
      </h2>
      <p className="mt-2 text-base font-semibold text-teal-700">
        {reflection.scripture_reference}
      </p>

      <p className="mt-5 whitespace-pre-line text-base leading-7 text-slate-700">
        {reflection.reflection_text}
      </p>

      <div className="mt-6">
        <p className="mb-3 text-sm font-semibold text-slate-800">Listen to the reflection</p>
        {/*
          Always rendered: the data layer normalises `audio_url` to the bundled
          MP3, and an empty value would still resolve to it inside the player -
          so a missing URL can never remove the player itself.
        */}
        <AudioPlayer src={reflection.audio_url ?? ''} title={reflection.title} />
      </div>
    </article>
  );
}
