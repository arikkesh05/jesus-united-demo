import { supabase } from '@/lib/supabase';
import type { Gathering } from '@/lib/types';

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
