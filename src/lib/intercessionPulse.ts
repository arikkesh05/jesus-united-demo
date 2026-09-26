import { createClient } from "@/lib/supabaseBrowser";

/**
 * Sprint 2 — Community Intercession Pulse (pure core + fail-open feed).
 *
 * The wall's "I Prayed" interaction was Phase 1; this module adds the pulse
 * around it, in four separable pieces so every rule is testable without a DOM:
 *
 * - **Drop-in sanitising** (`sanitizeDropInDraft`, `deriveDropInTitle`): a
 *   one-field quick share is normalised and privacy-screened *before* it can
 *   reach the wall. Control/zero-width/bidi characters are stripped, whitespace
 *   is collapsed, lengths are capped, and phone numbers, emails, links and
 *   @handles are refused — the wall is public, so the client never lets a
 *   visitor publish someone's contact details. (The database still moderates;
 *   this is the first gate, not the only one.)
 * - **Pulse gate** (`createPulseGate`): a sliding-window rate limit so an
 *   excited tap-tap-tap cannot inflate a counter or hammer the cloud. Pure
 *   timestamps in, decisions out — the component owns the clock.
 * - **Beacon stream** (`fetchIntercessionBeacons`): the live feed of recent
 *   intercessions, with a *deterministic* bundled preview stream as the
 *   fail-open floor. It never rejects and it never renders blank: when the
 *   table is empty, RLS hides the rows, or Supabase is unreachable, the feed
 *   says so (`source: "preview"`) instead of erroring.
 * - **Event bridge** (`AMEN_PULSE_EVENT`): a local Amen is announced on the
 *   window so the Watchman hero can answer with its shipped `ThumbsUp` gesture
 *   (`src/lib/watchmanStage.ts`) and the beacon feed can log it, without either
 *   module importing the other.
 *
 * Privacy stance in the beacon model: live beacons carry a prayer title and a
 * topic, never a name, a location or a contact — a location label exists only on
 * simulated preview entries, which is why the type allows it and the live
 * mapper refuses to populate it.
 */

// ---------------------------------------------------------------------------
// Drop-in topics & sanitising
// ---------------------------------------------------------------------------

/** The five topics the drop-in dialog offers — the pulse's own curation. */
export const DROP_IN_TOPICS: readonly string[] = [
  "Healing",
  "Guidance",
  "Family",
  "Praise",
  "Peace",
];

/** A quick share is a sentence or two, not an essay. */
export const DROP_IN_BODY_MIN = 8;
export const DROP_IN_BODY_MAX = 320;
export const DROP_IN_NAME_MAX = 40;
const DROP_IN_TITLE_MAX = 72;

/** Raw dialog values, exactly as typed. */
export interface DropInDraft {
  body: string;
  authorName: string;
  anonymous: boolean;
  topics: string[];
}

/** The normalised share that is safe to publish. */
export interface DropInSanitized {
  body: string;
  author_name: string;
  topics: string[];
}

export interface DropInErrors {
  body?: string;
  authorName?: string;
  topics?: string;
}

export interface DropInValidation {
  ok: boolean;
  values: DropInSanitized;
  errors: DropInErrors;
}

/** Insert payload for `prayer_requests` minus the resolved `user_id`. */
export interface DropInPrayerPayload {
  author_name: string;
  title: string;
  body: string;
  topics: string[];
  is_public: true;
  is_answered: false;
  answered_note: null;
}

/**
 * Strips what must never reach the wall — C0/C1 control characters, zero-width
 * joiners and bidi overrides (which can visually scramble a shared prayer) —
 * then collapses every whitespace run to a single space so a pasted paragraph
 * cannot smuggle a wall of blank lines into a compact card.
 */
export function sanitizeDropInText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const URL_PATTERN = /(https?:\/\/|www\.)\S+/i;
const HANDLE_PATTERN = /(^|\s)@[a-z0-9_.]{2,}/i;
/**
 * A phone number is a run of at least nine digits carrying a separator or a
 * leading `+`: `+44 7700 900123`, `(555) 123-4567`, `555.123.4567`. The digit
 * floor matters — it keeps a Scripture reference (`1 Peter 5:7`) or a date
 * (`2026-09-30`, eight digits) from being mistaken for a contact detail.
 */
const PHONE_PATTERN = /\+\d[\d\s().-]{7,}\d|\d[\d\s().-]{7,}\d/;

function hasPhoneNumber(text: string): boolean {
  const match = text.match(PHONE_PATTERN);
  if (match === null) return false;
  const digits = match[0].replace(/\D/g, "");
  if (digits.length < 9) return false;
  return match[0].startsWith("+") || /[\s().-]/.test(match[0]);
}

/**
 * The shared privacy screen for both the prayer and the display name. Returns
 * the pastoral correction to show, or `null` when the text is safe to publish.
 */
export function findPrivacyLeak(text: string): string | null {
  if (EMAIL_PATTERN.test(text) || URL_PATTERN.test(text)) {
    return "For everyone's safety, please leave out links and email addresses — the wall is public.";
  }
  if (HANDLE_PATTERN.test(text) || hasPhoneNumber(text)) {
    return "For everyone's safety, please leave out phone numbers and social handles — the wall is public.";
  }
  return null;
}

/** Deduplicates and keeps only topics the drop-in dialog actually offers. */
function canonicalTopics(topics: readonly unknown[]): string[] {
  const offered = new Set(DROP_IN_TOPICS);
  const chosen = new Set<string>();
  for (const topic of topics) {
    if (typeof topic === "string" && offered.has(topic)) chosen.add(topic);
  }
  return DROP_IN_TOPICS.filter((topic) => chosen.has(topic));
}

/**
 * Full validation pass for the drop-in dialog: returns normalised values plus
 * per-field messages, so the component never has to guess what to show and the
 * suite can pin every rule. Never throws.
 */
export function sanitizeDropInDraft(draft: DropInDraft): DropInValidation {
  const body = sanitizeDropInText(draft.body);
  const authorName = sanitizeDropInText(draft.authorName);
  const anonymous = draft.anonymous === true;
  const topics = canonicalTopics(
    Array.isArray(draft.topics) ? draft.topics : [],
  );
  const errors: DropInErrors = {};

  if (body === "") {
    errors.body = "Share what we can pray for.";
  } else if (body.length < DROP_IN_BODY_MIN) {
    errors.body =
      "A few more words help the community pray with you specifically.";
  } else if (body.length > DROP_IN_BODY_MAX) {
    errors.body = `Keep it under ${DROP_IN_BODY_MAX} characters.`;
  } else {
    const leak = findPrivacyLeak(body);
    if (leak) errors.body = leak;
  }

  if (!anonymous) {
    if (authorName.length < 2) {
      errors.authorName = "Add a name, or choose to remain anonymous.";
    } else if (authorName.length > DROP_IN_NAME_MAX) {
      errors.authorName = `Keep your name under ${DROP_IN_NAME_MAX} characters.`;
    } else if (/[\d@]/.test(authorName)) {
      errors.authorName = "Please use a name only — no numbers or handles.";
    } else {
      const leak = findPrivacyLeak(authorName);
      if (leak) errors.authorName = leak;
    }
  }

  if (topics.length === 0) {
    errors.topics = "Choose at least one topic.";
  }

  return {
    ok: Object.keys(errors).length === 0,
    values: {
      body,
      author_name: anonymous ? "" : authorName,
      topics,
    },
    errors,
  };
}

/**
 * The wall card needs a title, but a drop-in deliberately does not ask for one:
 * the first sentence becomes the headline, trimmed to a word boundary so a
 * three-word line never ends mid-word. An empty body derives an empty string —
 * the dialog rejects that case before a payload is ever built.
 */
export function deriveDropInTitle(body: string): string {
  const text = sanitizeDropInText(body);
  if (text === "") return "";
  if (text.length <= DROP_IN_TITLE_MAX) return text;

  const clipped = text.slice(0, DROP_IN_TITLE_MAX);
  const boundary = clipped.lastIndexOf(" ");
  const words = boundary > 0 ? clipped.slice(0, boundary) : clipped;
  return `${words.trimEnd()}…`;
}

/** Builds the `prayer_requests` insert body; `user_id` is resolved by the data layer. */
export function buildDropInPrayerRequest(
  values: DropInSanitized,
): DropInPrayerPayload {
  return {
    author_name: values.author_name,
    title: deriveDropInTitle(values.body),
    body: values.body,
    topics: canonicalTopics(values.topics),
    is_public: true,
    is_answered: false,
    answered_note: null,
  };
}

// ---------------------------------------------------------------------------
// Pulse gate — a pure sliding-window rate limit for the optimistic Amen
// ---------------------------------------------------------------------------

/** At most six pulses per rolling minute, and never two within 700ms. */
export const PULSE_WINDOW_MAX = 6;
export const PULSE_WINDOW_MS = 60_000;
export const PULSE_MIN_GAP_MS = 700;

export interface PulseGateOptions {
  maxPulses?: number;
  windowMs?: number;
  minGapMs?: number;
}

export interface PulseDecision {
  allowed: boolean;
  /** Milliseconds until the next pulse would be accepted (0 when it was allowed). */
  retryAfterMs: number;
}

export interface PulseGate {
  /** Records the pulse and returns `true`, or refuses it without recording. */
  allow(now: number): boolean;
  /** Milliseconds until `allow` would succeed again (0 when it already would). */
  retryAfterMs(now: number): number;
  /** Pulses still available inside the current window. */
  remaining(now: number): number;
  /**
   * The component-facing entry point: reads the clock itself and returns the
   * decision and the cooldown together. The impurity deliberately lives here,
   * not in the render function that consumes it.
   */
  attempt(): PulseDecision;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

/**
 * Creates a fresh gate. The component keeps one in a ref for the session, so
 * the limit spans re-renders and every prayer on the wall shares one budget.
 */
export function createPulseGate(options: PulseGateOptions = {}): PulseGate {
  const maxPulses = positiveInteger(options.maxPulses, PULSE_WINDOW_MAX);
  const windowMs = positiveInteger(options.windowMs, PULSE_WINDOW_MS);
  const minGapMs = positiveInteger(options.minGapMs, PULSE_MIN_GAP_MS);

  /** Timestamps of accepted pulses, oldest first. */
  const stamps: number[] = [];
  let lastAccepted = Number.NEGATIVE_INFINITY;

  const prune = (now: number) => {
    while (stamps.length > 0 && now - stamps[0] >= windowMs) stamps.shift();
  };

  const allow = (now: number): boolean => {
    if (!Number.isFinite(now)) return false;
    prune(now);
    if (now - lastAccepted < minGapMs) return false;
    if (stamps.length >= maxPulses) return false;
    stamps.push(now);
    lastAccepted = now;
    return true;
  };

  const retryAfterMs = (now: number): number => {
    if (!Number.isFinite(now)) return 0;
    prune(now);
    const gapWait = Number.isFinite(lastAccepted)
      ? Math.max(0, minGapMs - (now - lastAccepted))
      : 0;
    const windowWait =
      stamps.length >= maxPulses ? Math.max(0, windowMs - (now - stamps[0])) : 0;
    return Math.max(gapWait, windowWait);
  };

  const remaining = (now: number): number => {
    if (!Number.isFinite(now)) return 0;
    prune(now);
    return Math.max(0, maxPulses - stamps.length);
  };

  return {
    allow,
    retryAfterMs,
    remaining,
    attempt(): PulseDecision {
      const now = Date.now();
      const accepted = allow(now);
      return {
        allowed: accepted,
        retryAfterMs: accepted ? 0 : retryAfterMs(now),
      };
    },
  };
}

/** Human cooldown copy: "" when the gate is open, "a moment" under a second. */
export function formatRetryAfter(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 1000) return "a moment";
  const seconds = Math.ceil(ms / 1000);
  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

// ---------------------------------------------------------------------------
// Self-echo guard — "that remote pulse was me"
// ---------------------------------------------------------------------------

/**
 * Bounded set of pulses this device announced but whose realtime echo has not
 * been seen yet. Postgres realtime cannot tell the wall that a counter change
 * came from *this* visitor (the row carries the prayer's author, not the
 * intercessor), so without this the visitor's own write returning over the
 * wire would be celebrated twice — and, worse, captioned "a believer somewhere
 * just prayed", which was really them. One echo is consumed per mark; an
 * unclaimed mark expires so a genuine remote pulse is never swallowed forever.
 */
export interface SelfEchoGuard {
  /** Records that this device just announced a pulse for `requestId`. */
  mark(requestId: string): void;
  /** True exactly once for the matching echo (and false once expired). */
  consume(requestId: string): boolean;
}

export interface SelfEchoGuardOptions {
  /** How long an unclaimed mark stays usable; defaults to 10 seconds. */
  ttlMs?: number;
  /** Injectable clock (tests pass a controllable one). */
  now?: () => number;
}

export function createSelfEchoGuard(
  options: SelfEchoGuardOptions = {},
): SelfEchoGuard {
  const ttlMs = positiveInteger(options.ttlMs, 10_000);
  const now = options.now ?? (() => Date.now());
  /** requestId → expiry stamp of the pending echo. */
  const pending = new Map<string, number>();

  return {
    mark(requestId: string): void {
      if (requestId === "") return;
      // Bound the map: a stuck channel can never grow it without limit.
      if (pending.size >= 16) {
        const oldest = pending.keys().next();
        if (!oldest.done) pending.delete(oldest.value);
      }
      pending.set(requestId, now() + ttlMs);
    },
    consume(requestId: string): boolean {
      const expiry = pending.get(requestId);
      if (expiry === undefined) return false;
      pending.delete(requestId);
      return now() <= expiry;
    },
  };
}

// ---------------------------------------------------------------------------
// Relative time — the feed's heartbeat wording
// ---------------------------------------------------------------------------

/**
 * "just now" / "42s ago" / "6m ago" / "3h ago" / "2d ago". An unparseable
 * timestamp renders as an empty string (the caller simply omits the time), and
 * a clock skew that puts the event in the future clamps to "just now" rather
 * than showing a negative age.
 */
export function formatRelativeTime(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at) || !Number.isFinite(now)) return "";

  const delta = now - at;
  if (delta < 10_000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

// ---------------------------------------------------------------------------
// Beacon stream
// ---------------------------------------------------------------------------

/** Newest beacons kept in the feed; older entries roll off the end. */
export const BEACON_FEED_LIMIT = 12;

/** `live` = rows from the cloud; `preview` = the bundled fail-open stream. */
export type BeaconSource = "live" | "preview";

/** What happened: a believer interceded, or a prayer just joined the wall. */
export type BeaconKind = "amen" | "shared";

/**
 * One entry in the feed. `region` is populated **only** by the simulated
 * preview stream — live beacons deliberately carry no location, because a
 * prayer's geography is not ours to publish.
 */
export interface IntercessionBeacon {
  id: string;
  title: string;
  topic: string | null;
  at: string;
  kind: BeaconKind;
  region: string | null;
}

export interface BeaconTally {
  topic: string;
  count: number;
}

export interface BeaconTotals {
  total: number;
  byTopic: BeaconTally[];
}

export interface BeaconFeed {
  source: BeaconSource;
  beacons: IntercessionBeacon[];
  totals: BeaconTotals;
}

/** Titles the preview stream cycles through — anonymous, Scripture-safe, no personal data. */
interface PreviewSeedEntry {
  title: string;
  topic: string;
  region: string;
  /** Age relative to "now", so the preview always reads as recent. */
  ageMs: number;
}

const MINUTE = 60_000;

const PREVIEW_SEEDS: readonly PreviewSeedEntry[] = [
  {
    title: "Healing for a mother recovering from surgery",
    topic: "Healing",
    region: "Nairobi",
    ageMs: 45_000,
  },
  {
    title: "Peace over an anxious week",
    topic: "Peace",
    region: "Manila",
    ageMs: 4 * MINUTE,
  },
  {
    title: "Guidance for a job decision",
    topic: "Guidance",
    region: "São Paulo",
    ageMs: 11 * MINUTE,
  },
  {
    title: "Praise for a reconciled family",
    topic: "Praise",
    region: "Seoul",
    ageMs: 26 * MINUTE,
  },
  {
    title: "Strength for a caregiver",
    topic: "Family",
    region: "Lagos",
    ageMs: 52 * MINUTE,
  },
  {
    title: "Comfort for a grieving friend",
    topic: "Peace",
    region: "Berlin",
    ageMs: 96 * MINUTE,
  },
];

/** Local calendar date, used to mint stable per-day preview ids. */
function localDayKey(now: number): string {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) return "day";
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Counts the kept beacons per topic, most interceded first (ties A→Z). */
export function tallyBeacons(
  beacons: readonly IntercessionBeacon[],
): BeaconTotals {
  const counts = new Map<string, number>();
  let total = 0;

  for (const beacon of beacons) {
    if (beacon.topic === null) continue;
    counts.set(beacon.topic, (counts.get(beacon.topic) ?? 0) + 1);
    total += 1;
  }

  const byTopic = Array.from(counts, ([topic, count]) => ({ topic, count }));
  byTopic.sort((a, b) =>
    a.count === b.count
      ? a.topic.localeCompare(b.topic)
      : b.count - a.count,
  );
  return { total, byTopic };
}

/** Newest first; ties keep insertion order so the list never jitters. */
function sortBeacons(beacons: IntercessionBeacon[]): IntercessionBeacon[] {
  return beacons
    .map((beacon, index) => ({ beacon, index }))
    .sort((a, b) => {
      if (a.beacon.at === b.beacon.at) return a.index - b.index;
      return a.beacon.at < b.beacon.at ? 1 : -1;
    })
    .map((entry) => entry.beacon);
}

/** Deduplicates by id and trims to `BEACON_FEED_LIMIT`, newest first. */
function capBeacons(beacons: IntercessionBeacon[]): IntercessionBeacon[] {
  const seen = new Set<string>();
  const kept: IntercessionBeacon[] = [];
  for (const beacon of sortBeacons(beacons)) {
    if (beacon.id === "" || seen.has(beacon.id)) continue;
    seen.add(beacon.id);
    kept.push(beacon);
    if (kept.length >= BEACON_FEED_LIMIT) break;
  }
  return kept;
}

/** Reads the embedded `prayer_requests` resource (object or single-row array). */
function embeddedPrayer(value: unknown): { title: string; topic: string | null } {
  const row = Array.isArray(value) ? value[0] : value;
  if (typeof row !== "object" || row === null) return { title: "", topic: null };

  const record = row as Record<string, unknown>;
  const title =
    typeof record.title === "string" ? sanitizeDropInText(record.title) : "";
  const topics = Array.isArray(record.topics)
    ? record.topics.filter((topic): topic is string => typeof topic === "string")
    : [];
  return { title, topic: topics.length > 0 ? topics[0] : null };
}

/**
 * Normalises a `prayer_intercessions` row (with its embedded
 * `prayer_requests(title, topics)` resource) into a beacon. Returns `null` for
 * rows without an id or a valid timestamp instead of throwing; the title
 * falls back to a generic line so a join the RLS layer stripped can never
 * blank the feed or leak a raw request id.
 */
export function parseBeaconRow(raw: unknown): IntercessionBeacon | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const id = typeof record.id === "string" ? record.id : "";
  const at = typeof record.prayed_at === "string" ? record.prayed_at : "";
  if (id === "" || Number.isNaN(Date.parse(at))) return null;

  const prayer = embeddedPrayer(record.prayer_requests);
  return {
    id,
    title: prayer.title === "" ? "A prayer on the wall" : prayer.title,
    topic: prayer.topic,
    at,
    kind: "amen",
    region: null,
  };
}

/** Builds a `live` feed from raw rows; unusable rows are dropped, never fatal. */
export function buildBeaconFeed(rows: readonly unknown[]): BeaconFeed {
  const parsed: IntercessionBeacon[] = [];
  for (const row of rows) {
    const beacon = parseBeaconRow(row);
    if (beacon) parsed.push(beacon);
  }
  const beacons = capBeacons(parsed);
  return { source: "live", beacons, totals: tallyBeacons(beacons) };
}

/** Adds one locally observed beacon (this session's Amen or share) to the top. */
export function prependBeacon(
  feed: BeaconFeed,
  beacon: IntercessionBeacon,
): BeaconFeed {
  const beacons = capBeacons([beacon, ...feed.beacons]);
  return { source: feed.source, beacons, totals: tallyBeacons(beacons) };
}

export interface LocalBeaconInput {
  /** Stable id when the caller has one (e.g. a realtime event id). */
  id?: string;
  title: string;
  topic: string | null;
  kind?: BeaconKind;
  /** Event time; defaults to now. An unparseable value falls back to now. */
  at?: string;
}

/** Device-minted id for beacons this session observed but the cloud did not emit. */
function localBeaconId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `beacon-${crypto.randomUUID()}`;
  }
  return `beacon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Builds a beacon for something that just happened on this device. */
export function createLocalBeacon(input: LocalBeaconInput): IntercessionBeacon {
  const title = sanitizeDropInText(input.title);
  const at =
    typeof input.at === "string" && !Number.isNaN(Date.parse(input.at))
      ? input.at
      : new Date().toISOString();
  const topic =
    typeof input.topic === "string" && input.topic !== "" ? input.topic : null;

  return {
    id: input.id !== undefined && input.id !== "" ? input.id : localBeaconId(),
    title: title === "" ? "A prayer on the wall" : title,
    topic,
    at,
    kind: input.kind ?? "amen",
    region: null,
  };
}

/**
 * The fail-open floor: a deterministic stream of recent-looking intercessions,
 * seeded by the local day so every render of the same day agrees (and the
 * server/client diff stays clean). Entries are clearly simulated — the feed
 * labels them "Preview stream" — and carry no personal data.
 */
export function previewBeaconFeed(now: number): BeaconFeed {
  const stamp = Number.isFinite(now) ? now : Date.now();
  const day = localDayKey(stamp);

  const beacons: IntercessionBeacon[] = PREVIEW_SEEDS.map((seed, index) => ({
    id: `preview-${day}-${index}`,
    title: seed.title,
    topic: seed.topic,
    at: new Date(stamp - seed.ageMs).toISOString(),
    kind: "amen",
    region: seed.region,
  }));

  const capped = capBeacons(beacons);
  return { source: "preview", beacons: capped, totals: tallyBeacons(capped) };
}

/**
 * Recent intercessions, newest first, with the preview stream as the fallback.
 *
 * Every failure mode — Supabase env vars missing, the query denied by RLS, the
 * table empty, malformed rows — resolves to a usable feed. The promise never
 * rejects, so the component has no error state to render.
 */
export async function fetchIntercessionBeacons(
  now: number = Date.now(),
): Promise<BeaconFeed> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("prayer_intercessions")
      .select("id, request_id, prayed_at, prayer_requests(title, topics)")
      .order("prayed_at", { ascending: false })
      .limit(BEACON_FEED_LIMIT);

    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) return previewBeaconFeed(now);

    const feed = buildBeaconFeed(data);
    return feed.beacons.length === 0 ? previewBeaconFeed(now) : feed;
  } catch (error) {
    console.warn(
      "Intercession beacons: live read unavailable, showing the preview stream:",
      error,
    );
    return previewBeaconFeed(now);
  }
}

// ---------------------------------------------------------------------------
// Event bridge — the community Amen pulse
// ---------------------------------------------------------------------------

/**
 * Window event announced whenever a believer intercedes for a prayer — locally,
 * or relayed by the wall's realtime layer when a *remote* believer does. The
 * Watchman hero listens for it and answers with its shipped `ThumbsUp` gesture
 * (`AMEN_GESTURE_CLIP` in `src/lib/watchmanStage.ts`); the beacon feed listens
 * for it and logs the entry. Neither module imports the other.
 */
export const AMEN_PULSE_EVENT = "jesusunited:amen-pulse";

export interface AmenPulseDetail {
  title: string;
  topic: string | null;
  /** `local` = this visitor prayed; `remote` = the realtime layer relayed one. */
  source: "local" | "remote";
  /** Event time (ISO 8601); an unparseable value becomes the dispatch time. */
  at: string;
}

/** What callers hand in; `at` is optional because "now" is the common case. */
export type AmenPulseInput = Omit<AmenPulseDetail, "at"> & { at?: string };

/** Normalises anything that crosses the event boundary into a safe pulse. */
export function normaliseAmenPulseDetail(
  raw: unknown,
): AmenPulseDetail | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const title = sanitizeDropInText(record.title);
  if (title === "") return null;

  return {
    title,
    topic:
      typeof record.topic === "string" && record.topic !== ""
        ? record.topic
        : null,
    source: record.source === "remote" ? "remote" : "local",
    at:
      typeof record.at === "string" && !Number.isNaN(Date.parse(record.at))
        ? record.at
        : "",
  };
}

/** Announces an intercession so the hero and the beacon feed can answer. */
export function announceAmenPulse(detail: AmenPulseInput): void {
  if (typeof window === "undefined") return;

  const payload: AmenPulseDetail = {
    title: sanitizeDropInText(detail.title) || "A prayer on the wall",
    topic:
      typeof detail.topic === "string" && detail.topic !== ""
        ? detail.topic
        : null,
    source: detail.source === "remote" ? "remote" : "local",
    at:
      typeof detail.at === "string" && !Number.isNaN(Date.parse(detail.at))
        ? detail.at
        : new Date().toISOString(),
  };

  window.dispatchEvent(new CustomEvent(AMEN_PULSE_EVENT, { detail: payload }));
}

/**
 * Subscribes to intercession pulses; returns the unsubscribe cleanup. Handlers
 * receive `null` when a foreign event with the same name carries no usable
 * detail, so a malformed broadcast can never crash the listener. Server-side
 * renders (no `window`) get a no-op unsubscribe.
 */
export function subscribeToAmenPulses(
  handler: (detail: AmenPulseDetail | null) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const listener = (event: Event) =>
    handler(
      normaliseAmenPulseDetail((event as CustomEvent<unknown>).detail),
    );

  window.addEventListener(AMEN_PULSE_EVENT, listener);
  return () => window.removeEventListener(AMEN_PULSE_EVENT, listener);
}
