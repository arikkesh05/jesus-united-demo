'use client';

import { useMemo, useState } from 'react';
import GatheringCard from '@/app/components/GatheringCard';
import GatheringSubmissionModal from '@/app/components/GatheringSubmissionModal';
import { MapPinIcon, PlusIcon } from '@/app/components/icons';
import type { Gathering } from '@/lib/types';

interface GatheringMapProps {
  gatherings: Gathering[];
}

const METRO_LABEL = 'Austin, TX Metro';

/** Lower-cased haystack so the search box matches name, city/area, address, leader, or schedule. */
function buildSearchIndex(gathering: Gathering): string {
  return [
    gathering.name,
    gathering.address,
    gathering.leader_name,
    gathering.meeting_time,
    gathering.description ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

export default function GatheringMap({ gatherings }: GatheringMapProps) {
  const [query, setQuery] = useState('');
  const [submissionOpen, setSubmissionOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return gatherings;
    return gatherings.filter((gathering) => buildSearchIndex(gathering).includes(needle));
  }, [gatherings, query]);

  return (
    <div>
      <div className="flex flex-col gap-4 rounded-3xl border border-sand bg-white p-4 shadow-soft sm:flex-row sm:items-end sm:justify-between sm:p-5">
        <div className="w-full sm:max-w-xs">
          <label
            htmlFor="gathering-search"
            className="text-xs font-bold uppercase tracking-[0.18em] text-muted"
          >
            Find a gathering
          </label>
          <input
            id="gathering-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, city, or area"
            className="mt-2 w-full rounded-full border border-sand bg-canvas px-4 py-2.5 text-sm text-espresso outline-none transition placeholder:text-muted/70 focus:border-gold focus:ring-2 focus:ring-gold/25"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-pill px-3 py-1 text-xs font-bold text-pill-ink">
            <MapPinIcon className="h-3.5 w-3.5" />
            {METRO_LABEL}
          </span>
          <span className="text-xs font-medium text-muted">
            {filtered.length} of {gatherings.length} gatherings
          </span>
          <button
            type="button"
            onClick={() => setSubmissionOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-xs font-bold text-espresso transition hover:bg-gold-deep hover:shadow-md"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Submit a Gathering
          </button>
        </div>
      </div>

      {gatherings.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-sand bg-white p-8 text-center shadow-soft">
          <p className="text-sm font-bold text-espresso">No gatherings published yet</p>
          <p className="mt-1 text-sm leading-6 text-muted">
            New fellowships will appear here as soon as they are added to the map.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-sand bg-white p-8 text-center shadow-soft">
          <p className="text-sm font-bold text-espresso">
            No gatherings match &ldquo;{query.trim()}&rdquo;
          </p>
          <p className="mt-1 text-sm leading-6 text-muted">
            Try a different name, city, or area &mdash; or clear the search to browse them all.
          </p>
          <button
            type="button"
            onClick={() => setQuery('')}
            className="mt-4 inline-flex items-center justify-center rounded-full border border-sand bg-white px-4 py-2 text-xs font-bold text-espresso transition hover:border-gold hover:bg-pill"
          >
            Clear search
          </button>
        </div>
      ) : (
        <ul className="mt-6 grid list-none grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((gathering) => (
            <li key={gathering.id} className="flex">
              <GatheringCard gathering={gathering} />
            </li>
          ))}
        </ul>
      )}

      <GatheringSubmissionModal
        open={submissionOpen}
        onClose={() => setSubmissionOpen(false)}
      />
    </div>
  );
}