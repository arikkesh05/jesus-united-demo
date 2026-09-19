'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';

import {
  buildSearchIndex,
  moveSearchSelection,
  searchGlobeMarkers,
  searchStatusMessage,
} from '@/lib/globeSearch';
import type { GlobeSearchEntry, GlobeSearchResult } from '@/lib/globeSearch';
import { avatarStyleForSeed } from '@/lib/globeAvatars';
import type { GlobeMarker } from '@/lib/types';

/** A 16×16 magnifying-glass icon (no shared icon component is required). */
function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <circle cx={11} cy={11} r={8} />
      <line x1={21} y1={21} x2={15.637} y2={15.637} />
    </svg>
  );
}

/**
 * Props mirror MissionGlobe's selection contract: picking an ambassador from the
 * list drives the same `selectMarker(id)` path the scene uses for a direct tap,
 * so search results and cluster-pill clicks both open a formation smoothly.
 */
interface GlobeSearchProps {
  markers: readonly GlobeMarker[];
  /** Called with the marker chosen from the list. */
  onSelect: (marker: GlobeMarker) => void;
  /** Disables the control (e.g. while the scene is still loading). */
  disabled?: boolean;
}

const INPUT_DEBOUNCE_MS = 96;

/** Frosted-glass input, shared with the Refero motion-spec HUD tokens. */
const INPUT_CLASS =
  'peer w-full rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 pl-9 text-sm text-white placeholder-white/50 outline-none transition focus:border-cyan-300/60 focus:bg-white/15';

const TRIGGER_CLASS =
  'inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white backdrop-blur-xl transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300';

/**
 * A frosted-glass search overlay for the Mission Globe. Always shows a compact
 * "Search ⌘K" trigger in the stage's top-left; expanding opens a popover with
 * the input and ranked suggestions. Cmd+K / Ctrl+K toggles it from anywhere,
 * Escape closes it, and the up/down arrows + Enter mirror the globe's existing
 * keyboard navigation style.
 */
export default function GlobeSearch({ markers, onSelect, disabled }: GlobeSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  // The index is rebuilt only when the marker payload identity changes.
  const index = useMemo(() => buildSearchIndex(markers), [markers]);

  const result: GlobeSearchResult = useMemo(
    () => searchGlobeMarkers(index, query),
    [index, query],
  );

  const results = result.results;
  const count = results.length;

  // Focus the input shortly after the popover opens, off the pending paint.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Global Cmd+K / Ctrl+K to toggle, Escape to close — independent of focus.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (open) {
          event.preventDefault();
          setOpen(false);
        }
        return;
      }
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (disabled) return;
        setOpen((was) => !was);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, disabled]);

  const commit = (entry: GlobeSearchEntry) => {
    const marker = markers.find((m) => m.id === entry.id);
    if (marker) onSelect(marker);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setHighlighted((prev) => moveSearchSelection(prev, 1, count));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setHighlighted((prev) => moveSearchSelection(prev, -1, count));
        break;
      case 'Enter':
        event.preventDefault();
        if (highlighted >= 0 && highlighted < count) commit(results[highlighted]);
        break;
      case 'Escape':
        // Stop the event from bubbling to the stage container, whose own
        // Escape handler deselects the current ambassador — closing the search
        // should never change the selection.
        event.stopPropagation();
        event.preventDefault();
        if (query) {
          setQuery('');
        } else {
          setOpen(false);
        }
        break;
    }
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Reset the highlight on every keystroke so up/down always starts fresh.
    debounceRef.current = window.setTimeout(() => {
      setQuery(next);
      setHighlighted(0);
      debounceRef.current = null;
    }, INPUT_DEBOUNCE_MS);
  };

  const status = searchStatusMessage(result);
  const prompt = result.isEmptyQuery;

  return (
    <div className="relative w-64 sm:w-72">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? 'globe-search-list' : undefined}
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen((was) => !was); }}
        className={[TRIGGER_CLASS, open ? 'bg-white/15' : ''].join(' ')}
      >
        <SearchIcon className="h-3.5 w-3.5 text-cyan-300" />
        <span>Search</span>
        <kbd className="pointer-events-none hidden rounded bg-slate-800 px-1.5 py-px text-[10px] font-medium text-slate-300 sm:inline-block">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          role="search"
          aria-label="Search gatherings"
          className="absolute top-12 z-40 w-full overflow-hidden rounded-2xl border border-white/15 bg-slate-900/75 backdrop-blur-md shadow-[0_8px_32px_0_rgba(0,0,0,0.45)]"
        >
          <div className="relative">
            <input
              ref={inputRef}
              id="globe-search-input"
              type="search"
              value={query}
              onChange={onChange}
              onKeyDown={onKeyDown}
              placeholder={prompt ? 'Name, city, or count…' : undefined}
              aria-label="Search gatherings by name, city, or gathering count"
              aria-autocomplete="list"
              aria-controls={count > 0 ? 'globe-search-list' : undefined}
              className={INPUT_CLASS}
            />
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          </div>

          <ul
            id="globe-search-list"
            role="listbox"
            aria-label={status}
            className="max-h-64 overflow-y-auto py-1.5"
          >
            {!prompt && count === 0 ? (
              <li className="px-4 py-3 text-xs text-slate-400">{status}</li>
            ) : (
              results.map((entry, index) => {
                const active = index === highlighted;
                const avatar = avatarStyleForSeed(entry.id);
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setHighlighted(index)}
                      onClick={() => commit(entry)}
                      className={[
                        'flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-white',
                        'focus-visible:outline-none focus-visible:bg-white/5',
                        active
                          ? 'bg-cyan-300/15 font-medium text-cyan-50'
                          : 'hover:bg-white/5',
                      ].join(' ')}
                    >
                      <span
                        aria-hidden="true"
                        className="h-7 w-7 shrink-0 rounded-full border border-white/12 bg-center bg-cover"
                        style={{ backgroundImage: `url(${avatar.file})` }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{entry.name}</p>
                        <p className="truncate text-xs text-slate-300">{entry.city}</p>
                      </div>
                      <span
                        aria-hidden="true"
                        className="tabular-nums text-xs text-slate-400"
                      >
                        {entry.memberCount}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          <p className="pointer-events-none border-t border-white/8 px-4 py-1.5 text-[11px] leading-4 text-slate-400">
            {status}
          </p>
        </div>
      )}
    </div>
  );
}

