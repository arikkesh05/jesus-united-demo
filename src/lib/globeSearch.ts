/**
 * Global search core for the Mission Globe: a pure, framework-free index and
 * query engine so the overlay's behaviour (filtering, ranking, keyboard
 * navigation, empty states) is unit-testable without a DOM or a GPU.
 *
 * Only a type-only import is used, so the module has no runtime dependencies
 * and can be evaluated in the node:test sandbox exactly as written.
 */

import type { GlobeMarker } from '@/lib/types';

/** Maximum number of suggestions offered at once. */
export const SEARCH_RESULT_LIMIT = 8;

/** Fallback display name for a marker whose first name is missing/blank. */
export const SEARCH_FALLBACK_NAME = 'Ambassador';

/**
 * Generic words that describe the whole index rather than any one entry. They
 * are stripped from a query so "3 gatherings" narrows to a count of 3 instead of
 * matching every marker, and a lone "gatherings" query is treated as empty.
 */
export const SEARCH_IGNORED_TOKENS: readonly string[] = ['gathering', 'gatherings'];

/** One searchable ambassador, with its pre-folded fields ready for matching. */
export interface GlobeSearchEntry {
  /** Marker id — the argument handed to `selectMarker()`. */
  id: string;
  /** Display name (never blank). */
  name: string;
  /** Display city. */
  city: string;
  /** Gathering size for this marker, searchable as a digit token. */
  memberCount: number;
  /** Folded haystack: name, city and count joined for substring matching. */
  haystack: string;
  /** Folded individual name words (used for prefix ranking). */
  nameTokens: string[];
  /** Folded individual city words (used for prefix ranking). */
  cityTokens: string[];
}

/** The outcome of one query against the index. */
export interface GlobeSearchResult {
  /** The raw query as typed. */
  query: string;
  /** Folded, noise-stripped tokens that were actually matched. */
  tokens: string[];
  /** Ranked matches, capped at `SEARCH_RESULT_LIMIT`. */
  results: GlobeSearchEntry[];
  /** True when the query carries no meaningful tokens (the prompt state). */
  isEmptyQuery: boolean;
  /** Total matches before the cap was applied. */
  total: number;
  /** True when `total` exceeded the cap. */
  truncated: boolean;
}

/**
 * Folds text for case- and accent-insensitive matching: Unicode NFD, combining
 * diacritics stripped, lower-cased, and inner whitespace collapsed. "San José"
 * and "san jose" therefore fold to the same string.
 */
export function foldSearchText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Splits a query into folded tokens, dropping separators and the generic
 * "gathering(s)" noise words. Order is preserved and duplicates collapse, so
 * "Austin austin" matches once rather than double-scoring.
 */
export function tokenizeSearchQuery(query: unknown): string[] {
  const folded = foldSearchText(query);
  if (folded === '') return [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of folded.split(/[\s,]+/)) {
    if (raw === '' || SEARCH_IGNORED_TOKENS.includes(raw) || seen.has(raw)) continue;
    seen.add(raw);
    tokens.push(raw);
  }
  return tokens;
}

/** Display name for a marker, never blank. */
export function searchEntryName(marker: Pick<GlobeMarker, 'first_name'>): string {
  const name = typeof marker?.first_name === 'string' ? marker.first_name.trim() : '';
  return name === '' ? SEARCH_FALLBACK_NAME : name;
}

/**
 * Builds the index in payload order. Every entry is folded once here so a
 * keystroke only ever compares pre-folded strings.
 */
export function buildSearchIndex(markers: readonly GlobeMarker[]): GlobeSearchEntry[] {
  const list = Array.isArray(markers) ? markers : [];
  return list.map((marker) => {
    const name = searchEntryName(marker);
    const city = typeof marker?.city === 'string' ? marker.city.trim() : '';
    const memberCount = Number.isFinite(marker?.member_count) ? marker.member_count : 0;
    const foldedName = foldSearchText(name);
    const foldedCity = foldSearchText(city);
    return {
      id: marker.id,
      name,
      city,
      memberCount,
      haystack: `${foldedName} ${foldedCity} ${memberCount}`.trim(),
      nameTokens: foldedName === '' ? [] : foldedName.split(' '),
      cityTokens: foldedCity === '' ? [] : foldedCity.split(' '),
    };
  });
}

/**
 * Ranking score for one entry: a name prefix beats a city prefix, which beats a
 * mid-string or count hit; an exact full-name query gets an extra nudge. Lower
 * is better. Scores are integers, so ordering stays stable and reproducible.
 */
function scoreSearchEntry(
  entry: GlobeSearchEntry,
  tokens: readonly string[],
  foldedQuery: string,
): number {
  let score = 0;
  for (const token of tokens) {
    if (entry.nameTokens.some((word) => word.startsWith(token))) continue;
    score += entry.cityTokens.some((word) => word.startsWith(token)) ? 1 : 2;
  }
  if (foldedQuery !== '' && entry.nameTokens.join(' ') === foldedQuery) score -= 1;
  return score;
}

/**
 * Runs a query against the index. Every token must match (AND semantics), and
 * results are ranked by `scoreSearchEntry` with the payload order as a
 * deterministic tie-break, then capped at `limit`.
 *
 * An empty or noise-only query returns the prompt state (`isEmptyQuery: true`)
 * with no results rather than everything.
 */
export function searchGlobeMarkers(
  index: readonly GlobeSearchEntry[],
  query: unknown,
  limit: number = SEARCH_RESULT_LIMIT,
): GlobeSearchResult {
  const list = Array.isArray(index) ? index : [];
  const raw = typeof query === 'string' ? query : '';
  const tokens = tokenizeSearchQuery(raw);
  const max = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : SEARCH_RESULT_LIMIT;

  if (tokens.length === 0) {
    return {
      query: raw,
      tokens: [],
      results: [],
      isEmptyQuery: true,
      total: 0,
      truncated: false,
    };
  }

  const foldedQuery = tokens.join(' ');
  const matches: { entry: GlobeSearchEntry; score: number; order: number }[] = [];
  list.forEach((entry, order) => {
    if (!entry) return;
    if (!tokens.every((token) => entry.haystack.includes(token))) return;
    matches.push({ entry, score: scoreSearchEntry(entry, tokens, foldedQuery), order });
  });

  matches.sort((a, b) => (a.score - b.score) || (a.order - b.order));

  return {
    query: raw,
    tokens,
    results: matches.slice(0, max).map((match) => match.entry),
    isEmptyQuery: false,
    total: matches.length,
    truncated: matches.length > max,
  };
}

/**
 * Moves the highlighted suggestion by `delta`, wrapping around the ends so
 * arrow keys cycle. A negative `current` (nothing highlighted yet) enters the
 * list from the appropriate end. Returns -1 when there is nothing to highlight.
 */
export function moveSearchSelection(current: number, delta: number, count: number): number {
  const total = Number.isFinite(count) ? Math.floor(count) : 0;
  if (total <= 0) return -1;
  const step = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  const from = Number.isFinite(current) ? Math.trunc(current) : -1;
  if (from < 0 || from >= total) return step < 0 ? total - 1 : 0;
  return (((from + step) % total) + total) % total;
}

/** Human copy for a result row's secondary line, e.g. "Austin · 3 Gatherings". */
export function formatSearchResultMeta(entry: GlobeSearchEntry): string {
  const count = Math.max(0, Math.floor(Number.isFinite(entry?.memberCount) ? entry.memberCount : 0));
  const plural = `${count} Gathering${count === 1 ? '' : 's'}`;
  const city = typeof entry?.city === 'string' ? entry.city.trim() : '';
  return city === '' ? plural : `${city} · ${plural}`;
}

/**
 * Status line shown under the input: the prompt for an empty query, the
 * no-match copy, or a result tally (noting when the list was capped).
 */
export function searchStatusMessage(result: GlobeSearchResult): string {
  if (!result || result.isEmptyQuery) return 'Type a name, city, or gathering count.';
  if (result.total === 0) return `No ambassadors match "${result.query.trim()}".`;
  if (result.truncated) return `${result.total} matches — showing the top ${result.results.length}.`;
  return `${result.total} ${result.total === 1 ? 'match' : 'matches'}.`;
}

/** Accessible label for one suggestion row. */
export function searchOptionLabel(entry: GlobeSearchEntry): string {
  return `${entry.name}, ${formatSearchResultMeta(entry)}`;
}
