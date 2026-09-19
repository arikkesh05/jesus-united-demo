import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import vm from 'node:vm';

/**
 * Sprint 3 — verification suite for the pure search core in
 * `src/lib/globeSearch.ts`. Same sandbox strategy as globeScene.test.mjs:
 * node:test + ts.transpileModule + node:vm, so query behaviour is verified
 * without a DOM or a GPU.
 */
const require = createRequire(import.meta.url);
const ts = require('typescript');

const transpile = (relativeSource) => ts.transpileModule(relativeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const source = transpile(
  readFileSync(new URL('../src/lib/globeSearch.ts', import.meta.url), 'utf8'),
);

const exports = {};
const moduleObj = { exports };
vm.runInNewContext(source, { exports, module: moduleObj, require: () => undefined, console });

const {
  SEARCH_RESULT_LIMIT, SEARCH_FALLBACK_NAME,
  foldSearchText, tokenizeSearchQuery, searchEntryName, searchGlobeMarkers,
  buildSearchIndex, moveSearchSelection, formatSearchResultMeta,
  searchStatusMessage, searchOptionLabel,
} = moduleObj.exports;

const { SEARCH_IGNORED_TOKENS } = moduleObj.exports;

/** Copies a value across the vm realm boundary so strict deep-equality applies. */
const plain = (value) => JSON.parse(JSON.stringify(value));
const rawDeepEqual = assert.deepEqual.bind(assert);
function eq(actual, expected) {
  rawDeepEqual(plain(actual), plain(expected));
}


function marker(id, first_name, city, member_count) {
  return { id, first_name, city, member_count };
}

describe('globeSearch — foldSearchText', () => {
  it('is case-insensitive and collapses whitespace', () => {
    assert.equal(foldSearchText('  San   José  '), 'san jose');
    assert.equal(foldSearchText('AUSTIN'), 'austin');
  });
  it('strips diacritics via NFD normalization', () => {
    assert.equal(foldSearchText('Ástrid'), 'astrid');
    assert.equal(foldSearchText('Müller'), 'muller');
  });
  it('ignores non-string input safely', () => {
    assert.equal(foldSearchText(null), '');
    assert.equal(foldSearchText(undefined), '');
    assert.equal(foldSearchText(42), '');
  });
});

describe('globeSearch — tokenizeSearchQuery', () => {
  it('splits on whitespace and commas and dedupes', () => {
    eq(tokenizeSearchQuery('Austin, austin'), ['austin']);
  });
  it('drops the generic noise tokens', () => {
    eq(tokenizeSearchQuery('gatherings 3'), ['3']);
    eq(tokenizeSearchQuery('gathering'), []);
  });
  it('returns empty for nullish/blank input', () => {
    eq(tokenizeSearchQuery(''), []);
    eq(tokenizeSearchQuery('   '), []);
    eq(tokenizeSearchQuery(null), []);
  });
});

describe('globeSearch — searchEntryName', () => {
  it('uses the trimmed name when present', () => {
    assert.equal(searchEntryName({ first_name: '  Grace  ' }), 'Grace');
  });
  it('falls back for missing/blank names', () => {
    assert.equal(searchEntryName({ first_name: '' }), SEARCH_FALLBACK_NAME);
    assert.equal(searchEntryName({ first_name: null }), SEARCH_FALLBACK_NAME);
    assert.equal(searchEntryName({}), SEARCH_FALLBACK_NAME);
  });
});

describe('globeSearch — SEARCH_IGNORED_TOKENS', () => {
  it('exposes the generic noise words that get stripped', () => {
    eq(SEARCH_IGNORED_TOKENS, ['gathering', 'gatherings']);
  });
});

describe('globeSearch — buildSearchIndex', () => {
  it('folds every field and precomputes tokens', () => {
    const idx = buildSearchIndex([marker('m1', 'Grace', 'Austin', 3)]);
    assert.equal(idx.length, 1);
    assert.equal(idx[0].haystack, 'grace austin 3');
    eq(idx[0].nameTokens, ['grace']);
    eq(idx[0].cityTokens, ['austin']);
  });
  it('preserves payload order', () => {
    const idx = buildSearchIndex([
      marker('a', 'Zoë', 'Ålesund', 1),
      marker('b', 'Aaron', 'Zanzibar', 9),
    ]);
    eq(idx.map((e) => e.id), ['a', 'b']);
    assert.equal(idx[0].haystack, 'zoe alesund 1');
  });
  it('treats non-array input as empty', () => {
    eq(buildSearchIndex(null), []);
    eq(buildSearchIndex(undefined), []);
  });
});

describe('globeSearch — searchGlobeMarkers', () => {
  const index = buildSearchIndex([
    marker('a', 'Marcus', 'Austin', 12),
    marker('b', 'David', 'Austin', 5),
    marker('c', 'Sarah', 'Dallas', 3),
    marker('d', '', 'El Paso', 1),
  ]);

  it('AND-matches name and city', () => {
    eq(
      searchGlobeMarkers(index, 'marcus austin').results.map((r) => r.id),
      ['a'],
    );
  });
  it('is case-insensitive', () => {
    eq(
      searchGlobeMarkers(index, 'MARCUS').results.map((r) => r.id),
      ['a'],
    );
  });
  it('matches a count token', () => {
    eq(
      searchGlobeMarkers(index, '3').results.map((r) => r.id),
      ['c'],
    );
  });
  it('ranks a name-prefix hit above a city-only hit', () => {
    assert.equal(searchGlobeMarkers(index, 'marcus').results[0].id, 'a');
  });
  it('returns every city match, payload-ordered on an equal score', () => {
    eq(
      searchGlobeMarkers(index, 'austin').results.map((r) => r.id),
      ['a', 'b'],
    );
  });
  it('drops noise tokens so "gatherings 3" means count == 3', () => {
    eq(
      searchGlobeMarkers(index, 'gatherings 3').results.map((r) => r.id),
      ['c'],
    );
  });
  it('returns the prompt/empty state for a blank or noise-only query', () => {
    const empty = searchGlobeMarkers(index, '');
    assert.equal(empty.isEmptyQuery, true);
    assert.equal(empty.total, 0);
    eq(empty.results, []);
    const noise = searchGlobeMarkers(index, '   gatherings   ');
    assert.equal(noise.isEmptyQuery, true);
    assert.equal(noise.total, 0);
  });
  it('returns the no-match state for an unmatched query', () => {
    const none = searchGlobeMarkers(index, 'zzz');
    assert.equal(none.isEmptyQuery, false);
    assert.equal(none.total, 0);
    eq(none.results, []);
  });
  it('caps results at SEARCH_RESULT_LIMIT and flags truncation', () => {
    const many = buildSearchIndex(
      Array.from({ length: 12 }, (_, i) => marker(String(i), 'Ab', 'CD', i)),
    );
    const res = searchGlobeMarkers(many, 'ab');
    assert.equal(res.results.length, SEARCH_RESULT_LIMIT);
    assert.equal(res.truncated, true);
    assert.equal(res.total, 12);
  });
  it('never returns more than the requested limit', () => {
    const many = buildSearchIndex(
      Array.from({ length: 5 }, (_, i) => marker(String(i), 'Ab', 'CD', i)),
    );
    const res = searchGlobeMarkers(many, 'ab', 2);
    assert.equal(res.results.length, 2);
    assert.equal(res.truncated, true);
  });
});

describe('globeSearch — moveSearchSelection', () => {
  it('returns -1 for an empty list', () => {
    assert.equal(moveSearchSelection(0, 1, 0), -1);
    assert.equal(moveSearchSelection(0, 1, -1), -1);
  });
  it('wraps around at both ends with arrow deltas', () => {
    assert.equal(moveSearchSelection(0, 1, 3), 1);
    assert.equal(moveSearchSelection(2, 1, 3), 0);
    assert.equal(moveSearchSelection(0, -1, 3), 2);
  });
  it('enters the list from the correct end', () => {
    assert.equal(moveSearchSelection(-1, 1, 3), 0);
    assert.equal(moveSearchSelection(-1, -1, 3), 2);
  });
    it('steps by more than one when given a larger delta', () => {
    assert.equal(moveSearchSelection(0, 3, 5), 3);
  });
});

describe('globeSearch — copy formatters', () => {
  const entry = buildSearchIndex([marker('a', 'Marcus', 'Austin', 3)])[0];

  it('formats metadata as "City · N Gatherings" (pluralized)', () => {
    assert.equal(formatSearchResultMeta(entry), 'Austin · 3 Gatherings');
    const one = buildSearchIndex([marker('a', 'Marcus', 'Austin', 1)])[0];
    assert.equal(formatSearchResultMeta(one), 'Austin · 1 Gathering');
    const noCity = buildSearchIndex([marker('a', 'Marcus', '', 2)])[0];
    assert.equal(formatSearchResultMeta(noCity), '2 Gatherings');
  });
  it('builds an accessible row label', () => {
    assert.equal(searchOptionLabel(entry), 'Marcus, Austin · 3 Gatherings');
  });
  it('renders human status copy for each result state', () => {
    const empty = { query: '', tokens: [], results: [], isEmptyQuery: true, total: 0, truncated: false };
    assert.match(searchStatusMessage(empty), /Type a name, city, or gathering count/);
    const none = { query: 'zzz', tokens: ['zzz'], results: [], isEmptyQuery: false, total: 0, truncated: false };
    assert.match(searchStatusMessage(none), /No ambassadors match/);
    const capped = { query: 'ab', tokens: ['ab'], results: [], isEmptyQuery: false, total: 11, truncated: true };
    assert.match(searchStatusMessage(capped), /showing the top/);
    const one = { query: 'ab', tokens: ['ab'], results: [], isEmptyQuery: false, total: 1, truncated: false };
    assert.match(searchStatusMessage(one), /1 match/);
    const many = { query: 'ab', tokens: ['ab'], results: [], isEmptyQuery: false, total: 5, truncated: false };
    assert.match(searchStatusMessage(many), /5 matches/);
  });
});
