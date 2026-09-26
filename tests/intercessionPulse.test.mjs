import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import vm from 'node:vm';

/**
 * Sprint 2 — verification suite for the Community Intercession Pulse core in
 * `src/lib/intercessionPulse.ts` (+ the share-bridge it leans on in
 * `src/lib/prayers.ts`).
 *
 * Same sandbox strategy as the other lib suites: node:test + ts.transpileModule
 * + node:vm, with the data layer stubbed and a fake `window`/`CustomEvent`
 * injected only when the event bridge is under test. Every rule that protects a
 * visitor — the privacy screen, the pulse gate, the fail-open feed — is pinned
 * here without a DOM, a network or a GPU.
 */
const require = createRequire(import.meta.url);
const ts = require('typescript');

const transpile = (relativePath) =>
  ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;

/** Latest accepted `at` used by the relative-time cases below. */
const NOW = Date.parse('2026-09-26T14:00:00.000Z');

/** Copies a value across the vm realm boundary so strict deep-equality applies. */
const plain = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const rawDeepEqual = assert.deepEqual.bind(assert);
function eq(actual, expected) {
  rawDeepEqual(plain(actual), plain(expected));
}

/** Query-builder stub shaped like the piece of PostgREST the feed uses. */
function queryStub({ rows = [], error = null } = {}) {
  const calls = [];
  const query = {};
  for (const method of ['select', 'order', 'limit']) {
    query[method] = (...args) => {
      calls.push([method, ...args]);
      return query;
    };
  }
  query.then = (resolve, reject) =>
    Promise.resolve({ data: rows, error }).then(resolve, reject);
  return { query, calls };
}

/**
 * Loads a lib module in an isolated context. `clients` maps an import path to a
 * factory so each module can be stubbed independently (`{ '@/lib/supabaseBrowser':
 * () => ({ createClient }) }`). When `withWindow` is set, a fake event target and
 * a minimal `CustomEvent` are injected so dispatch/subscribe can be exercised.
 */
function load(path, { clients = {}, withWindow = false } = {}) {
  const events = [];
  const listeners = new Map();
  const window = withWindow
    ? {
        addEventListener: (type, listener) => {
          const list = listeners.get(type) ?? [];
          list.push(listener);
          listeners.set(type, list);
        },
        removeEventListener: (type, listener) => {
          const list = listeners.get(type) ?? [];
          listeners.set(
            type,
            list.filter((entry) => entry !== listener),
          );
        },
        dispatchEvent: (event) => {
          events.push(event);
          for (const listener of listeners.get(event.type) ?? []) listener(event);
          return true;
        },
      }
    : undefined;

  class FakeCustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail ?? null;
    }
  }

  const exports = {};
  const sandbox = {
    exports,
    module: { exports },
    console: { warn() {}, log() {}, error() {} },
    require: (name) => {
      const factory = clients[name];
      if (!factory) throw new Error(`Unexpected import in sandbox: ${name}`);
      return factory();
    },
  };
  if (withWindow) {
    sandbox.window = window;
    sandbox.CustomEvent = FakeCustomEvent;
  }

  vm.runInNewContext(transpile(path), sandbox);
  return { api: exports, events, window };
}

/** Loads the pulse module with the Supabase data layer stubbed out. */
function loadPulse({ client, clientThrows = false, withWindow = false } = {}) {
  return load('../src/lib/intercessionPulse.ts', {
    withWindow,
    clients: {
      '@/lib/supabaseBrowser': () => ({
        createClient: () => {
          if (clientThrows) throw new Error('Missing Supabase configuration');
          return client;
        },
      }),
    },
  });
}

const pulse = loadPulse();

describe('intercessionPulse — drop-in topics', () => {
  it('offers exactly the five curated pulse topics', () => {
    assert.deepEqual([...pulse.api.DROP_IN_TOPICS], [
      'Healing',
      'Guidance',
      'Family',
      'Praise',
      'Peace',
    ]);
  });

  it('caps the quick share well below the full form', () => {
    assert.equal(pulse.api.DROP_IN_BODY_MIN, 8);
    assert.equal(pulse.api.DROP_IN_BODY_MAX, 320);
    assert.equal(pulse.api.DROP_IN_NAME_MAX, 40);
  });
});

describe('intercessionPulse — sanitizeDropInText', () => {
  const { sanitizeDropInText } = pulse.api;

  it('collapses whitespace and trims the edges', () => {
    assert.equal(sanitizeDropInText('  Peace   be\t\twith\n\nyou  '), 'Peace be with you');
  });

  it('removes zero-width joiners and bidi overrides', () => {
    assert.equal(sanitizeDropInText('He\u200Baling'), 'Healing');
    assert.equal(sanitizeDropInText('a\u202Eb\u2066c'), 'abc');
  });

  it('replaces control characters instead of gluing words together', () => {
    assert.equal(sanitizeDropInText('Grace\u0007and peace'), 'Grace and peace');
  });

  it('ignores non-string input safely', () => {
    assert.equal(sanitizeDropInText(null), '');
    assert.equal(sanitizeDropInText(undefined), '');
    assert.equal(sanitizeDropInText(42), '');
  });
});

describe('intercessionPulse — findPrivacyLeak', () => {
  const { findPrivacyLeak } = pulse.api;

  it('refuses emails and links', () => {
    assert.match(findPrivacyLeak('reach me at grace@example.com'), /links and email/);
    assert.match(findPrivacyLeak('see https://example.com/prayer'), /links and email/);
    assert.match(findPrivacyLeak('visit www.example.com'), /links and email/);
  });

  it('refuses phone numbers and handles', () => {
    assert.match(findPrivacyLeak('call me on +44 7700 900123'), /phone numbers and social handles/);
    assert.match(findPrivacyLeak('ring (555) 123-4567 anytime'), /phone numbers and social handles/);
    assert.match(findPrivacyLeak('message @grace_daily'), /phone numbers and social handles/);
  });

  it('passes Scripture references and dates through', () => {
    assert.equal(findPrivacyLeak('standing on 1 Peter 5:7 today'), null);
    assert.equal(findPrivacyLeak('surgery is on 2026-09-30'), null);
    assert.equal(findPrivacyLeak('Psalm 46:10'), null);
  });
});

describe('intercessionPulse — sanitizeDropInDraft', () => {
  const { sanitizeDropInDraft } = pulse.api;

  const draft = (overrides = {}) => ({
    body: 'Healing for my father before surgery',
    authorName: '',
    anonymous: true,
    topics: ['Healing'],
    ...overrides,
  });

  it('accepts an anonymous share and blanks the name field', () => {
    const result = sanitizeDropInDraft(draft({ authorName: 'ignored' }));
    assert.equal(result.ok, true);
    eq(result.errors, {});
    assert.equal(result.values.author_name, '');
    assert.equal(result.values.body, 'Healing for my father before surgery');
    eq(result.values.topics, ['Healing']);
  });

  it('keeps a provided name when the share is signed', () => {
    const result = sanitizeDropInDraft(
      draft({ anonymous: false, authorName: '  Grace  ' }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.values.author_name, 'Grace');
  });

  it('requires a name of at least two characters when not anonymous', () => {
    const short = sanitizeDropInDraft(draft({ anonymous: false, authorName: 'G' }));
    assert.equal(short.ok, false);
    assert.equal(short.errors.authorName !== undefined, true);
    assert.equal(sanitizeDropInDraft(draft({ anonymous: false, authorName: '' })).ok, false);
  });

  it('refuses digits and handles in a display name', () => {
    const numeric = sanitizeDropInDraft(
      draft({ anonymous: false, authorName: 'Grace 2000' }),
    );
    assert.match(numeric.errors.authorName, /name only/);
    assert.equal(numeric.ok, false);
  });

  it('refuses contact details in the prayer itself', () => {
    const result = sanitizeDropInDraft(
      draft({ body: 'Call me on (555) 123-4567 about the surgery' }),
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.body, /public/);
  });

  it('enforces the length window', () => {
    assert.match(
      sanitizeDropInDraft(draft({ body: '' })).errors.body,
      /Share what we can pray for/,
    );
    assert.match(
      sanitizeDropInDraft(draft({ body: 'short' })).errors.body,
      /A few more words/,
    );
    assert.match(
      sanitizeDropInDraft(
        draft({ body: 'x'.repeat(pulse.api.DROP_IN_BODY_MAX + 1) }),
      ).errors.body,
      /under 320 characters/,
    );
  });

  it('filters unknown topics, dedupes, and requires at least one', () => {
    const filtered = sanitizeDropInDraft(
      draft({ topics: ['Peace', 'Nonsense', 'Peace', 'Healing', 42] }),
    );
    eq(filtered.values.topics, ['Healing', 'Peace']);

    const empty = sanitizeDropInDraft(draft({ topics: [] }));
    assert.equal(empty.ok, false);
    assert.match(empty.errors.topics, /at least one topic/);
  });
});

describe('intercessionPulse — deriveDropInTitle & payload', () => {
  const { deriveDropInTitle, buildDropInPrayerRequest } = pulse.api;

  it('uses a short prayer as its own title', () => {
    assert.equal(
      deriveDropInTitle('Peace over an anxious week'),
      'Peace over an anxious week',
    );
  });

  it('clips a long prayer at a word boundary', () => {
    const body =
      'Healing for my mother as she prepares for a long and difficult surgery next week';
    const title = deriveDropInTitle(body);
    assert.equal(title.endsWith('…'), true);
    assert.equal(title.length <= 73, true);
    const head = title.slice(0, -1);
    assert.equal(body.startsWith(head), true);
    assert.equal(/\s$/.test(head), false);
  });

  it('never invents a title for an empty body', () => {
    assert.equal(deriveDropInTitle('   '), '');
  });

  it('builds a public, unanswered insert with canonical topics', () => {
    const payload = buildDropInPrayerRequest({
      body: 'Guidance for a job decision',
      author_name: '',
      topics: ['Peace', 'Guidance', 'Peace'],
    });
    eq(payload, {
      author_name: '',
      title: 'Guidance for a job decision',
      body: 'Guidance for a job decision',
      topics: ['Guidance', 'Peace'],
      is_public: true,
      is_answered: false,
      answered_note: null,
    });
  });
});

describe('intercessionPulse — createPulseGate', () => {
  const { createPulseGate, PULSE_WINDOW_MAX, PULSE_MIN_GAP_MS } = pulse.api;

  it('allows a spaced burst up to the window maximum, then refuses', () => {
    const gate = createPulseGate();
    let stamp = NOW;
    for (let index = 0; index < PULSE_WINDOW_MAX; index += 1) {
      assert.equal(gate.allow(stamp), true, `pulse ${index} should be allowed`);
      stamp += 1500;
    }
    assert.equal(gate.allow(stamp), false);
    assert.equal(gate.remaining(stamp), 0);
    assert.equal(gate.retryAfterMs(stamp) > 0, true);
  });

  it('enforces the minimum gap between two pulses', () => {
    const gate = createPulseGate();
    assert.equal(gate.allow(NOW), true);
    assert.equal(gate.allow(NOW + 200), false);
    assert.equal(gate.retryAfterMs(NOW + 200), PULSE_MIN_GAP_MS - 200);
    assert.equal(gate.allow(NOW + PULSE_MIN_GAP_MS), true);
  });

  it('slides the window so a rested visitor is welcomed back', () => {
    const gate = createPulseGate({ maxPulses: 2, windowMs: 10_000, minGapMs: 10 });
    assert.equal(gate.allow(0), true);
    assert.equal(gate.allow(100), true);
    assert.equal(gate.allow(200), false);
    assert.equal(gate.allow(10_100), true);
    assert.equal(gate.remaining(10_100), 1);
  });

  it('ignores timestamps that are not finite numbers', () => {
    const gate = createPulseGate();
    assert.equal(gate.allow(Number.NaN), false);
    assert.equal(gate.allow(Number.POSITIVE_INFINITY), false);
    assert.equal(gate.remaining(Number.NaN), 0);
    assert.equal(gate.retryAfterMs(Number.NaN), 0);
  });

  it('uses sane defaults when options are malformed', () => {
    const gate = createPulseGate({ maxPulses: -3, windowMs: 0, minGapMs: Number.NaN });
    assert.equal(gate.remaining(NOW), PULSE_WINDOW_MAX);
    assert.equal(gate.allow(NOW), true);
  });

  it('renders human cooldown copy', () => {
    const { formatRetryAfter } = pulse.api;
    assert.equal(formatRetryAfter(0), '');
    assert.equal(formatRetryAfter(-10), '');
    assert.equal(formatRetryAfter(250), 'a moment');
    assert.equal(formatRetryAfter(1000), '1 second');
    assert.equal(formatRetryAfter(2100), '3 seconds');
    assert.equal(formatRetryAfter(Number.NaN), '');
  });

  it('reads the clock itself for the component-facing entry point', () => {
    const gate = createPulseGate({ minGapMs: 60_000 });
    const first = gate.attempt();
    assert.equal(first.allowed, true);
    assert.equal(first.retryAfterMs, 0);

    const second = gate.attempt();
    assert.equal(second.allowed, false);
    assert.equal(second.retryAfterMs > 0, true);
  });
});

describe('intercessionPulse — createSelfEchoGuard', () => {
  const { createSelfEchoGuard } = pulse.api;

  it('consumes exactly one echo per marked pulse', () => {
    const guard = createSelfEchoGuard();
    guard.mark('prayer-1');
    assert.equal(guard.consume('prayer-1'), true);
    assert.equal(guard.consume('prayer-1'), false);
  });

  it('never claims an unmarked or blank id', () => {
    const guard = createSelfEchoGuard();
    assert.equal(guard.consume('prayer-2'), false);
    guard.mark('');
    assert.equal(guard.consume(''), false);
  });

  it('lets a genuine remote pulse through once the mark expires', () => {
    let clock = 1_000;
    const guard = createSelfEchoGuard({ ttlMs: 5_000, now: () => clock });

    guard.mark('prayer-3');
    clock = 6_100;
    assert.equal(guard.consume('prayer-3'), false);

    guard.mark('prayer-4');
    clock = 6_500;
    assert.equal(guard.consume('prayer-4'), true);
  });

  it('bounds its memory when echoes never arrive', () => {
    const guard = createSelfEchoGuard({ ttlMs: 60_000, now: () => 0 });
    for (let index = 0; index < 40; index += 1) guard.mark(`prayer-${index}`);
    // The oldest marks were evicted, the newest are still claimable.
    assert.equal(guard.consume('prayer-0'), false);
    assert.equal(guard.consume('prayer-39'), true);
  });
});

describe('intercessionPulse — formatRelativeTime', () => {
  const { formatRelativeTime } = pulse.api;
  const at = (offsetMs) => new Date(NOW - offsetMs).toISOString();

  it('reads as a heartbeat across the scales', () => {
    assert.equal(formatRelativeTime(at(5_000), NOW), 'just now');
    assert.equal(formatRelativeTime(at(30_000), NOW), '30s ago');
    assert.equal(formatRelativeTime(at(90_000), NOW), '1m ago');
    assert.equal(formatRelativeTime(at(3 * 3_600_000), NOW), '3h ago');
    assert.equal(formatRelativeTime(at(2 * 86_400_000), NOW), '2d ago');
  });

  it('clamps future timestamps instead of showing a negative age', () => {
    assert.equal(formatRelativeTime(new Date(NOW + 60_000).toISOString(), NOW), 'just now');
  });

  it('renders nothing for an unparseable timestamp or clock', () => {
    assert.equal(formatRelativeTime('not-a-date', NOW), '');
    assert.equal(formatRelativeTime(at(5_000), Number.NaN), '');
  });
});

describe('intercessionPulse — beacon normalising', () => {
  const { parseBeaconRow, buildBeaconFeed, tallyBeacons, BEACON_FEED_LIMIT } = pulse.api;

  const row = (overrides = {}) => ({
    id: 'i-1',
    request_id: 'p-1',
    prayed_at: new Date(NOW - 60_000).toISOString(),
    prayer_requests: {
      title: '  Healing  for my father ',
      topics: ['Healing', 'Family'],
    },
    ...overrides,
  });

  it('normalises a row with an embedded prayer and collapses its title', () => {
    const beacon = parseBeaconRow(row());
    eq(beacon, {
      id: 'i-1',
      title: 'Healing for my father',
      topic: 'Healing',
      at: new Date(NOW - 60_000).toISOString(),
      kind: 'amen',
      region: null,
    });
  });

  it('accepts the embedded resource as either an object or a one-row array', () => {
    const [first] = [row()];
    assert.equal(
      parseBeaconRow(
        row({ prayer_requests: [{ title: 'Peace over Manila', topics: ['Peace'] }] }),
      ).topic,
      'Peace',
    );
    assert.equal(first.prayer_requests.title.trim().startsWith('Healing'), true);
  });

  it('falls back to a generic line when the join is withheld, never a raw id', () => {
    const beacon = parseBeaconRow(row({ prayer_requests: null }));
    assert.equal(beacon.title, 'A prayer on the wall');
    assert.equal(beacon.topic, null);
  });

  it('drops rows that cannot be trusted', () => {
    assert.equal(parseBeaconRow(null), null);
    assert.equal(parseBeaconRow([]), null);
    assert.equal(parseBeaconRow(row({ id: '' })), null);
    assert.equal(parseBeaconRow(row({ prayed_at: 'whenever' })), null);
    assert.equal(parseBeaconRow(row({ prayed_at: undefined })), null);
  });

  it('never publishes a location on a live beacon', () => {
    assert.equal(parseBeaconRow(row({ region: 'Lagos' })).region, null);
  });

  it('keeps only the newest rows, deduped and bounded', () => {
    const rows = [];
    for (let index = 0; index < BEACON_FEED_LIMIT + 3; index += 1) {
      rows.push(
        row({
          id: `i-${index}`,
          prayed_at: new Date(NOW - index * 1000).toISOString(),
        }),
      );
    }
    rows.push(row({ id: 'i-0' }));

    const feed = buildBeaconFeed(rows);
    assert.equal(feed.source, 'live');
    assert.equal(feed.beacons.length, BEACON_FEED_LIMIT);
    assert.equal(feed.beacons[0].id, 'i-0');
    assert.equal(feed.beacons.at(-1).id, `i-${BEACON_FEED_LIMIT - 1}`);
  });

  it('survives a feed of nothing but junk', () => {
    const feed = buildBeaconFeed([null, 'nope', 42, {}]);
    eq(feed, { source: 'live', beacons: [], totals: { total: 0, byTopic: [] } });
  });

  it('tallies topics by frequency, breaking ties alphabetically', () => {
    const totals = tallyBeacons([
      { id: 'a', topic: 'Healing', at: '', kind: 'amen', title: 'a', region: null },
      { id: 'b', topic: 'Peace', at: '', kind: 'amen', title: 'b', region: null },
      { id: 'c', topic: 'Healing', at: '', kind: 'amen', title: 'c', region: null },
      { id: 'd', topic: 'Praise', at: '', kind: 'amen', title: 'd', region: null },
      { id: 'e', topic: 'Peace', at: '', kind: 'amen', title: 'e', region: null },
      { id: 'f', topic: null, at: '', kind: 'shared', title: 'f', region: null },
    ]);
    eq(totals, {
      total: 5,
      byTopic: [
        { topic: 'Healing', count: 2 },
        { topic: 'Peace', count: 2 },
        { topic: 'Praise', count: 1 },
      ],
    });
  });
});

describe('intercessionPulse — local beacons & preview stream', () => {
  const { createLocalBeacon, prependBeacon, previewBeaconFeed } = pulse.api;

  it('mints a local beacon with a stable fallback title and no region', () => {
    const beacon = createLocalBeacon({ title: '  ', topic: null, kind: 'shared' });
    assert.equal(beacon.title, 'A prayer on the wall');
    assert.equal(beacon.kind, 'shared');
    assert.equal(beacon.region, null);
    assert.equal(beacon.id.startsWith('beacon-'), true);
    assert.equal(Number.isNaN(Date.parse(beacon.at)), false);
  });

  it('honours a supplied id and event time', () => {
    const at = new Date(NOW - 1000).toISOString();
    const beacon = createLocalBeacon({ id: 'pulse-1', title: 'Peace', topic: 'Peace', at });
    assert.equal(beacon.id, 'pulse-1');
    assert.equal(beacon.at, at);
    assert.equal(beacon.kind, 'amen');
  });

  it('prepends a fresh pulse, recounts the tallies, and keeps the source', () => {
    const base = previewBeaconFeed(NOW);
    const next = prependBeacon(
      base,
      createLocalBeacon({ id: 'mine', title: 'Healing for my father', topic: 'Healing', at: new Date(NOW + 1000).toISOString() }),
    );
    assert.equal(next.source, 'preview');
    assert.equal(next.beacons[0].id, 'mine');
    assert.equal(next.totals.total, base.totals.total + 1);
    assert.equal(next.totals.byTopic[0].topic, 'Healing');
    assert.equal(next.totals.byTopic[0].count, 2);
  });

  it('ignores a duplicate id instead of double-counting it', () => {
    const base = previewBeaconFeed(NOW);
    const beacon = createLocalBeacon({ id: 'once', title: 'Peace', topic: 'Peace' });
    const once = prependBeacon(base, beacon);
    const twice = prependBeacon(once, createLocalBeacon({ id: 'once', title: 'Peace', topic: 'Peace' }));
    assert.equal(twice.beacons.length, once.beacons.length);
    assert.equal(twice.totals.total, once.totals.total);
  });

  it('serves a deterministic preview stream for the same clock', () => {
    const first = previewBeaconFeed(NOW);
    const second = previewBeaconFeed(NOW);
    eq(first.beacons, second.beacons);
    assert.equal(first.source, 'preview');
    assert.equal(first.beacons.length, 6);

    const day = new Date(NOW);
    const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    assert.equal(first.beacons[0].id, `preview-${dayKey}-0`);
  });

  it('keeps preview ages in the past, newest first', () => {
    const feed = previewBeaconFeed(NOW);
    for (const beacon of feed.beacons) {
      assert.equal(Date.parse(beacon.at) <= NOW, true);
    }
    const stamps = feed.beacons.map((beacon) => Date.parse(beacon.at));
    eq(stamps, [...stamps].sort((a, b) => b - a));
  });

  it('gives each day its own preview ids', () => {
    const today = previewBeaconFeed(NOW);
    const tomorrow = previewBeaconFeed(NOW + 86_400_000);
    assert.notEqual(today.beacons[0].id, tomorrow.beacons[0].id);
    assert.equal(tomorrow.beacons[0].id.startsWith('preview-'), true);
  });

  it('survives a nonsense clock', () => {
    const feed = previewBeaconFeed(Number.NaN);
    assert.equal(feed.beacons.length, 6);
    assert.equal(feed.beacons.every((beacon) => !Number.isNaN(Date.parse(beacon.at))), true);
  });
});

describe('intercessionPulse — fetchIntercessionBeacons is fail-open', () => {
  const row = (id, offsetMs, title) => ({
    id,
    request_id: `p-${id}`,
    prayed_at: new Date(NOW - offsetMs).toISOString(),
    prayer_requests: { title, topics: ['Healing'] },
  });

  it('returns a live feed and asks for the newest twelve rows', async () => {
    const { query, calls } = queryStub({
      rows: [row('i-1', 60_000, 'Healing for my father')],
    });
    const { api } = loadPulse({
      client: {
        from: (table) => {
          calls.push(['from', table]);
          return query;
        },
      },
    });

    const feed = await api.fetchIntercessionBeacons(NOW);
    assert.equal(feed.source, 'live');
    assert.equal(feed.beacons[0].title, 'Healing for my father');
    assert.equal(
      calls.some(([method, table]) => method === 'from' && table === 'prayer_intercessions'),
      true,
    );
    assert.equal(
      calls.some(
        ([method, key, value]) =>
          method === 'order' && key === 'prayed_at' && value.ascending === false,
      ),
      true,
    );
    assert.equal(
      calls.some(
        ([method, count]) => method === 'limit' && count === pulse.api.BEACON_FEED_LIMIT,
      ),
      true,
    );
  });

  it('never rejects when the query fails', async () => {
    const { query } = queryStub({ error: { message: 'permission denied' } });
    const { api } = loadPulse({ client: { from: () => query } });
    const feed = await api.fetchIntercessionBeacons(NOW);
    assert.equal(feed.source, 'preview');
    assert.equal(feed.beacons.length, 6);
  });

  it('falls back when the table is empty or every row is unusable', async () => {
    const empty = queryStub({ rows: [] });
    const emptyFeed = await loadPulse({ client: { from: () => empty.query } })
      .api.fetchIntercessionBeacons(NOW);
    assert.equal(emptyFeed.source, 'preview');

    const junk = queryStub({ rows: [{ id: '' }, { id: 'i-2', prayed_at: 'whenever' }] });
    const junkFeed = await loadPulse({ client: { from: () => junk.query } })
      .api.fetchIntercessionBeacons(NOW);
    assert.equal(junkFeed.source, 'preview');
  });

  it('falls back when Supabase has no configuration at all', async () => {
    const { api } = loadPulse({ clientThrows: true });
    const feed = await api.fetchIntercessionBeacons(NOW);
    assert.equal(feed.source, 'preview');
    assert.equal(feed.beacons.length, 6);
  });

  it('anchors preview ages to the supplied clock', async () => {
    const { api } = loadPulse({ clientThrows: true });
    const feed = await api.fetchIntercessionBeacons(NOW);
    assert.equal(feed.beacons[0].at, new Date(NOW - 45_000).toISOString());
  });
});

describe('intercessionPulse — amen-pulse bridge', () => {
  it('announces a normalised pulse on the window', () => {
    const { api, events } = loadPulse({ withWindow: true });
    api.announceAmenPulse({
      title: '  Healing   for my father ',
      topic: 'Healing',
      source: 'remote',
    });

    assert.equal(api.AMEN_PULSE_EVENT, 'jesusunited:amen-pulse');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, api.AMEN_PULSE_EVENT);
    assert.equal(events[0].detail.title, 'Healing for my father');
    assert.equal(events[0].detail.topic, 'Healing');
    assert.equal(events[0].detail.source, 'remote');
    assert.equal(Number.isNaN(Date.parse(events[0].detail.at)), false);
  });

  it('defaults to a local pulse and never announces a blank title', () => {
    const { api, events } = loadPulse({ withWindow: true });
    api.announceAmenPulse({ title: '   ', topic: '' });
    assert.equal(events[0].detail.title, 'A prayer on the wall');
    assert.equal(events[0].detail.topic, null);
    assert.equal(events[0].detail.source, 'local');
  });

  it('keeps a real event time and replaces an unparseable one', () => {
    const { api, events } = loadPulse({ withWindow: true });
    const at = new Date(NOW - 5000).toISOString();
    api.announceAmenPulse({ title: 'Peace', topic: null, source: 'local', at });
    api.announceAmenPulse({ title: 'Peace', topic: null, source: 'local', at: 'not-a-date' });
    assert.equal(events[0].detail.at, at);
    assert.equal(Number.isNaN(Date.parse(events[1].detail.at)), false);
    assert.notEqual(events[1].detail.at, 'not-a-date');
  });

  it('delivers pulses to subscribers and stops after unsubscribe', () => {
    const { api } = loadPulse({ withWindow: true });
    const seen = [];
    const unsubscribe = api.subscribeToAmenPulses((detail) => seen.push(detail));

    api.announceAmenPulse({ title: 'Peace', topic: 'Peace', source: 'local' });
    unsubscribe();
    api.announceAmenPulse({ title: 'Peace again', topic: null, source: 'local' });

    assert.equal(seen.length, 1);
    assert.equal(seen[0].title, 'Peace');
    assert.equal(seen[0].source, 'local');
  });

  it('hands a malformed broadcast a null detail instead of throwing', () => {
    const { api, window } = loadPulse({ withWindow: true });
    const seen = [];
    api.subscribeToAmenPulses((detail) => seen.push(detail));

    window.dispatchEvent({ type: api.AMEN_PULSE_EVENT, detail: null });
    window.dispatchEvent({ type: api.AMEN_PULSE_EVENT, detail: { title: 42 } });
    window.dispatchEvent({ type: api.AMEN_PULSE_EVENT });

    eq(seen, [null, null, null]);
  });

  it('is a no-op on the server', () => {
    const { api } = loadPulse();
    assert.doesNotThrow(() =>
      api.announceAmenPulse({ title: 'Peace', topic: null, source: 'local' }),
    );
    const unsubscribe = api.subscribeToAmenPulses(() => {
      throw new Error('a server render must never receive a pulse');
    });
    assert.equal(typeof unsubscribe, 'function');
    assert.doesNotThrow(() => unsubscribe());
  });

  it('normalises foreign details defensively', () => {
    const { api } = loadPulse();
    assert.equal(api.normaliseAmenPulseDetail(null), null);
    assert.equal(api.normaliseAmenPulseDetail('Peace'), null);
    assert.equal(api.normaliseAmenPulseDetail({ title: '   ' }), null);
    eq(
      api.normaliseAmenPulseDetail({
        title: ' Peace ',
        topic: '',
        source: 'remote',
        at: 'nope',
      }),
      { title: 'Peace', topic: null, source: 'remote', at: '' },
    );
  });
});

describe('prayers — drop-in topics & share bridge', () => {
  const loadPrayers = ({ withWindow = false } = {}) =>
    load('../src/lib/prayers.ts', {
      withWindow,
      clients: {
        '@/lib/altar': () => ({ getCurrentUserId: async () => null }),
        '@/lib/supabaseBrowser': () => ({
          createClient: () => {
            throw new Error('offline');
          },
        }),
      },
    });

  it('keeps every drop-in topic filterable on the wall', () => {
    const { api } = loadPrayers();
    for (const topic of pulse.api.DROP_IN_TOPICS) {
      assert.equal(
        api.PRAYER_TOPICS.includes(topic),
        true,
        `${topic} must exist in PRAYER_TOPICS for the wall's filter pills`,
      );
    }
  });

  it('announces the shared prayer and tolerates detail-less announcements', () => {
    const { api } = loadPrayers({ withWindow: true });
    const seen = [];
    const unsubscribe = api.subscribeToPrayerSubmissions((detail) =>
      seen.push(detail),
    );

    api.announcePrayerSubmitted({ title: '  Healing for my father ', topic: 'Healing' });
    api.announcePrayerSubmitted();
    unsubscribe();
    api.announcePrayerSubmitted({ title: 'After unsubscribe', topic: null });

    eq(seen, [
      { title: 'Healing for my father', topic: 'Healing' },
      null,
    ]);
  });

  it('is a no-op on the server', () => {
    const { api } = loadPrayers();
    assert.doesNotThrow(() =>
      api.announcePrayerSubmitted({ title: 'Peace', topic: null }),
    );
    const unsubscribe = api.subscribeToPrayerSubmissions(() => {
      throw new Error('a server render must never receive a share');
    });
    assert.doesNotThrow(() => unsubscribe());
  });
});

