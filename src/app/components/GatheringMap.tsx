'use client';

import { useMemo, useState } from 'react';
import GatheringCard from '@/app/components/GatheringCard';
import { MapPinIcon } from '@/app/components/icons';
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

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return gatherings;
    return gatherings.filter((gathering) => buildSearchIndex(gathering).includes(needle));
  }, [gatherings, query]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <label
            htmlFor="gathering-search"
            className="text-xs font-semibold uppercase tracking-widest text-slate-500"
          >
            Find a gathering
          </label>
          <input
            id="gathering-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, city, or area"
            className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700">
            <MapPinIcon className="h-3.5 w-3.5" />
            {METRO_LABEL}
          </span>
          <span className="text-xs font-medium text-slate-500">
            {filtered.length} of {gatherings.length} gatherings
          </span>
        </div>
      </div>

      {gatherings.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <p className="text-sm font-semibold text-slate-800">No gatherings published yet</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            New fellowships will appear here as soon as they are added to the map.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <p className="text-sm font-semibold text-slate-800">
            No gatherings match &ldquo;{query.trim()}&rdquo;
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Try a different name, city, or area &mdash; or clear the search to browse them all.
          </p>
          <button
            type="button"
            onClick={() => setQuery('')}
            className="mt-4 inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Clear search
          </button>
        </div>
      ) : (
        <ul className="mt-6 grid list-none gap-5 sm:grid-cols-2">
          {filtered.map((gathering) => (
            <li key={gathering.id} className="flex">
              <GatheringCard gathering={gathering} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}