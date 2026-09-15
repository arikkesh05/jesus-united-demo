import { FALLBACK_PULPIT_KIT } from '@/lib/pulpitKitFallback';
import { supabase } from '@/lib/supabase';
import type { PulpitKit, PulpitKitOutlinePoint } from '@/lib/types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function toOptionalText(value: unknown): string | null {
  const text = toText(value);
  return text === '' ? null : text;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/** Accepts a Postgres `text[]`, a JSON array string, or a delimited string. */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => toText(item)).filter((item) => item !== '');
  }

  if (typeof value !== 'string') return [];

  const trimmed = value.trim();
  if (trimmed === '') return [];

  if (trimmed.startsWith('[')) {
    const parsed = safeJson(trimmed);
    if (Array.isArray(parsed)) return toStringArray(parsed);
  }

  const withoutBraces =
    trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed.slice(1, -1) : trimmed;

  return withoutBraces
    .split(/","|\n|;/)
    .map((item) => item.replace(/^"|"$/g, '').trim())
    .filter((item) => item !== '');
}

/** Accepts `[{ section, subtext }]`, an array of strings, or a JSON string. */
function parseOutline(value: unknown): PulpitKitOutlinePoint[] {
  const items =
    Array.isArray(value) ? value : typeof value === 'string' ? safeJson(value.trim()) : undefined;

  if (!Array.isArray(items)) return [];

  return items
    .map((item): PulpitKitOutlinePoint | null => {
      if (typeof item === 'string') {
        const section = item.trim();
        return section === '' ? null : { section, subtext: '' };
      }

      if (isPlainObject(item)) {
        const section = toText(item.section ?? item.title ?? item.point ?? item.heading);
        if (section === '') return null;
        return {
          section,
          subtext: toText(item.subtext ?? item.detail ?? item.description ?? item.notes),
        };
      }

      return null;
    })
    .filter((point): point is PulpitKitOutlinePoint => point !== null);
}

/**
 * Normalises a Supabase row into a `PulpitKit`, tolerating schema drift such as
 * singular vs plural passage columns, text[] vs JSON, and missing optional fields.
 */
export function parsePulpitKitRow(raw: unknown): PulpitKit | null {
  if (!isPlainObject(raw)) return null;

  const id = toText(raw.id);
  const title = toText(raw.title);
  if (id === '' || title === '') return null;

  const estimatedMinutes = toFiniteNumber(raw.estimated_minutes ?? raw.duration_minutes);

  const kit: PulpitKit = {
    id,
    title,
    theme: toText(raw.theme ?? raw.series_name),
    series_name: toOptionalText(raw.series_name),
    scripture_passages: toStringArray(
      raw.scripture_passages ?? raw.scripture_passage ?? raw.passages,
    ),
    outline: parseOutline(raw.outline ?? raw.points),
    talking_points: toStringArray(raw.talking_points ?? raw.hooks),
    discussion_questions: toStringArray(raw.discussion_questions ?? raw.questions),
    key_quote: toOptionalText(raw.key_quote ?? raw.quote),
    call_to_action: toOptionalText(raw.call_to_action ?? raw.application),
    target_sunday: toText(raw.target_sunday ?? raw.published_at ?? raw.created_at),
    created_at: toText(raw.created_at),
  };

  if (estimatedMinutes !== undefined) kit.estimated_minutes = estimatedMinutes;

  return kit;
}

/**
 * Fetches the featured (latest) pulpit kit, falling back to the local kit when
 * the table is missing, empty, or unreachable.
 */
export async function getLatestPulpitKit(): Promise<PulpitKit | null> {
  try {
    const { data, error } = await supabase
      .from('pulpit_kits')
      .select('*')
      .order('target_sunday', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching pulpit kit, using local fallback kit:', error.message);
      return FALLBACK_PULPIT_KIT;
    }

    return parsePulpitKitRow(data) ?? FALLBACK_PULPIT_KIT;
  } catch (error) {
    console.error('Unexpected error fetching pulpit kit, using local fallback kit:', error);
    return FALLBACK_PULPIT_KIT;
  }
}