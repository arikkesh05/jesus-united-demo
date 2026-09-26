import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import vm from 'node:vm';

/**
 * Sprint 1 - verification suite for the pure playback core in
 * `src/lib/audioEngine.ts`. Same sandbox strategy as globeSearch.test.mjs and
 * watchmanStage.test.mjs: node:test + ts.transpileModule + node:vm, so the
 * timestamp arithmetic, the speed cycle, the cue resolver and the persistence
 * contract are all verified without a DOM, a media element or a browser.
 *
 * The player's own transport (play/pause/mute/source fallback) is deliberately
 * NOT retested here: it needs a real `HTMLAudioElement`, and AudioPlayer.tsx
 * already owns it. What lives here is the logic that decides what the reader is
 * told, which is exactly the part a media element cannot tell us twice.
 */
const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = ts.transpileModule(
  readFileSync(new URL('../src/lib/audioEngine.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;

const moduleObj = { exports: {} };
vm.runInNewContext(source, {
  exports: moduleObj.exports,
  module: moduleObj,
  require: () => undefined,
  console,
});

const engine = moduleObj.exports;
const {
  PLAYBACK_SPEEDS,
  PLAYBACK_STORAGE_PREFIX,
  formatTimestamp,
  parseTimestamp,
  formatSpeedLabel,
  formatRemainingLabel,
  normalizeSpeedIndex,
  cycleSpeedIndex,
  speedAtIndex,
  hasUsableDuration,
  clampSeekTime,
  progressFraction,
  seekTimeFromFraction,
  isAutoplayRejection,
  isPlaybackComplete,
  buildEvenCues,
  activeCueAt,
  cueProgress,
  playbackStorageKey,
  emptyPlaybackMemory,
  readPlaybackMemory,
  serializePlaybackMemory,
  resumeTimeFor,
} = engine;

/**
 * Objects built inside the vm realm carry that realm's `Object.prototype`, so
 * `assert.deepEqual` (strict) reports them as unequal to a literal of identical
 * shape. Round-tripping through JSON drops the foreign prototype and lets strict
 * deep-equality compare what it is actually meant to compare. Same helper
 * globeSearch.test.mjs uses.
 */
const plain = (value) => JSON.parse(JSON.stringify(value));
const rawDeepEqual = assert.deepEqual.bind(assert);
function eq(actual, expected) {
  rawDeepEqual(plain(actual), plain(expected));
}

describe('audioEngine — timestamp formatting', () => {
  it('pads minutes so the counter keeps a fixed width for every short track', () => {
    // The bug this replaces: formatTime emitted `m:ss`, so 0:09 grew to 0:59
    // and then to 1:00 - the label visibly changed width mid-playback.
    assert.equal(formatTimestamp(0), '00:00');
    assert.equal(formatTimestamp(9), '00:09');
    assert.equal(formatTimestamp(59), '00:59');
    assert.equal(formatTimestamp(60), '01:00');
    assert.equal(formatTimestamp(605), '10:05');
    assert.equal(formatTimestamp(3599), '59:59');
  });

  it('widens to h:mm:ss only past the hour', () => {
    assert.equal(formatTimestamp(3600), '1:00:00');
    assert.equal(formatTimestamp(3725), '1:02:05');
    assert.equal(formatTimestamp(36000), '10:00:00');
  });

  it('floors rather than rounds, so the counter never shows time it has not played', () => {
    assert.equal(formatTimestamp(9.99), '00:09');
    assert.equal(formatTimestamp(59.5), '00:59');
    assert.equal(formatTimestamp(0.4), '00:00');
  });

  it('treats NaN, Infinity and negatives as unknown rather than rendering them', () => {
    // `duration` is NaN until metadata loads - a literal "NaN:NaN" in the UI
    // is the exact failure this guards.
    assert.equal(formatTimestamp(NaN), '00:00');
    assert.equal(formatTimestamp(Infinity), '00:00');
    assert.equal(formatTimestamp(-Infinity), '00:00');
    assert.equal(formatTimestamp(-12), '00:00');
  });
});

describe('audioEngine — timestamp parsing', () => {
  it('round-trips every value formatTimestamp produces', () => {
    for (const seconds of [0, 9, 59, 60, 605, 3599, 3600, 3725, 36000]) {
      assert.equal(
        parseTimestamp(formatTimestamp(seconds)),
        seconds,
        `${formatTimestamp(seconds)} must parse back to ${seconds}`,
      );
    }
  });

  it('accepts a bare number of seconds, which is the persisted shape', () => {
    assert.equal(parseTimestamp('90'), 90);
    assert.equal(parseTimestamp('0'), 0);
    assert.equal(parseTimestamp('12.5'), 12.5);
    assert.equal(parseTimestamp('  42  '), 42);
  });

  it('reads mm:ss and h:mm:ss right-associatively', () => {
    assert.equal(parseTimestamp('01:30'), 90);
    assert.equal(parseTimestamp('10:05'), 605);
    assert.equal(parseTimestamp('1:00:00'), 3600);
  });

  it('returns 0 for corrupt input so a bad store restarts instead of breaking', () => {
    for (const bad of ['', '   ', 'abc', '1:2:3:4', '1:xx', '::', '1:', '-5']) {
      assert.equal(parseTimestamp(bad), 0, `${JSON.stringify(bad)} must not parse`);
    }
  });
});

describe('audioEngine — playback rate', () => {
  it('offers exactly the three documented rates', () => {
    eq(Array.from(PLAYBACK_SPEEDS), [1, 1.25, 1.5]);
  });

  it('cycles forward and wraps back to 1x from the fastest rate', () => {
    assert.equal(cycleSpeedIndex(0), 1);
    assert.equal(cycleSpeedIndex(1), 2);
    assert.equal(cycleSpeedIndex(2), 0);
  });

  it('cycles backward and wraps to the fastest from 1x', () => {
    assert.equal(cycleSpeedIndex(0, -1), 2);
    assert.equal(cycleSpeedIndex(2, -1), 1);
  });

  it('survives a stale or hostile index from storage', () => {
    assert.equal(normalizeSpeedIndex(NaN), 0);
    assert.equal(normalizeSpeedIndex(-5), 0);
    assert.equal(normalizeSpeedIndex(99), 2);
    assert.equal(normalizeSpeedIndex(1.7), 1);
    // Cycling from an out-of-range index must not produce a NaN index.
    assert.equal(cycleSpeedIndex(99), 0);
    assert.equal(cycleSpeedIndex(NaN), 1);
    assert.equal(speedAtIndex(99), 1.5);
  });


describe('audioEngine — duration and seeking', () => {
  it('refuses to treat an unloaded or live track as having a duration', () => {
    assert.equal(hasUsableDuration(NaN), false);
    assert.equal(hasUsableDuration(Infinity), false);
    assert.equal(hasUsableDuration(0), false);
    assert.equal(hasUsableDuration(-1), false);
    assert.equal(hasUsableDuration(12.5), true);
  });

  it('clamps a seek to the track instead of wrapping past the end', () => {
    assert.equal(clampSeekTime(-10, 100), 0);
    assert.equal(clampSeekTime(50, 100), 50);
    assert.equal(clampSeekTime(140, 100), 100);
    assert.equal(clampSeekTime(NaN, 100), 0);
    // No duration yet: every seek collapses to the start rather than moving.
    assert.equal(clampSeekTime(50, 0), 0);
  });

  it('reports progress as a clean 0..1 fraction', () => {
    assert.equal(progressFraction(0, 100), 0);
    assert.equal(progressFraction(50, 100), 0.5);
    assert.equal(progressFraction(100, 100), 1);
    assert.equal(progressFraction(140, 100), 1, 'must not exceed 1');
    assert.equal(progressFraction(-5, 100), 0, 'must not go negative');
  });

  it('reports zero progress rather than NaN before metadata loads', () => {
    // The divide-by-zero that would otherwise collapse the progress bar.
    assert.equal(progressFraction(0, NaN), 0);
    assert.equal(progressFraction(30, 0), 0);
    assert.ok(Number.isFinite(progressFraction(30, NaN)));
  });

  it('turns a waveform click into a seek target', () => {
    assert.equal(seekTimeFromFraction(0, 200), 0);
    assert.equal(seekTimeFromFraction(0.5, 200), 100);
    assert.equal(seekTimeFromFraction(1, 200), 200);
  });

  it('clamps a pointer that reports a coordinate outside the track', () => {
    // Dragging past the window edge can report a fraction outside 0..1.
    assert.equal(seekTimeFromFraction(-0.4, 200), 0);
    assert.equal(seekTimeFromFraction(1.7, 200), 200);
    assert.equal(seekTimeFromFraction(NaN, 200), 0);
    assert.equal(seekTimeFromFraction(0.5, 0), 0);
  });

  it('recognises the end of the track within a tick of slack', () => {
    assert.equal(isPlaybackComplete(100, 100), true);
    assert.equal(isPlaybackComplete(99.9, 100), true);
    assert.equal(isPlaybackComplete(50, 100), false);
    assert.equal(isPlaybackComplete(0, NaN), false, 'no duration, not complete');
  });
});

describe('audioEngine — autoplay policy', () => {
  it('recognises a policy rejection as recoverable, not as a broken track', () => {
    // This is the difference between "tap to play" and "audio unavailable" -
    // the old handler reported both as a hard failure.
    assert.equal(isAutoplayRejection({ name: 'NotAllowedError' }), true);
    assert.equal(isAutoplayRejection({ name: 'AbortError' }), true);
  });

  it('does not swallow a genuine media failure', () => {
    assert.equal(isAutoplayRejection({ name: 'NotSupportedError' }), false);
    assert.equal(isAutoplayRejection(new Error('boom')), false);
    assert.equal(isAutoplayRejection(null), false);
    assert.equal(isAutoplayRejection('NotAllowedError'), false);
    assert.equal(isAutoplayRejection(undefined), false);
  });
});

  it('treats a zero or non-finite step as a no-op instead of dividing by zero', () => {
    assert.equal(cycleSpeedIndex(1, 0), 1);
    assert.equal(cycleSpeedIndex(1, NaN), 1);
  });

  it('labels rates without float noise', () => {
    assert.equal(formatSpeedLabel(1), '1x');
    assert.equal(formatSpeedLabel(1.25), '1.25x');
    assert.equal(formatSpeedLabel(1.5), '1.5x');
    assert.equal(formatSpeedLabel(NaN), '1x');
  });
});

describe('audioEngine — remaining-time label', () => {
  it('reads as a plain duration while there is plenty left', () => {
    // Whole minutes drop the seconds clause rather than reading "5 min 0 sec".
    assert.equal(formatRemainingLabel(0, 300), '5 min left');
    assert.equal(formatRemainingLabel(120, 300), '3 min left');
    assert.equal(formatRemainingLabel(270, 300), '30 sec left');
    assert.equal(formatRemainingLabel(100, 300), '3 min 20 sec left');
    // Rounded up, so the label never says "0 sec left" while audio is playing.
    assert.equal(formatRemainingLabel(299.2, 300), '1 sec left');
  });

  it('reports the end rather than a zero countdown', () => {
    assert.equal(formatRemainingLabel(300, 300), 'Finished');
    assert.equal(formatRemainingLabel(320, 300), 'Finished');
  });

  it('stays silent before the duration is known', () => {
    // An empty string renders nothing, rather than a misleading "0 sec left".
    assert.equal(formatRemainingLabel(0, 0), '');
    assert.equal(formatRemainingLabel(0, NaN), '');
  });
});

describe('audioEngine — scripture cue anchors', () => {
  const promptIds = ['anchor-word', 'grace-noticed', 'one-small-step'];

  it('does not light a prompt at zero - the reader has heard nothing yet', () => {
    const cues = buildEvenCues(promptIds, 300);
    assert.ok(
      cues[0].at > 0,
      'the first cue must sit after the opening, not on it',
    );
    assert.equal(activeCueAt(cues, 0, 300), null);
  });

  it('spaces the cues in order and inside the track', () => {
    const cues = buildEvenCues(promptIds, 300);
    eq(cues.map((cue) => cue.id), promptIds);
    for (let i = 1; i < cues.length; i += 1) {
      assert.ok(cues[i].at > cues[i - 1].at, 'cues must be strictly increasing');
    }
    assert.ok(cues[cues.length - 1].at < 1, 'the last cue must land before the end');
  });

  it('returns a stable ordering even before the duration is known', () => {
    // The player renders cues against a track that has not loaded metadata yet.
    const cues = buildEvenCues(promptIds, NaN);
    eq(cues.map((cue) => cue.id), promptIds);
    assert.equal(activeCueAt(cues, 0, NaN), null);
  });

  it('holds the earlier prompt lit between two cues instead of flickering', () => {
    const cues = buildEvenCues(promptIds, 300);
    const first = cues[0].at * 300;
    const second = cues[1].at * 300;

    assert.equal(activeCueAt(cues, first, 300).id, 'anchor-word');
    // Mid-gap: still the first prompt, not null and not the second.
    assert.equal(activeCueAt(cues, (first + second) / 2, 300).id, 'anchor-word');
    assert.equal(activeCueAt(cues, second, 300).id, 'grace-noticed');
  });

  it('ignores malformed cues rather than lighting a blank prompt', () => {
    const cues = [
      { id: 'good', at: 0.2 },
      { id: '', at: 0.3 },
      null,
      { id: 'nan', at: NaN },
      { id: 'past-end', at: 4 },
    ];
    const active = activeCueAt(cues, 300, 300);
    assert.equal(active.id, 'good');
  });

  it('returns null for an empty cue list or a negative position', () => {
    assert.equal(activeCueAt([], 10, 100), null);
    assert.equal(activeCueAt(buildEvenCues(promptIds, 100), -1, 100), null);
  });

  it('ramps cue progress from 0 to 1 for the pulse', () => {
    const cue = { id: 'anchor-word', at: 0.5 };
    assert.equal(cueProgress(cue, 0, 100), 0);
    assert.equal(cueProgress(cue, 25, 100), 0.5);
    assert.equal(cueProgress(cue, 200, 100), 1, 'must clamp past the cue');
    assert.equal(cueProgress(null, 50, 100), 0);
    assert.equal(cueProgress(cue, 50, NaN), 0);
  });
});

describe('audioEngine — playback memory across navigation', () => {
  it('gives every track its own namespaced key', () => {
    const a = playbackStorageKey('/audio/daily-reflection.mp3');
    const b = playbackStorageKey('/audio/other.mp3');
    assert.ok(a.startsWith(PLAYBACK_STORAGE_PREFIX));
    assert.notEqual(a, b);
    assert.equal(a, playbackStorageKey('/audio/daily-reflection.mp3'));
  });

  it('round-trips a written position', () => {
    const memory = { currentTime: 42.5, completed: false, speedIndex: 2 };
    eq(readPlaybackMemory(serializePlaybackMemory(memory)), memory);
  });

  it('degrades to "never played" on corrupt or absent state', () => {
    const empty = emptyPlaybackMemory();
    eq(readPlaybackMemory(null), empty);
    eq(readPlaybackMemory(''), empty);
    eq(readPlaybackMemory('{half written'), empty);
    eq(readPlaybackMemory('"a string"'), empty);
    eq(readPlaybackMemory('null'), empty);
  });

  it('never lets a hostile store inject a negative time or a bad rate', () => {
    const parsed = readPlaybackMemory(
      JSON.stringify({ currentTime: -99, completed: 'yes', speedIndex: 42 }),
    );
    assert.equal(parsed.currentTime, 0);
    assert.equal(parsed.completed, false, 'only a real boolean true counts');
    assert.equal(parsed.speedIndex, 2, 'an out-of-range rate clamps to the fastest');
  });

  it('resumes mid-track, and restarts a finished one', () => {
    const mid = { currentTime: 60, completed: false, speedIndex: 0 };
    assert.equal(resumeTimeFor(mid, 300), 60);

    // Resuming at the very end would look identical to "finished" and play
    // would stop again immediately.
    const done = { currentTime: 299, completed: true, speedIndex: 0 };
    assert.equal(resumeTimeFor(done, 300), 0);
  });

  it('restarts when the stored position belongs to a longer previous track', () => {
    const stale = { currentTime: 900, completed: false, speedIndex: 0 };
    assert.equal(resumeTimeFor(stale, 300), 0);
  });

  it('keeps the position when the duration is not known yet', () => {
    const mid = { currentTime: 60, completed: false, speedIndex: 0 };
    assert.equal(resumeTimeFor(mid, NaN), 60);
  });
});
