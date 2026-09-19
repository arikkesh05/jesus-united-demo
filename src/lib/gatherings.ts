import { sanitizeToCentroidWithJitter } from '@/lib/globe';
import { supabase } from '@/lib/supabase';
import type { Gathering, GlobeMarker } from '@/lib/types';

/**
 * A row as returned by PostgREST before it is normalised into a `Gathering`.
 * The PostGIS `location` column arrives differently depending on how the query
 * is shaped: usually an EWKB hex string (e.g. "0101000020E6100000..."), but a
 * GeoJSON object, a WKT string, a coordinate array, or a nested object are all
 * possible. Coordinates are therefore resolved defensively.
 */
type RawRow = Record<string, unknown>;

interface Coordinates {
  latitude: number;
  longitude: number;
}

const MAX_PARSE_DEPTH = 4;
const MIN_WKB_HEX_LENGTH = 42; // 21 bytes: byte order + geometry type + X + Y
const COORDINATE_KEYS = [
  'location',
  'geography',
  'geom',
  'geometry',
  'coordinates',
  'point',
  'coords',
  'the_geom',
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function firstFinite(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function toStringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function toNullableString(value: unknown): string | null {
  const text = toStringValue(value);
  return text === '' ? null : text;
}

function readNamedCoordinates(record: RawRow): Coordinates | undefined {
  const latitude = firstFinite(record.latitude, record.lat, record.y);
  const longitude = firstFinite(record.longitude, record.lng, record.lon, record.x);
  if (latitude === undefined || longitude === undefined) return undefined;
  return { latitude, longitude };
}

function hexToBytes(hex: string): Uint8Array | undefined {
  if (hex.length === 0 || hex.length % 2 !== 0) return undefined;

  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    if (Number.isNaN(byte)) return undefined;
    bytes[index] = byte;
  }
  return bytes;
}

/**
 * Decodes a PostGIS EWKB/WKB hex point into { latitude, longitude }.
 * Returns `undefined` for any other geometry type or malformed payload.
 */
function parseWkbPoint(hex: string): Coordinates | undefined {
  const bytes = hexToBytes(hex);
  if (!bytes || bytes.length < 21) return undefined;

  const byteOrder = bytes[0];
  if (byteOrder !== 0 && byteOrder !== 1) return undefined;

  const littleEndian = byteOrder === 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const typeWord = view.getUint32(1, littleEndian);
  const geometryType = typeWord & 0x0fffffff; // strip Z / M / SRID flags
  if (geometryType !== 1) return undefined; // 1 = Point

  let offset = 5;
  if ((typeWord & 0x20000000) !== 0) offset += 4; // skip the embedded SRID
  if (offset + 16 > bytes.length) return undefined;

  const longitude = view.getFloat64(offset, littleEndian);
  const latitude = view.getFloat64(offset + 8, littleEndian);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;

  return { latitude, longitude };
}

function parseCoordinateString(text: string): Coordinates | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;

  const hex = trimmed.replace(/^\\x/i, '');
  if (hex.length >= MIN_WKB_HEX_LENGTH && /^[0-9a-f]+$/i.test(hex)) {
    const decoded = parseWkbPoint(hex);
    if (decoded) return decoded;
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return parseCoordinates(JSON.parse(trimmed) as unknown, 1);
    } catch {
      return undefined;
    }
  }

  const wkt = /POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/i.exec(trimmed);
  if (wkt) {
    const longitude = toFiniteNumber(wkt[1]);
    const latitude = toFiniteNumber(wkt[2]);
    if (latitude !== undefined && longitude !== undefined) return { latitude, longitude };
  }

  return undefined;
}

/**
 * Recursively resolves coordinates from arrays (GeoJSON order: [lng, lat]),
 * objects, JSON strings, WKB hex, and WKT strings without ever throwing.
 */
function parseCoordinates(value: unknown, depth = 0): Coordinates | undefined {
  if (value === null || value === undefined || depth > MAX_PARSE_DEPTH) return undefined;

  if (typeof value === 'string') return parseCoordinateString(value);

  if (Array.isArray(value)) {
    const longitude = value.length > 0 ? toFiniteNumber(value[0]) : undefined;
    const latitude = value.length > 1 ? toFiniteNumber(value[1]) : undefined;
    if (latitude !== undefined && longitude !== undefined) return { latitude, longitude };

    for (const item of value) {
      const nested = parseCoordinates(item, depth + 1);
      if (nested) return nested;
    }
    return undefined;
  }

  if (isPlainObject(value)) {
    const named = readNamedCoordinates(value);
    if (named) return named;

    for (const key of Object.keys(value)) {
      const nested = parseCoordinates(value[key], depth + 1);
      if (nested) return nested;
    }
    return undefined;
  }

  return undefined;
}

function extractCoordinates(raw: RawRow): Partial<Coordinates> {
  const named = readNamedCoordinates(raw);
  if (named) return named;

  for (const key of COORDINATE_KEYS) {
    if (!(key in raw)) continue;
    const parsed = parseCoordinates(raw[key]);
    if (parsed) return parsed;
  }

  for (const value of Object.values(raw)) {
    const parsed = parseCoordinates(value, 1);
    if (parsed) return parsed;
  }

  return {};
}

/**
 * Normalises a raw Supabase row into a `Gathering`. Returns `null` for rows that
 * cannot be used (not an object / missing id) instead of throwing.
 */
function parseGatheringRow(raw: unknown): Gathering | null {
  if (!isPlainObject(raw)) return null;

  const id = toStringValue(raw.id);
  if (id === '') return null;

  const { latitude, longitude } = extractCoordinates(raw);
  const distanceMeters = toFiniteNumber(raw.distance_meters);

  const gathering: Gathering = {
    id,
    name: toStringValue(raw.name),
    description: toNullableString(raw.description),
    leader_name: toStringValue(raw.leader_name),
    contact_email: toNullableString(raw.contact_email),
    meeting_time: toStringValue(raw.meeting_time),
    address: toStringValue(raw.address),
    created_at: toStringValue(raw.created_at),
  };

  if (latitude !== undefined) gathering.latitude = latitude;
  if (longitude !== undefined) gathering.longitude = longitude;
  if (distanceMeters !== undefined) gathering.distance_meters = distanceMeters;

  return gathering;
}

/**
 * Fetches every church gathering, ordered by name. PostGIS `location` values are
 * decoded into `latitude`/`longitude`. Returns an empty array on any failure.
 */
export async function getGatherings(): Promise<Gathering[]> {
  const { data, error } = await supabase
    .from('gatherings')
    .select('*')
    .order('name', { ascending: true });

  if (error) {
    console.error('Error fetching gatherings:', error.message);
    return [];
  }

  if (!Array.isArray(data)) return [];

  const gatherings: Gathering[] = [];
  for (const row of data as unknown[]) {
    try {
      const gathering = parseGatheringRow(row);
      if (gathering) gatherings.push(gathering);
    } catch (parseError) {
      console.error('Skipping unparseable gathering row:', parseError);
    }
  }

  return gatherings;
}

// ---------------------------------------------------------------------------
// Phase 2 — Task 3.1: privacy-preserving public globe markers.
// ---------------------------------------------------------------------------

/**
 * Result of `getPublicGatheringMarkers`. Failures are reported as data (never
 * thrown) so the globe can render an error state instead of crashing.
 */
export type PublicGatheringMarkersResult =
  | { ok: true; data: GlobeMarker[] }
  | { ok: false; data: []; error: string };

/** Upper bound on the public marker payload (keeps the WebGL scene bounded). */
const PUBLIC_MARKER_LIMIT = 500;

/** Titles stripped from `leader_name` so only a first name is published. */
const NAME_HONORIFICS = new Set([
  'apostle',
  'bishop',
  'bro',
  'brother',
  'deacon',
  'dr',
  'elder',
  'evangelist',
  'father',
  'fr',
  'minister',
  'miss',
  'mr',
  'mrs',
  'ms',
  'pastor',
  'prophet',
  'ps',
  'rev',
  'reverend',
  'saint',
  'sis',
  'sister',
  'st',
]);

const POSTAL_CODE_PATTERN = /\b\d{4,}(?:-\d{4})?\b/g;

/**
 * Resolves a low-precision public city label.
 *
 * City-level data is inherently non-identifying, so an explicit `city` column is
 * always preferred. When only a street address is available the label is taken
 * from the segments that follow the first comma (never the street line itself)
 * and rejected outright if any digits remain — so a house number, postal code
 * or single-line street address can never leak into the payload.
 */
function derivePublicCity(raw: RawRow): string {
  const explicit =
    toNullableString(raw.city) ?? toNullableString(raw.town) ?? toNullableString(raw.locality);
  if (explicit !== null && explicit.trim() !== '') return explicit.trim();

  const address = toStringValue(raw.address);
  if (address === '') return '';

  const segments = address
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');

  for (let index = 1; index < segments.length; index += 1) {
    const candidate = segments[index].replace(POSTAL_CODE_PATTERN, '').replace(/\s+/g, ' ').trim();
    if (candidate !== '' && !/\d/.test(candidate)) return candidate;
  }

  return '';
}

/** Publishes only the leader's first name (honorifics and surnames removed). */
function parsePublicFirstName(leaderName: string): string {
  const tokens = leaderName
    .replace(/[.,;:()]/g, ' ')
    .split(/\s+/)
    .filter((token) => token !== '');
  if (tokens.length === 0) return '';
  if (tokens.length === 1 && NAME_HONORIFICS.has(tokens[0].toLowerCase())) return '';

  let index = 0;
  while (index < tokens.length - 1 && NAME_HONORIFICS.has(tokens[index].toLowerCase())) {
    index += 1;
  }

  return (tokens[index] ?? '').replace(/[^A-Za-z'’-]/g, '');
}

/** Community size for the marker, falling back to a single believer. */
function parseMemberCount(raw: RawRow): number {
  const value = firstFinite(
    raw.member_count,
    raw.members_count,
    raw.attendance_count,
    raw.check_in_count,
  );
  if (value === undefined) return 1;
  const count = Math.floor(value);
  return count >= 1 ? count : 1;
}

/**
 * Maps one `gatherings` row to a public marker. Returns `null` for rows that are
 * unusable (no id, no resolvable coordinates, or a non-approved status).
 */
function parsePublicMarkerRow(raw: unknown): GlobeMarker | null {
  if (!isPlainObject(raw)) return null;

  const id = toStringValue(raw.id);
  if (id === '') return null;

  // `gatherings` only ever receives moderator-approved rows today; this gate
  // protects a future schema where a status column exists.
  const status = toNullableString(raw.status);
  if (status !== null && status.trim().toLowerCase() !== 'approved') return null;

  const { latitude, longitude } = extractCoordinates(raw);
  if (latitude === undefined || longitude === undefined) return null;

  const centroid = sanitizeToCentroidWithJitter(latitude, longitude, id);

  return {
    id,
    city: derivePublicCity(raw),
    first_name: parsePublicFirstName(toStringValue(raw.leader_name)),
    member_count: parseMemberCount(raw),
    lat: centroid.lat,
    lng: centroid.lng,
  };
}

interface PublicRowsResult {
  rows: unknown[];
  error: string | null;
}

/** PostgREST/Postgres `undefined_column` SQLSTATE (42703). */
const UNDEFINED_COLUMN_CODE = '42703';

/** True when the error is Postgres reporting an unknown column (SQLSTATE 42703). */
function isMissingColumnError(error: { code?: string | null; message?: string | null }): boolean {
  if (error.code === UNDEFINED_COLUMN_CODE) return true;
  const message = (error.message ?? '').toLowerCase();
  return message.includes('column') && message.includes('does not exist');
}

/**
 * Whether `gatherings` exposes a `status` column in this environment.
 *
 * Probed at most once per process. The absent case is an expected schema
 * difference rather than a failure, so it is cached silently instead of warned
 * about on every read: the homepage calls this during static prerender, so an
 * unconditional warning printed on every build.
 */
type StatusColumnSupport = 'unknown' | 'supported' | 'absent';
let statusColumnSupport: StatusColumnSupport = 'unknown';

/**
 * Reads published gatherings, newest first and bounded.
 *
 * `gatherings` is the published table — `moderate_gathering()` is its only
 * writer and it inserts already-approved rows — so the deployed schema has no
 * `status` column (that column lives on `gathering_submissions`). A status
 * filter is still attempted while support is unknown, so a schema that does add
 * one is honoured; an unknown-column rejection is remembered and the read falls
 * back to an unfiltered query against the same approved-only table.
 * `parsePublicMarkerRow` re-checks any `status` value that does come back, so
 * the fallback can never publish a non-approved row.
 */
async function fetchPublishedRows(): Promise<PublicRowsResult> {
  const selectGatherings = () => supabase.from('gatherings').select('*');

  const readUnfiltered = async (): Promise<PublicRowsResult> => {
    const result = await selectGatherings()
      .order('created_at', { ascending: false })
      .limit(PUBLIC_MARKER_LIMIT);
    if (result.error) return { rows: [], error: result.error.message };
    return { rows: Array.isArray(result.data) ? result.data : [], error: null };
  };

  // The capability is already known to be absent: skip the doomed probe.
  if (statusColumnSupport === 'absent') return readUnfiltered();

  const primary = await selectGatherings()
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(PUBLIC_MARKER_LIMIT);
  if (!primary.error) {
    statusColumnSupport = 'supported';
    return { rows: Array.isArray(primary.data) ? primary.data : [], error: null };
  }

  if (isMissingColumnError(primary.error)) {
    // Expected on the deployed schema: remember it and stay quiet.
    statusColumnSupport = 'absent';
  } else {
    console.warn(
      'Status-filtered gathering read failed, retrying without the filter:',
      primary.error.message,
    );
  }

  return readUnfiltered();
}

/**
 * Public, privacy-preserving marker feed for the 3D globe.
 *
 * Returns only what the globe needs to render (`id`, `city`, `first_name`,
 * `member_count`) plus deterministic jittered centroids. Street addresses,
 * meeting schedules, emails and full leader identities never leave this
 * function. Failures resolve to `{ ok: false, data: [], error }`, never throw.
 */
export async function getPublicGatheringMarkers(): Promise<PublicGatheringMarkersResult> {
  try {
    const { rows, error } = await fetchPublishedRows();
    if (error !== null) {
      console.error('Error fetching public gathering markers:', error);
      return { ok: false, data: [], error };
    }

    const markers: GlobeMarker[] = [];
    for (const row of rows) {
      try {
        const marker = parsePublicMarkerRow(row);
        if (marker) markers.push(marker);
      } catch (parseError) {
        console.error('Skipping unparseable public marker row:', parseError);
      }
    }

    return { ok: true, data: markers };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The gathering feed is unavailable.';
    console.error('Public gathering marker read failed:', message);
    return { ok: false, data: [], error: message };
  }
}
