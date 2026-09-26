import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

/**
 * Phase 2 — Task 3.1 verification suite.
 *
 * Mirrors tests/moderation.test.mjs: no test runner is installed (tdd-workflow
 * skill), so the TypeScript sources are transpiled in-memory with
 * `ts.transpileModule` and evaluated inside a `node:vm` sandbox with a
 * hand-rolled Supabase double. Run with `node tests/globe.test.mjs`.
 */
const require = createRequire(import.meta.url);
const ts = require('typescript');
const EARTH_RADIUS_METERS = 6371008.8;

function compile(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

function runModule(relativePath, requireImpl, consoleImpl = console) {
  const exports = {};
  vm.runInNewContext(compile(relativePath), { exports, require: requireImpl, console: consoleImpl });
  return exports;
}

let globeCache;
/** Loads src/lib/globe.ts (the pure math module has no runtime imports). */
function globe() {
  if (!globeCache) {
    globeCache = runModule('../src/lib/globe.ts', (name) => {
      throw new Error(`Unexpected import in globe.ts: ${name}`);
    });
  }
  return globeCache;
}

/** Builds a PostGIS-compatible EWKB point payload (little endian, SRID 4326). */
function wkbPointHex(lng, lat) {
  const buffer = Buffer.alloc(25);
  buffer.writeUInt8(1, 0);
  buffer.writeUInt32LE(0x20000001, 1);
  buffer.writeUInt32LE(4326, 5);
  buffer.writeDoubleLE(lng, 9);
  buffer.writeDoubleLE(lat, 17);
  return buffer.toString('hex');
}

/** Copies a value across the vm realm boundary so strict deep-equality applies. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Independent great-circle distance check for the jitter constraint. */
function haversineMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Loads src/lib/gatherings.ts against a fake Supabase client. `responses` is a
 * queue: the status-filtered read consumes the first entry, the schema-fallback
 * read (if needed) consumes the next.
 */
function setupGatherings({
  responses = [{ data: [], error: null }],
  throws = false,
  consoleImpl = console,
} = {}) {
  const calls = [];
  let responseIndex = 0;
  const client = {
    from(table) {
      calls.push(['from', table]);
      if (throws) throw new Error('Missing Supabase configuration');
      const query = {};
      for (const method of ['select', 'eq', 'order', 'limit', 'insert']) {
        query[method] = (...args) => {
          calls.push([method, ...args]);
          return query;
        };
      }
      query.then = (resolve, reject) => {
        const response = responses[Math.min(responseIndex, responses.length - 1)];
        responseIndex += 1;
        return Promise.resolve(response).then(resolve, reject);
      };
      return query;
    },
  };

  const api = runModule('../src/lib/gatherings.ts', (name) => {
    if (name === '@/lib/supabase') return { supabase: client };
    if (name === '@/lib/globe') return globe();
    throw new Error(`Unexpected import in gatherings.ts: ${name}`);
  }, consoleImpl);
  return { api, calls };
}

const SECRET_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Grace Chapel Gathering',
  description: 'A small group that meets in a home.',
  leader_name: 'Pastor Johnathan Smithfield',
  contact_email: 'johnathan.smithfield@example.com',
  meeting_time: 'Sundays 10:00 AM',
  address: '1234 Secret Street, Austin, TX 78701',
  location: wkbPointHex(-97.7431, 30.2672),
  created_at: '2026-09-01T12:00:00Z',
  member_count: 12,
};

const AUSTIN = { lat: 30.2672, lng: -97.7431 };

// ---------------------------------------------------------------------------
// Globe geometry & math foundation
// ---------------------------------------------------------------------------

test('equator and prime meridian project onto +Z at the requested radius', () => {
  const { latLngToVector3 } = globe();
  const point = latLngToVector3(0, 0, 100);
  assert.ok(Math.abs(point.x) < 1e-9);
  assert.ok(Math.abs(point.y) < 1e-9);
  assert.ok(Math.abs(point.z - 100) < 1e-9);

  const midLatitude = latLngToVector3(30, 0, 100);
  assert.ok(Math.abs(midLatitude.y - 50) < 1e-9);
  assert.ok(Math.abs(midLatitude.z - 86.6025403784) < 1e-9);
});

test('north and south poles project onto +Y / -Y', () => {
  const { latLngToVector3 } = globe();
  const north = latLngToVector3(90, 0, 100);
  assert.ok(Math.abs(north.x) < 1e-9);
  assert.ok(Math.abs(north.y - 100) < 1e-9);
  assert.ok(Math.abs(north.z) < 1e-9);

  const south = latLngToVector3(-90, 42, 100);
  assert.ok(Math.abs(south.x) < 1e-9);
  assert.ok(Math.abs(south.y + 100) < 1e-9);
  assert.ok(Math.abs(south.z) < 1e-9);
});

test('longitude grows eastward around +Y and the radius defaults to 100', () => {
  const { latLngToVector3 } = globe();
  const east = latLngToVector3(0, 90, 100);
  assert.ok(Math.abs(east.x - 100) < 1e-9);
  assert.ok(Math.abs(east.z) < 1e-9);

  const west = latLngToVector3(0, -90, 100);
  assert.ok(Math.abs(west.x + 100) < 1e-9);

  const antimeridian = latLngToVector3(0, 180, 100);
  assert.ok(Math.abs(antimeridian.z + 100) < 1e-9);

  const defaulted = latLngToVector3(30, 120);
  assert.ok(Math.abs(Math.hypot(defaulted.x, defaulted.y, defaulted.z) - 100) < 1e-9);
});

test('out-of-range and non-finite coordinates never throw and stay on the sphere', () => {
  const { latLngToVector3 } = globe();
  const clamped = latLngToVector3(140, 0, 100);
  assert.ok(Math.abs(clamped.y - 100) < 1e-9);
  const invalid = latLngToVector3(Number.NaN, Number.POSITIVE_INFINITY, 100);
  assert.equal(
    Math.abs(Math.hypot(invalid.x, invalid.y, invalid.z) - 100) < 1e-9,
    true,
  );
});

test('great-circle spline arches above the surface and returns to the radius at both ends', () => {
  const { calculateGreatCircleSpline, latLngToVector3 } = globe();
  const points = calculateGreatCircleSpline({ lat: 0, lng: 0 }, { lat: 0, lng: 90 });
  assert.equal(points.length, 30);

  const start = points[0];
  const end = points[points.length - 1];
  const expectedStart = latLngToVector3(0, 0, 100);
  const expectedEnd = latLngToVector3(0, 90, 100);
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Math.abs(start[axis] - expectedStart[axis]) < 1e-9, `start ${axis}`);
    assert.ok(Math.abs(end[axis] - expectedEnd[axis]) < 1e-9, `end ${axis}`);
  }

  const radii = points.map((point) => Math.hypot(point.x, point.y, point.z));
  assert.ok(Math.min(...radii) >= 100 - 1e-9, 'spline must never dip below the surface');
  assert.ok(Math.max(...radii) > 100, 'spline must lift above the surface');
  // An equator-to-equator arc must stay in the equatorial plane.
  for (const point of points) assert.ok(Math.abs(point.y) < 1e-9);
});

test('arc altitude scales the peak radius of the intercession beam', () => {
  const { calculateGreatCircleSpline } = globe();
  const radiusOf = (points) => points.map((point) => Math.hypot(point.x, point.y, point.z));

  // 31 points puts one sample exactly at the arc midpoint (t = 0.5).
  const points = calculateGreatCircleSpline({ lat: 0, lng: 0 }, { lat: 0, lng: 90 }, 1.25, 31);
  assert.equal(points.length, 31);
  const radii = radiusOf(points);
  assert.ok(Math.abs(Math.max(...radii) - 125) < 1e-9);
  assert.ok(Math.abs(Math.min(...radii) - 100) < 1e-9);

  const higher = radiusOf(
    calculateGreatCircleSpline({ lat: 0, lng: 0 }, { lat: 0, lng: 90 }, 1.5, 31),
  );
  assert.ok(Math.abs(Math.max(...higher) - 150) < 1e-9);
  assert.ok(Math.max(...higher) > Math.max(...radii));
});

test('spline honours the requested point count and tolerates coincident/antipodal points', () => {
  const { calculateGreatCircleSpline } = globe();
  const finite = (points) =>
    points.every(
      (point) =>
        Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z),
    );

  assert.equal(
    calculateGreatCircleSpline({ lat: 10, lng: 10 }, { lat: 20, lng: 20 }, 1.25, 6).length,
    6,
  );

  const coincident = calculateGreatCircleSpline({ lat: 5, lng: 5 }, { lat: 5, lng: 5 }, 1.25, 10);
  assert.equal(coincident.length, 10);
  assert.ok(finite(coincident));

  const antipodal = calculateGreatCircleSpline({ lat: 0, lng: 0 }, { lat: 0, lng: 180 }, 1.25, 12);
  assert.equal(antipodal.length, 12);
  assert.ok(finite(antipodal));
});

// ---------------------------------------------------------------------------
// Privacy-preserving gathering centroid layer
// ---------------------------------------------------------------------------

test('centroid jitter is deterministic for the same seed and bounded by 0.015 degrees', () => {
  const { sanitizeToCentroidWithJitter, MAX_CENTROID_JITTER_DEGREES } = globe();
  assert.equal(MAX_CENTROID_JITTER_DEGREES, 0.015);

  const first = sanitizeToCentroidWithJitter(AUSTIN.lat, AUSTIN.lng, 'gathering-123');
  for (let render = 0; render < 25; render += 1) {
    assert.deepEqual(
      sanitizeToCentroidWithJitter(AUSTIN.lat, AUSTIN.lng, 'gathering-123'),
      first,
    );
  }

  assert.ok(Math.abs(first.lat - AUSTIN.lat) <= MAX_CENTROID_JITTER_DEGREES + 1e-9);
  assert.ok(Math.abs(first.lng - AUSTIN.lng) <= MAX_CENTROID_JITTER_DEGREES + 1e-9);
  assert.notDeepEqual(first, AUSTIN);
});

test('different gathering ids receive different but stable placements', () => {
  const { sanitizeToCentroidWithJitter } = globe();
  const alpha = sanitizeToCentroidWithJitter(40.7128, -74.006, 'alpha');
  const beta = sanitizeToCentroidWithJitter(40.7128, -74.006, 'beta');
  assert.notDeepEqual(alpha, beta);
  assert.deepEqual(sanitizeToCentroidWithJitter(40.7128, -74.006, 'alpha'), alpha);
});

test('centroid jitter keeps every marker within 3km of the true location', () => {
  const { sanitizeToCentroidWithJitter } = globe();
  const sites = [
    { lat: 30.2672, lng: -97.7431 }, // Austin, TX
    { lat: 51.5074, lng: -0.1278 }, // London
    { lat: -33.8688, lng: 151.2093 }, // Sydney
    { lat: 64.1466, lng: -21.9426 }, // Reykjavik
    { lat: 0, lng: 0 }, // Equator / Prime Meridian
    { lat: 78.2232, lng: 15.6267 }, // Svalbard (near pole)
  ];

  for (const site of sites) {
    for (let seed = 0; seed < 40; seed += 1) {
      const jittered = sanitizeToCentroidWithJitter(site.lat, site.lng, `gathering-${seed}`);
      assert.ok(
        haversineMeters(site, jittered) < 3000,
        `marker for seed ${seed} drifted beyond 3km`,
      );
    }
  }
});

test('public markers expose only id, city, first name, count and jittered coordinates', async () => {
  const { api } = setupGatherings({ responses: [{ data: [SECRET_ROW], error: null }] });
  const result = await api.getPublicGatheringMarkers();

  assert.equal(result.ok, true);
  assert.equal(result.data.length, 1);

  const marker = result.data[0];
  assert.deepEqual(Object.keys(marker).sort(), [
    'city',
    'first_name',
    'id',
    'lat',
    'lng',
    'member_count',
  ]);
  assert.equal(marker.id, SECRET_ROW.id);
  assert.equal(marker.first_name, 'Johnathan');
  assert.equal(marker.city, 'Austin');
  assert.equal(marker.member_count, 12);

  // Coordinates come from the PostGIS EWKB payload, privacy-jittered.
  assert.ok(Math.abs(marker.lat - AUSTIN.lat) <= 0.015 + 1e-9);
  assert.ok(Math.abs(marker.lng - AUSTIN.lng) <= 0.015 + 1e-9);

  // Re-rendering the same gathering yields the exact same placement.
  const again = await setupGatherings({
    responses: [{ data: [SECRET_ROW], error: null }],
  }).api.getPublicGatheringMarkers();
  assert.deepEqual(plain(again.data[0]), plain(marker));
});

test('no street address, postal code, email, name field or full leader name leaks publicly', async () => {
  const { api } = setupGatherings({ responses: [{ data: [SECRET_ROW], error: null }] });
  const result = await api.getPublicGatheringMarkers();
  const serialized = JSON.stringify(result.data);

  for (const secret of [
    'Secret Street',
    SECRET_ROW.address,
    '78701',
    'Smithfield',
    'Johnathan Smithfield',
    'johnathan.smithfield@example.com',
    'Pastor',
    'Sundays',
  ]) {
    assert.equal(serialized.includes(secret), false, `${secret} leaked into the public payload`);
  }

  for (const forbiddenKey of ['address', 'leader_name', 'contact_email', 'description', 'name']) {
    assert.equal(
      serialized.includes(`"${forbiddenKey}"`),
      false,
      `${forbiddenKey} leaked as a payload key`,
    );
  }
});

test('coordinates resolve from PostGIS EWKB, fallback columns, GeoJSON and WKT', async () => {
  const rows = [
    {
      id: 'wkb',
      address: '1 A Street, Dallas, TX 75201',
      leader_name: 'Ana Reyes',
      location: wkbPointHex(-96.797, 32.7767),
    },
    {
      id: 'fallback-columns',
      address: '2 B Street, Denver, CO 80202',
      leader_name: 'Ben Lee',
      latitude: 39.7392,
      longitude: -104.9903,
    },
    {
      id: 'geojson',
      address: '3 C Street, Miami, FL 33101',
      leader_name: 'Cara Diaz',
      location: { type: 'Point', coordinates: [-80.1918, 25.7617] },
    },
    {
      id: 'wkt',
      address: '4 D Street, Seattle, WA 98101',
      leader_name: 'Dan Kim',
      location: 'SRID=4326;POINT(-122.3321 47.6062)',
    },
    { id: 'no-coordinates', address: '5 E Street, Boston, MA 02108', leader_name: 'Eve Fox' },
  ];

  const { api } = setupGatherings({ responses: [{ data: rows, error: null }] });
  const result = await api.getPublicGatheringMarkers();

  assert.equal(result.ok, true);
  assert.deepEqual(
    plain(result.data.map((marker) => marker.id)),
    ['wkb', 'fallback-columns', 'geojson', 'wkt'],
  );

  const expectations = {
    wkb: { lat: 32.7767, lng: -96.797, city: 'Dallas' },
    'fallback-columns': { lat: 39.7392, lng: -104.9903, city: 'Denver' },
    geojson: { lat: 25.7617, lng: -80.1918, city: 'Miami' },
    wkt: { lat: 47.6062, lng: -122.3321, city: 'Seattle' },
  };
  for (const [id, expected] of Object.entries(expectations)) {
    const marker = result.data.find((entry) => entry.id === id);
    assert.ok(Math.abs(marker.lat - expected.lat) <= 0.015 + 1e-9, `${id} latitude`);
    assert.ok(Math.abs(marker.lng - expected.lng) <= 0.015 + 1e-9, `${id} longitude`);
    assert.equal(marker.city, expected.city, `${id} city`);
  }
});

test('member_count falls back to 1 and non-approved rows never surface', async () => {
  const rows = [
    {
      id: 'no-count',
      address: '1 A Street, Austin, TX 78701',
      leader_name: 'Ana Reyes',
      latitude: 30.2,
      longitude: -97.7,
    },
    {
      id: 'rejected',
      status: 'rejected',
      address: '2 B Street, Austin, TX 78701',
      leader_name: 'Ben Lee',
      latitude: 30.2,
      longitude: -97.7,
    },
    {
      id: 'pending',
      status: 'pending',
      address: '3 C Street, Austin, TX 78701',
      leader_name: 'Cara Diaz',
      latitude: 30.2,
      longitude: -97.7,
    },
    {
      id: 'approved',
      status: 'approved',
      member_count: 9,
      address: '4 D Street, Austin, TX 78701',
      leader_name: 'Dan Kim',
      latitude: 30.2,
      longitude: -97.7,
    },
  ];

  const { api } = setupGatherings({ responses: [{ data: rows, error: null }] });
  const result = await api.getPublicGatheringMarkers();

  assert.equal(result.ok, true);
  assert.deepEqual(
    plain(result.data.map((marker) => marker.id)),
    ['no-count', 'approved'],
  );
  assert.equal(result.data.find((marker) => marker.id === 'no-count').member_count, 1);
  assert.equal(result.data.find((marker) => marker.id === 'approved').member_count, 9);
});

test('approved rows are requested with a bounded, newest-first query', async () => {
  const { api, calls } = setupGatherings({ responses: [{ data: [], error: null }] });
  await api.getPublicGatheringMarkers();

  assert.ok(calls.some(([method, table]) => method === 'from' && table === 'gatherings'));
  assert.ok(
    calls.some(([method, key, value]) => method === 'eq' && key === 'status' && value === 'approved'),
  );
  assert.ok(
    calls.some(
      ([method, key, value]) =>
        method === 'order' && key === 'created_at' && value.ascending === false,
    ),
  );
  assert.ok(
    calls.some(([method, count]) => method === 'limit' && typeof count === 'number' && count > 0),
  );
});

test('a schema without a status column still reads published rows', async () => {
  const { api, calls } = setupGatherings({
    responses: [
      { data: null, error: { message: 'column gatherings.status does not exist' } },
      { data: [SECRET_ROW], error: null },
    ],
  });
  const result = await api.getPublicGatheringMarkers();

  assert.equal(result.ok, true);
  assert.equal(result.data.length, 1);
  assert.equal(calls.filter(([method]) => method === 'from').length, 2);
});

test('read failures return ok:false with an empty payload and never throw', async () => {
  const { api } = setupGatherings({
    responses: [{ data: null, error: { message: 'The gathering feed is unavailable' } }],
  });
  const result = await api.getPublicGatheringMarkers();

  assert.equal(result.ok, false);
  assert.equal(result.data.length, 0);
  assert.equal(result.error, 'The gathering feed is unavailable');
});

test('missing configuration fails closed without throwing', async () => {
  const { api } = setupGatherings({ throws: true });
  const result = await api.getPublicGatheringMarkers();

  assert.equal(result.ok, false);
  assert.equal(result.data.length, 0);
  assert.equal(typeof result.error, 'string');
  assert.ok(result.error.length > 0);
});

/**
 * Regression: the homepage calls this during static prerender, so an
 * unconditional warning about the (expected) absent `status` column printed on
 * every build. The absent column is a schema difference, not a failure.
 */
test('an absent status column is probed once, silently, and never warns', async () => {
  const warnings = [];
  const consoleImpl = { ...console, warn: (...args) => warnings.push(args.join(' ')) };
  const { api, calls } = setupGatherings({
    responses: [
      { data: null, error: { message: 'column gatherings.status does not exist' } },
      { data: [SECRET_ROW], error: null },
    ],
    consoleImpl,
  });

  const first = await api.getPublicGatheringMarkers();
  assert.equal(first.ok, true);
  assert.equal(first.data.length, 1);
  assert.deepEqual(warnings, [], 'a missing status column must not warn');

  // The capability is cached: a second read skips the probe entirely.
  const fromCallsAfterFirst = calls.filter(([method]) => method === 'from').length;
  const second = await api.getPublicGatheringMarkers();
  assert.equal(second.ok, true);
  assert.equal(second.data.length, 1);
  assert.equal(
    calls.filter(([method]) => method === 'from').length,
    fromCallsAfterFirst + 1,
    'a cached absent status column must issue one unfiltered read, not a probe plus a read',
  );
  assert.deepEqual(warnings, [], 'the cached absent state must stay silent');
});

test('SQLSTATE 42703 counts as an absent column regardless of message wording', async () => {
  const warnings = [];
  const consoleImpl = { ...console, warn: (...args) => warnings.push(args.join(' ')) };
  const { api } = setupGatherings({
    responses: [
      { data: null, error: { code: '42703', message: 'undefined column' } },
      { data: [SECRET_ROW], error: null },
    ],
    consoleImpl,
  });

  const result = await api.getPublicGatheringMarkers();
  assert.equal(result.ok, true);
  assert.deepEqual(warnings, []);
});

test('a genuine status-filtered read failure is still reported', async () => {
  const warnings = [];
  const consoleImpl = { ...console, warn: (...args) => warnings.push(args.join(' ')) };
  const { api } = setupGatherings({
    responses: [
      {
        data: null,
        error: { code: '42501', message: 'permission denied for table gatherings' },
      },
      { data: [SECRET_ROW], error: null },
    ],
    consoleImpl,
  });

  const result = await api.getPublicGatheringMarkers();
  assert.equal(result.ok, true);
  assert.equal(warnings.length, 1, 'an unexpected read failure must remain visible');
  assert.match(warnings[0], /permission denied/);
});

// ---------------------------------------------------------------------------
// Phase 5 — Milestone A: live host connect inquiries
// ---------------------------------------------------------------------------

const VALID_INQUIRY = {
  gathering_id: 'gathering-1',
  visitor_name: 'Ada Lovelace',
  contact: 'ada@example.com',
  message: 'I would love to visit this Sunday.',
};

test('inquiries insert a strict, privacy-safe payload into gathering_inquiries', async () => {
  const { api, calls } = setupGatherings({
    responses: [{ data: [{ id: 'inq-1' }], error: null }],
  });
  const result = await api.submitGatheringInquiry({
    ...VALID_INQUIRY,
    visitor_name: '  Ada Lovelace  ',
    message: `  ${VALID_INQUIRY.message}  `,
  });

  assert.deepEqual(plain(result), { ok: true, delivered: 'remote' });
  assert.ok(
    calls.some(([method, table]) => method === 'from' && table === 'gathering_inquiries'),
  );
  const insert = calls.find(([method]) => method === 'insert');
  assert.deepEqual(plain(insert[1]), {
    gathering_id: 'gathering-1',
    visitor_name: 'Ada Lovelace',
    contact: 'ada@example.com',
    message: 'I would love to visit this Sunday.',
  });
});

test('a missing gathering_inquiries table fails open with simulated success', async () => {
  const { api } = setupGatherings({
    responses: [{
      data: null,
      error: { code: '42P01', message: 'relation "public.gathering_inquiries" does not exist' },
    }],
  });
  const result = await api.submitGatheringInquiry({
    ...VALID_INQUIRY,
    contact: '+1 555 123 4567',
    message: null,
  });
  assert.deepEqual(plain(result), { ok: true, delivered: 'simulated' });
});

test('a PGRST205 schema-cache miss also fails open with simulated success', async () => {
  const { api } = setupGatherings({
    responses: [{
      data: null,
      error: {
        code: 'PGRST205',
        message: "Could not find the table 'public.gathering_inquiries' in the schema cache",
      },
    }],
  });
  const result = await api.submitGatheringInquiry(VALID_INQUIRY);
  assert.deepEqual(plain(result), { ok: true, delivered: 'simulated' });
});

test('invalid inquiries are rejected locally without touching the network', async () => {
  const { api, calls } = setupGatherings();
  const cases = [
    { ...VALID_INQUIRY, gathering_id: '' },
    { ...VALID_INQUIRY, visitor_name: '   ' },
    { ...VALID_INQUIRY, contact: '' },
    { ...VALID_INQUIRY, contact: 'not-a-contact' },
    { ...VALID_INQUIRY, message: 'too short' },
  ];
  for (const payload of cases) {
    const result = await api.submitGatheringInquiry(payload);
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(payload)}`);
  }
  assert.equal(
    calls.filter(([method]) => method === 'from').length,
    0,
    'invalid payloads must never reach the database',
  );
});

test('an empty message is normalised to null and stored text is bounded', async () => {
  const { api, calls } = setupGatherings({
    responses: [{ data: [{ id: 'inq-2' }], error: null }],
  });
  const whitespaceOnly = await api.submitGatheringInquiry({
    ...VALID_INQUIRY,
    message: '     ',
  });
  assert.equal(whitespaceOnly.ok, true);
  const nullInsert = calls.find(([method]) => method === 'insert');
  assert.equal(nullInsert[1].message, null);

  const long = 'x'.repeat(2000);
  const bounded = await api.submitGatheringInquiry({
    ...VALID_INQUIRY,
    message: `  ${long}  `,
  });
  assert.equal(bounded.ok, true);
  const boundInsert = calls.filter(([method]) => method === 'insert')[1];
  assert.equal(boundInsert[1].message.length, 1000);
  assert.equal(boundInsert[1].visitor_name, 'Ada Lovelace');
});

test('genuine insert failures surface an error, never throw, and never log visitor contact', async () => {
  const logs = [];
  // Spread the real console so the double is a complete `Console`, matching the other
  // doubles in this file — a partial literal would silently drop every other method.
  const consoleImpl = {
    ...console,
    error: (...args) => logs.push(args.join(' ')),
    warn: (...args) => logs.push(args.join(' ')),
    log: (...args) => logs.push(args.join(' ')),
  };
  const { api } = setupGatherings({
    responses: [{
      data: null,
      error: { message: 'new row violates row-level security policy' },
    }],
    consoleImpl,
  });
  const result = await api.submitGatheringInquiry({
    ...VALID_INQUIRY,
    contact: 'ada+private@example.com',
  });

  assert.equal(result.ok, false);
  assert.ok(typeof result.error === 'string' && result.error.length > 0);
  assert.ok(!JSON.stringify(logs).includes('ada+private@example.com'),
    'visitor contact details must never appear in logs');
});

test('validateGatheringInquiryInput returns field-scoped error copy', () => {
  const { api } = setupGatherings();

  assert.deepEqual(
    plain(api.validateGatheringInquiryInput({ name: '   ', contact: '', message: '' })),
    {
      name: 'Please share your name.',
      contact: 'Enter an email address or a WhatsApp phone number.',
    },
  );
  assert.deepEqual(
    plain(api.validateGatheringInquiryInput({ name: 'Ada', contact: 'not-a-contact', message: 'hi' })),
    {
      contact: 'Enter an email address or a WhatsApp phone number.',
      message: 'Add a little more detail — at least 10 characters, or leave this empty.',
    },
  );
  assert.deepEqual(
    plain(api.validateGatheringInquiryInput({
      name: 'Ada',
      contact: '+1 555 123 4567',
      message: 'I would love to visit this Sunday.',
    })),
    {},
    'a valid form yields no errors',
  );
});
