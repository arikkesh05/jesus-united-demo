import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import vm from 'node:vm';

/**
 * Sprint 3 — verification suite for the time-gated Altar rhythms, the private
 * journal store and the Examen state machine:
 *
 *   src/lib/altarRhythms.ts   liturgical clock · rhythm count · exam steps
 *   src/lib/altarJournal.ts   localStorage persistence, drafts and streaks
 *
 * Same sandbox strategy as the other lib suites: node:test + ts.transpileModule
 * + node:vm. Two wrinkles this file has to respect:
 *
 *  - **Cross-realm dates.** The modules guard their clocks with
 *    `instanceof Date`, and a `Date` built in the host realm is *not* an
 *    instance of the sandbox's `Date`. So every clock reading is constructed
 *    inside the context by the injected `at()` helper.
 *  - **Cross-realm strict equality.** `assert.deepEqual` compares prototypes, so
 *    every value that crosses the boundary goes through `plain()` first — both
 *    sides, or a self-comparison fails.
 *
 * Every rule that protects a visitor — the dawn roll, the advisory gate, the
 * grace-season bridge, draft recovery, a refused write — is pinned here without
 * a DOM, a network or a GPU.
 */
const require = createRequire(import.meta.url);
const ts = require('typescript');

const transpile = (relativePath) =>
  ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;

/** Copies a value across the vm realm boundary so strict deep-equality applies. */
const plain = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const rawDeepEqual = assert.deepEqual.bind(assert);
function eq(actual, expected) {
  rawDeepEqual(plain(actual), plain(expected));
}

/**
 * A localStorage double. `failOn` lets a test simulate a device that refuses to
 * write (private browsing, full quota) and `seed` a corrupted payload.
 */
function fakeStorage({ seed = null, failOn = null, throwOnRead = false } = {}) {
  const data = new Map();
  if (seed !== null) data.set('jesusunited:altar-journal:v1', seed);
  const storage = {
    reads: 0,
    writes: 0,
    removals: 0,
    getItem(key) {
      storage.reads += 1;
      if (throwOnRead) throw new Error('SecurityError: storage is blocked');
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (failOn === 'write') throw new Error('QuotaExceededError');
      storage.writes += 1;
      data.set(key, String(value));
    },
    removeItem(key) {
      if (failOn === 'remove') throw new Error('QuotaExceededError');
      storage.removals += 1;
      data.delete(key);
    },
    raw: (key = 'jesusunited:altar-journal:v1') =>
      data.has(key) ? data.get(key) : null,
  };
  return storage;
}

/**
 * Loads a lib module in an isolated context. `clients` maps an import path to a
 * factory so each module can be stubbed independently; `storage` attaches a
 * fake `window` (omit it entirely to exercise the SSR branch).
 */
function load(path, { clients = {}, storage = null } = {}) {
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
  if (storage !== null) sandbox.window = { localStorage: storage };

  vm.runInNewContext(transpile(path), sandbox);
  // A clock built by the *sandbox's* Date, so `instanceof Date` holds.
  vm.runInContext(
    'globalThis.__at = (y, m, d, h, min) => new Date(y, m - 1, d, h || 0, min || 0, 0, 0);',
    sandbox,
  );
  return { api: exports, at: sandbox.__at, storage, sandbox };
}

/** The rhythm module alone — no window, no imports. */
function loadRhythms() {
  return load('../src/lib/altarRhythms.ts');
}

/** The journal store, with the real rhythm module behind it. */
function loadJournal(options = {}) {
  const rhythms = loadRhythms();
  const loaded = load('../src/lib/altarJournal.ts', {
    storage: fakeStorage(),
    ...options,
    clients: { '@/lib/altarRhythms': () => rhythms.api },
  });
  return { ...loaded, rhythms: rhythms.api, at: rhythms.at };
}

/** A sealed entry shape for the store tests. */
function entryFor(api, dateKey, over = {}) {
  return api.sanitizeJournalEntry({
    id: `${dateKey}:evening`,
    dateKey,
    phase: 'evening',
    answers: { gratitude: 'Sunlight on the kitchen floor at seven.' },
    burden: 'My father is waiting on surgery results.',
    createdAt: `${dateKey}T20:15:00.000Z`,
    ...over,
  });
}

describe("altarRhythms — the altar day rolls at dawn", () => {
  it("files a late evening under the day it belongs to", () => {
    const { api, at } = loadRhythms();
    eq(api.altarDayKey(at(2026, 9, 26, 20, 0)), "2026-09-26");
  });

  it("files a small-hours examen under the day that just ended", () => {
    const { api, at } = loadRhythms();
    eq(api.altarDayKey(at(2026, 9, 27, 1, 30)), "2026-09-26");
    eq(api.altarDayKey(at(2026, 9, 26, 0, 0)), "2026-09-25");
  });

  it("opens the new day exactly at dawn", () => {
    const { api, at } = loadRhythms();
    eq(api.altarDayKey(at(2026, 9, 26, 4, 59)), "2026-09-25");
    eq(api.altarDayKey(at(2026, 9, 26, 5, 0)), "2026-09-26");
    eq(api.DAWN_MINUTE, 300);
  });

  it("returns an empty key for an unusable clock", () => {
    const { api } = loadRhythms();
    eq(api.altarDayKey(new Date("nonsense")), "");
    eq(api.altarDayKey(null), "");
  });

  it("pads the local date key", () => {
    const { api, at } = loadRhythms();
    eq(api.toDateKey(at(2026, 1, 5, 12, 0)), "2026-01-05");
    eq(api.toDateKey(at(2026, 12, 31, 12, 0)), "2026-12-31");
  });

  it("shifts across month and year edges", () => {
    const { api } = loadRhythms();
    eq(api.shiftDayKey("2026-09-30", 1), "2026-10-01");
    eq(api.shiftDayKey("2026-01-01", -1), "2025-12-31");
    eq(api.shiftDayKey("2026-09-26", 0), "2026-09-26");
  });

  it("refuses to shift a key it cannot trust", () => {
    const { api } = loadRhythms();
    eq(api.shiftDayKey("2026-02-30", 1), "");
    eq(api.shiftDayKey("not-a-date", 1), "");
    eq(api.shiftDayKey("2026-09-26", Number.NaN), "2026-09-26");
  });

  it("validates real calendar days only", () => {
    const { api } = loadRhythms();
    eq(api.isDateKey("2026-02-28"), true);
    eq(api.isDateKey("2026-02-30"), false);
    eq(api.isDateKey("2026-13-01"), false);
    eq(api.isDateKey("2026-9-26"), false);
    eq(api.isDateKey(""), false);
    eq(api.isDateKey(null), false);
  });

  it("counts whole minutes after local midnight", () => {
    const { api, at } = loadRhythms();
    eq(api.minutesOfDay(at(2026, 9, 26, 0, 0)), 0);
    eq(api.minutesOfDay(at(2026, 9, 26, 11, 30)), 690);
    eq(api.minutesOfDay(at(2026, 9, 26, 17, 5)), 1025);
  });
});

describe("altarRhythms — the clock, said in words", () => {
  it("formats the canonical hours", () => {
    const { api } = loadRhythms();
    eq(api.formatClock(0), "12:00 AM");
    eq(api.formatClock(300), "5:00 AM");
    eq(api.formatClock(690), "11:30 AM");
    eq(api.formatClock(720), "12:00 PM");
    eq(api.formatClock(1020), "5:00 PM");
    eq(api.formatClock(1290), "9:30 PM");
  });

  it("clamps a nonsense minute instead of printing nonsense", () => {
    const { api } = loadRhythms();
    eq(api.formatClock(-30), "12:00 AM");
    eq(api.formatClock(1440), "12:00 AM");
    eq(api.formatClock(Number.NaN), "12:00 AM");
  });

  it("prints a window as a range", () => {
    const { api } = loadRhythms();
    eq(api.formatWindowHours(api.windowForPhase("morning")), "5:00 AM – 11:30 AM");
    eq(api.formatWindowHours(api.windowForPhase("evening")), "5:00 PM – 9:30 PM");
  });

  it("falls back to morning for an unknown phase", () => {
    const { api } = loadRhythms();
    eq(api.windowForPhase("midday").label, "Midday Breath");
    eq(api.windowForPhase("midday").startMinute, 690);
  });

  it("writes durations the way a person says them", () => {
    const { api } = loadRhythms();
    eq(api.formatDuration(0), "less than a minute");
    eq(api.formatDuration(1), "1 min");
    eq(api.formatDuration(45), "45 min");
    eq(api.formatDuration(60), "1h");
    eq(api.formatDuration(134), "2h 14m");
    eq(api.formatDuration(-5), "less than a minute");
    eq(api.formatDuration(Number.NaN), "less than a minute");
  });
});

describe("altarRhythms — the gate teaches, it never locks", () => {
  it("knows which hour is open", () => {
    const { api, at } = loadRhythms();
    eq(api.phaseForTime(at(2026, 9, 26, 7, 0)), "morning");
    eq(api.phaseForTime(at(2026, 9, 26, 13, 0)), "midday");
    eq(api.phaseForTime(at(2026, 9, 26, 18, 0)), "evening");
    eq(api.phaseForTime(at(2026, 9, 26, 16, 0)), null);
    eq(api.phaseForTime(at(2026, 9, 26, 3, 0)), null);
  });

  it("opens a window exactly on its boundary minute", () => {
    const { api, at } = loadRhythms();
    eq(api.phaseForTime(at(2026, 9, 26, 10, 59)), "morning");
    eq(api.phaseForTime(at(2026, 9, 26, 11, 30)), "midday");
    eq(api.phaseForTime(at(2026, 9, 26, 14, 59)), "midday");
    eq(api.phaseForTime(at(2026, 9, 26, 15, 0)), null);
  });

  it("counts down inside an open hour", () => {
    const { api, at } = loadRhythms();
    const gate = api.rhythmGate("morning", at(2026, 9, 26, 7, 0));
    eq(gate.status, "open");
    eq(gate.closesInMinutes, 270);
    eq(gate.opensInMinutes, 0);
    eq(gate.hours, "5:00 AM – 11:30 AM");
    eq(gate.label, "Morning Altar");
    assert.match(gate.notice, /open until 11:30 AM/);
    assert.match(gate.notice, /4h 30m/);
  });

  it("names the hour that has not opened yet", () => {
    const { api, at } = loadRhythms();
    const gate = api.rhythmGate("morning", at(2026, 9, 26, 3, 0));
    eq(gate.status, "waiting");
    eq(gate.opensInMinutes, 120);
    eq(gate.opensLabel, "5:00 AM today");
    eq(gate.closesInMinutes, 0);
    assert.match(gate.notice, /You can still begin now/);
  });

  it("wraps a passed hour into tomorrow", () => {
    const { api, at } = loadRhythms();
    const gate = api.rhythmGate("evening", at(2026, 9, 26, 23, 0));
    eq(gate.status, "later");
    eq(gate.opensLabel, "5:00 PM tomorrow");
    eq(gate.opensInMinutes, 1080);
    assert.match(gate.notice, /Writing now still counts/);
  });

  it("keeps the same hour on today's clock after midnight", () => {
    const { api, at } = loadRhythms();
    const gate = api.rhythmGate("evening", at(2026, 9, 26, 3, 0));
    eq(gate.status, "waiting");
    eq(gate.opensLabel, "5:00 PM today");
  });

  it("closes on the closing minute, not one later", () => {
    const { api, at } = loadRhythms();
    eq(api.rhythmGate("evening", at(2026, 9, 26, 21, 29)).status, "open");
    eq(api.rhythmGate("evening", at(2026, 9, 26, 21, 30)).status, "later");
  });

  it("explains the quiet hours by naming the next hour", () => {
    const { api, at } = loadRhythms();
    assert.match(
      api.quietHoursNotice(at(2026, 9, 26, 16, 0)),
      /Evening Examen opens at 5:00 PM today — about 1h away\./,
    );
    assert.match(
      api.quietHoursNotice(at(2026, 9, 26, 2, 0)),
      /Morning Altar opens at 5:00 AM today — about 3h away\./,
    );
  });

  it("repeats the open hour's own line when a rhythm is live", () => {
    const { api, at } = loadRhythms();
    const reading = at(2026, 9, 26, 18, 0);
    eq(api.quietHoursNotice(reading), api.rhythmGate("evening", reading).notice);
  });

  it("says nothing at all for an unusable clock", () => {
    const { api } = loadRhythms();
    eq(api.quietHoursNotice(new Date("nonsense")), null);
  });
});

describe("altarRhythms — a rhythm count, not a punishment", () => {
  const TODAY = "2026-09-26";

  it("starts with nothing to keep", () => {
    const { api } = loadRhythms();
    const streak = api.rhythmStreak({ keptKeys: [], todayKey: TODAY });
    eq(streak.days, 0);
    eq(streak.state, "held");
    eq(streak.broken, true);
    eq(streak.label, "No count to keep yet. Today is the first page.");
  });

  it("counts consecutive kept days ending today", () => {
    const { api } = loadRhythms();
    const streak = api.rhythmStreak({
      keptKeys: ["2026-09-24", "2026-09-25", "2026-09-26"],
      todayKey: TODAY,
    });
    eq(streak.days, 3);
    eq(streak.keptToday, true);
    eq(streak.state, "practised");
    eq(streak.broken, false);
    assert.match(streak.label, /3 days of rhythm/);
  });

  it("says one altar kindly, not a streak of one", () => {
    const { api } = loadRhythms();
    const streak = api.rhythmStreak({ keptKeys: [TODAY], todayKey: TODAY });
    eq(streak.days, 1);
    assert.match(streak.label, /One altar kept/);
  });

  it("never treats today as a break — the hour may still be ahead", () => {
    const { api } = loadRhythms();
    const streak = api.rhythmStreak({
      keptKeys: ["2026-09-25", "2026-09-24"],
      todayKey: TODAY,
    });
    eq(streak.days, 2);
    eq(streak.keptToday, false);
    eq(streak.state, "open");
    eq(streak.broken, false);
    assert.match(streak.label, /today is still open/);
  });

  it("stops the count at a day that was lived and left", () => {
    const { api } = loadRhythms();
    // A hole two days back: the chain cannot leap it.
    eq(
      api.rhythmStreak({
        keptKeys: ["2026-09-25", "2026-09-23"],
        todayKey: TODAY,
      }).days,
      1,
    );
    // Yesterday itself left: there is nothing to stand on.
    const stale = api.rhythmStreak({
      keptKeys: ["2026-09-24", "2026-09-23"],
      todayKey: TODAY,
    });
    eq(stale.days, 0);
    eq(stale.state, "held");
    eq(stale.broken, true);
  });

  it("cannot leap a gap to claim a run that never happened", () => {
    const { api } = loadRhythms();
    const streak = api.rhythmStreak({
      keptKeys: [TODAY, "2026-09-24", "2026-09-23"],
      todayKey: TODAY,
    });
    eq(streak.days, 1);
    eq(streak.state, "practised");
  });

  it("bridges a Grace Season without counting the rest as a day", () => {
    const { api } = loadRhythms();
    const resting = new Set(["2026-09-25"]);
    const streak = api.rhythmStreak({
      keptKeys: ["2026-09-24", "2026-09-23"],
      todayKey: TODAY,
      isResting: (key) => resting.has(key),
    });
    eq(streak.days, 2);
    eq(streak.restingRun, 1);
    eq(streak.state, "open");
    eq(streak.broken, false);
  });

  it("honours a day spent resting today", () => {
    const { api } = loadRhythms();
    const streak = api.rhythmStreak({
      keptKeys: ["2026-09-25"],
      todayKey: TODAY,
      isResting: (key) => key === TODAY,
    });
    eq(streak.days, 1);
    eq(streak.restingToday, true);
    eq(streak.state, "resting");
    assert.match(streak.label, /Resting through a Grace Season/);
  });

  it("says rest is being formed too when nothing was kept", () => {
    const { api } = loadRhythms();
    const streak = api.rhythmStreak({
      keptKeys: [],
      todayKey: TODAY,
      isResting: (key) => key === TODAY,
    });
    eq(streak.days, 0);
    eq(streak.state, "resting");
    eq(streak.broken, false);
    assert.match(streak.label, /Nothing here is broken/);
  });

  it("ignores keys from the future and keys that are not dates", () => {
    const { api } = loadRhythms();
    const streak = api.rhythmStreak({
      keptKeys: ["2026-09-27", "nonsense", "", TODAY],
      todayKey: TODAY,
    });
    eq(streak.days, 1);
  });

  it("cannot be pushed into a negative or huge lookback", () => {
    const { api } = loadRhythms();
    eq(
      api.rhythmStreak({ keptKeys: [TODAY], todayKey: TODAY, maxLookbackDays: -4 }).days,
      1,
    );
    eq(
      api.rhythmStreak({
        keptKeys: [TODAY],
        todayKey: TODAY,
        maxLookbackDays: Number.NaN,
      }).days,
      1,
    );
  });

  it("stops walking at the lookback the caller allowed", () => {
    const { api } = loadRhythms();
    const kept = [];
    for (let back = 0; back < 12; back += 1) {
      kept.push(api.shiftDayKey(TODAY, -back));
    }
    eq(api.rhythmStreak({ keptKeys: kept, todayKey: TODAY }).days, 12);
    eq(
      api.rhythmStreak({ keptKeys: kept, todayKey: TODAY, maxLookbackDays: 5 }).days,
      6,
    );
  });

  it("holds nothing when the day key itself is unusable", () => {
    const { api } = loadRhythms();
    eq(api.rhythmStreak({ keptKeys: [TODAY], todayKey: "" }).days, 0);
    eq(
      api.rhythmStreak({ keptKeys: [TODAY], todayKey: "2026-99-99" }).state,
      "held",
    );
  });

  it("survives a kept-keys value that is not iterable", () => {
    const { api } = loadRhythms();
    const streak = api.rhythmStreak({ keptKeys: {}, todayKey: TODAY });
    eq(streak.days, 0);
    eq(streak.state, "held");
  });

  it("only asks about days that were not already kept", () => {
    const { api } = loadRhythms();
    const seen = [];
    api.rhythmStreak({
      keptKeys: [TODAY, "2026-09-25"],
      todayKey: TODAY,
      isResting: (key) => {
        seen.push(key);
        return false;
      },
    });
    eq(seen, ["2026-09-24"]);
    eq(api.STREAK_MAX_LOOKBACK_DAYS, 400);
  });
});

describe("altarRhythms — the examen as a state machine", () => {
  it("walks the five Ignatian steps in order", () => {
    const { api } = loadRhythms();
    eq(
      api.EXAMEN_STEPS.map((step) => step.id),
      ["gratitude", "review", "contrition", "grace", "release"],
    );
    eq(api.EXAMEN_STEP_IDS.length, 5);
    for (const step of api.EXAMEN_STEPS) {
      assert.ok(step.prompt.length > 10, `${step.id} needs a real question`);
      assert.ok(step.hint.length > 10, `${step.id} needs a real hint`);
    }
  });

  it("never wraps at either end of the rail", () => {
    const { api } = loadRhythms();
    eq(api.previousExamenStepId("gratitude"), null);
    eq(api.nextExamenStepId("release"), null);
    eq(api.nextExamenStepId("review"), "contrition");
    eq(api.previousExamenStepId("grace"), "contrition");
    eq(api.nextExamenStepId("nonsense"), null);
  });

  it("recovers a draft onto the first step when the cursor id is junk", () => {
    const { api } = loadRhythms();
    eq(api.resolveExamenStepId("release"), "release");
    eq(api.resolveExamenStepId("nope"), "gratitude");
    eq(api.resolveExamenStepId(undefined), "gratitude");
    eq(api.examenStepById("release").label, "Release");
  });

  it("keeps prose paragraphs but never control characters", () => {
    const { api } = loadRhythms();
    eq(
      api.clampJournalText("one\ntwo\n\n\n\nthree", 100),
      "one\ntwo\n\nthree",
    );
    eq(api.clampJournalText("a\t\tb   c", 100), "a b c");
    eq(api.clampJournalText("bell\u0007 and \u202Eflip", 100), "bell and flip");
    eq(api.clampJournalText("zero\u200Dwidth", 100), "zerowidth");
    eq(api.clampJournalText("  padded  ", 100), "padded");
    eq(api.clampJournalText("windows\r\nbreaks", 100), "windows\nbreaks");
  });

  it("refuses anything that is not a string, and caps at a word boundary", () => {
    const { api } = loadRhythms();
    eq(api.clampJournalText(null, 100), "");
    eq(api.clampJournalText(42, 100), "");
    eq(api.clampJournalText("alpha beta gamma delta", 12), "alpha beta");
    eq(api.clampJournalText("abcdefghijklmnop", 5), "abcde");
    eq(api.clampJournalText("x", 0), "x");
  });

  it("normalises a storage timestamp or gives up honestly", () => {
    const { api } = loadRhythms();
    eq(api.normalizeIso("2026-09-26T20:15:00.000Z"), "2026-09-26T20:15:00.000Z");
    eq(
      api.normalizeIso("2026-09-26T21:15:00+01:00"),
      "2026-09-26T20:15:00.000Z",
    );
    eq(api.normalizeIso("nonsense"), "");
    eq(api.normalizeIso(undefined), "");
  });

  it("clamps every answer and drops keys it does not own", () => {
    const { api } = loadRhythms();
    const long = "a".repeat(api.EXAMEN_ANSWER_MAX + 200);
    const answers = api.sanitizeExamenAnswers({
      gratitude: long,
      unknown: "should not survive",
    });
    eq(answers.gratitude.length <= api.EXAMEN_ANSWER_MAX, true);
    eq(Object.keys(answers).sort(), [
      "contrition",
      "grace",
      "gratitude",
      "release",
      "review",
    ]);
    eq(api.sanitizeExamenAnswers(null), api.emptyExamenAnswers());
    eq(api.sanitizeExamenAnswers("nope"), api.emptyExamenAnswers());
  });

  it("asks for a few words, not an essay", () => {
    const { api } = loadRhythms();
    eq(api.EXAMEN_MIN_CHARS, 12);
    eq(api.examenAnswerReady("a".repeat(11)), false);
    eq(api.examenAnswerReady("a".repeat(12)), true);
    eq(api.examenAnswerReady("   a".repeat(12) + "   "), true);
  });

  it("seals from almost anywhere, because a rhythm must survive a hard day", () => {
    const { api } = loadRhythms();
    const empty = api.examenProgress(api.emptyExamenAnswers());
    eq(empty.canSeal, false);
    eq(empty.answered, 0);
    eq(empty.total, 5);
    assert.match(empty.label, /no minimum/);

    const oneAnswer = api.examenProgress({
      ...api.emptyExamenAnswers(),
      gratitude: "The light on the stairs this morning.",
    });
    eq(oneAnswer.canSeal, true);
    eq(oneAnswer.answered, 1);
    eq(oneAnswer.complete, false);
    assert.match(oneAnswer.label, /1 of 5 steps answered/);

    const burdenOnly = api.examenProgress(
      api.emptyExamenAnswers(),
      "Waiting on results.",
    );
    eq(burdenOnly.canSeal, true);
    assert.match(burdenOnly.label, /burden handed over/);

    const full = api.examenProgress({
      gratitude: "Coffee, and a green light on the way home.",
      review: "Present at three, absent by five.",
      contrition: "I answered sharply and I am sorry.",
      grace: "Patience for the appointment on Thursday.",
      release: "The unfinished email can wait until morning.",
    });
    eq(full.complete, true);
    eq(full.remaining, 0);
    eq(full.answered, 5);
  });
});

describe("altarRhythms — sealing, mirroring and sharing", () => {
  it("will not seal an empty altar", () => {
    const { api } = loadRhythms();
    eq(
      api.sealExamen({
        dateKey: "2026-09-26",
        phase: "evening",
        answers: api.emptyExamenAnswers(),
        burden: "   ",
      }),
      null,
    );
  });

  it("refuses a day key or a phase it cannot trust", () => {
    const { api } = loadRhythms();
    eq(
      api.sealExamen({
        dateKey: "not-a-day",
        phase: "evening",
        answers: { gratitude: "Anything at all here." },
        burden: "",
      }),
      null,
    );
    eq(
      api.sealExamen({
        dateKey: "2026-09-26",
        phase: "vigil",
        answers: { gratitude: "Anything at all here." },
        burden: "",
      }),
      null,
    );
  });

  it("seals one altar per rhythm per day, filed under the right day", () => {
    const { api } = loadRhythms();
    const entry = api.sealExamen({
      dateKey: "2026-09-26",
      phase: "evening",
      answers: {
        ...api.emptyExamenAnswers(),
        release: "Leave the phone downstairs.",
      },
      burden: "My mother's check-up is on Monday.",
      createdAt: "2026-09-26T20:30:00.000Z",
    });
    eq(entry.id, "2026-09-26:evening");
    eq(entry.dateKey, "2026-09-26");
    eq(entry.phase, "evening");
    eq(entry.createdAt, "2026-09-26T20:30:00.000Z");
    eq(entry.sharedToWall, false);
    eq(entry.answers.release, "Leave the phone downstairs.");
    eq(api.journalEntryId("2026-09-26", "morning"), "2026-09-26:morning");
    eq(api.journalEntryId("2026-02-30", "morning"), "");
  });

  it("trusts a stored entry only when the whole row holds together", () => {
    const { api } = loadRhythms();
    eq(api.sanitizeJournalEntry(null), null);
    eq(api.sanitizeJournalEntry("nope"), null);
    eq(
      api.sanitizeJournalEntry({ dateKey: "2026-99-99", phase: "evening" }),
      null,
    );
    eq(
      api.sanitizeJournalEntry({
        dateKey: "2026-09-26",
        phase: "vigil",
        answers: { gratitude: "A real answer here." },
      }),
      null,
    );
    eq(
      api.sanitizeJournalEntry({
        dateKey: "2026-09-26",
        phase: "evening",
        answers: api.emptyExamenAnswers(),
        burden: "",
      }),
      null,
    );
    const entry = api.sanitizeJournalEntry({
      id: "spoofed-id",
      dateKey: "2026-09-26",
      phase: "evening",
      answers: { gratitude: "A real answer here." },
      burden: "A burden worth keeping.",
      createdAt: "yesterday",
      sharedToWall: "yes",
    });
    eq(entry.id, "2026-09-26:evening");
    eq(entry.createdAt, "");
    eq(entry.sharedToWall, false);
  });

  it("keeps a draft only while it still holds something", () => {
    const { api } = loadRhythms();
    eq(
      api.sanitizeJournalDraft({ dateKey: "2026-09-26", phase: "evening" }),
      null,
    );
    const draft = api.sanitizeJournalDraft({
      dateKey: "2026-09-26",
      phase: "evening",
      stepId: "sideways",
      answers: { gratitude: "Half a thought, still worth keeping." },
      burden: "",
      updatedAt: "2026-09-26T19:00:00.000Z",
    });
    eq(draft.stepId, "gratitude");
    eq(draft.updatedAt, "2026-09-26T19:00:00.000Z");
    eq(api.sanitizeJournalDraft({ dateKey: "nope", phase: "evening" }), null);
  });

  it("mirrors the day into one cloud note, in step order", () => {
    const { api } = loadRhythms();
    const entry = api.sealExamen({
      dateKey: "2026-09-26",
      phase: "evening",
      answers: {
        gratitude: "Rain on the window at breakfast.",
        release: "Leave the argument where it is.",
      },
      burden: "Waiting on the scan results.",
      createdAt: "2026-09-26T21:00:00.000Z",
    });
    const note = api.composeExamenNote(entry);
    assert.match(note, /^Gratitude: Rain on the window at breakfast\./);
    assert.match(note, /Release: Leave the argument where it is\./);
    assert.match(note, /Burden: Waiting on the scan results\.$/);
    eq(note.includes("Review:"), false);
    eq(note.length <= api.CLOUD_NOTE_MAX, true);
  });

  it("hands the wall a burden only when there is one to pray on", () => {
    const { api } = loadRhythms();
    const base = {
      dateKey: "2026-09-26",
      phase: "evening",
      answers: { gratitude: "A real answer, kept." },
      createdAt: "2026-09-26T21:00:00.000Z",
    };
    eq(api.shareableBurden(api.sealExamen({ ...base, burden: "short" })), "");
    eq(
      api.shareableBurden(api.sealExamen({ ...base, burden: "Waiting on results." })),
      "Waiting on results.",
    );
    const huge = "b".repeat(600);
    const entry = api.sealExamen({ ...base, burden: huge });
    eq(entry.burden.length <= api.JOURNAL_BURDEN_MAX, true);
    eq(api.shareableBurden(entry).length <= api.WALL_SHARE_MAX, true);
  });

  it("summarises a sealed altar for the history list", () => {
    const { api } = loadRhythms();
    const entry = api.sealExamen({
      dateKey: "2026-09-26",
      phase: "evening",
      answers: { gratitude: "A real answer, kept here." },
      burden: "",
      createdAt: "2026-09-26T21:00:00.000Z",
    });
    eq(api.journalEntrySummary(entry), "1 of 5 steps answered");
    entry.burden = "Waiting on results.";
    eq(
      api.journalEntrySummary(entry),
      "1 of 5 steps answered · burden handed over",
    );
    entry.sharedToWall = true;
    eq(
      api.journalEntrySummary(entry),
      "1 of 5 steps answered · burden shared",
    );
  });

  it("spots a draft left behind on an earlier day", () => {
    const { api } = loadRhythms();
    const draft = api.sanitizeJournalDraft({
      dateKey: "2026-09-25",
      phase: "evening",
      answers: { gratitude: "Yesterday, unfinished." },
    });
    eq(api.draftIsStale(draft, "2026-09-26"), true);
    eq(api.draftIsStale(draft, "2026-09-25"), false);
    eq(api.draftIsStale(draft, "2026-09-24"), false);
    eq(api.draftIsStale(draft, ""), false);
  });
});

describe("altarJournal — reads that never throw", () => {
  it("is empty on the server, where there is no window", () => {
    const { api } = loadJournal({ storage: null });
    eq(api.readAltarJournal(), { version: 1, entries: [], drafts: [] });
    eq(api.writeAltarJournal(api.emptyAltarJournal()), false);
    eq(api.clearAltarJournal(), false);
  });

  it("is empty on a first visit, and reads the key when asked", () => {
    const { api } = loadJournal();
    eq(api.readAltarJournal().entries, []);
    eq(api.readAltarJournal().drafts, []);
  });

  it("survives an unparsable payload", () => {
    const { api } = loadJournal({ storage: fakeStorage({ seed: "{not json" }) });
    eq(api.readAltarJournal().entries, []);
  });

  it("discards a payload written by another schema version", () => {
    const { api } = loadJournal({
      storage: fakeStorage({
        seed: JSON.stringify({
          version: 99,
          entries: [
            {
              dateKey: "2026-09-26",
              phase: "evening",
              answers: { gratitude: "A real answer." },
              burden: "",
            },
          ],
        }),
      }),
    });
    eq(api.readAltarJournal(), { version: 1, entries: [], drafts: [] });
  });

  it("survives storage that throws on read (private browsing)", () => {
    const { api } = loadJournal({ storage: fakeStorage({ throwOnRead: true }) });
    eq(api.readAltarJournal().entries, []);
  });

  it("re-sanitises every row it finds on disk, newest first", () => {
    const { api } = loadJournal({
      storage: fakeStorage({
        seed: JSON.stringify({
          version: 1,
          entries: [
            {
              dateKey: "2026-09-26",
              phase: "evening",
              answers: { gratitude: "The newest kept day." },
              burden: "",
              createdAt: "2026-09-26T20:00:00.000Z",
            },
            {
              dateKey: "2026-09-25",
              phase: "evening",
              answers: { gratitude: "The first row for this day." },
              burden: "",
              createdAt: "2026-09-25T20:00:00.000Z",
            },
            { dateKey: "2026-09-99", phase: "evening", answers: { gratitude: "junk" } },
            { dateKey: "2026-09-24", phase: "evening", answers: {}, burden: "" },
            {
              dateKey: "2026-09-25",
              phase: "evening",
              answers: { gratitude: "A later duplicate row." },
              burden: "",
              createdAt: "2026-09-25T21:00:00.000Z",
            },
            "not a row at all",
          ],
          drafts: "not an array",
        }),
      }),
    });
    const store = api.readAltarJournal();
    eq(store.entries.length, 2);
    eq(store.entries.map((entry) => entry.dateKey), ["2026-09-26", "2026-09-25"]);
    eq(store.entries[1].answers.gratitude, "The first row for this day.");
    eq(store.drafts, []);
  });

  it("keeps a stored draft only while it holds something", () => {
    const { api } = loadJournal({
      storage: fakeStorage({
        seed: JSON.stringify({
          version: 1,
          entries: [],
          drafts: [
            {
              dateKey: "2026-09-25",
              phase: "evening",
              stepId: "review",
              answers: { gratitude: "Half a thought, still worth keeping." },
              burden: "",
              updatedAt: "2026-09-25T19:00:00.000Z",
            },
            { dateKey: "2026-09-24", phase: "evening", answers: {}, burden: "" },
          ],
        }),
      }),
    });
    const store = api.readAltarJournal();
    eq(store.drafts.length, 1);
    eq(store.drafts[0].stepId, "review");
  });
});

describe("altarJournal — the autosave that cannot lose a day", () => {
  const draftFor = (over = {}) => ({
    dateKey: "2026-09-26",
    phase: "evening",
    stepId: "gratitude",
    answers: { gratitude: "Sunlight on the kitchen floor at seven." },
    burden: "Waiting on the results.",
    ...over,
  });

  it("saves a draft and reads it back exactly where the cursor was", () => {
    const { api } = loadJournal();
    const saved = api.saveJournalDraft(
      draftFor({ stepId: "grace", updatedAt: "2026-09-26T19:30:00.000Z" }),
    );
    eq(saved.stepId, "grace");
    eq(saved.updatedAt, "2026-09-26T19:30:00.000Z");
    eq(api.loadJournalDraft("2026-09-26", "evening"), saved);
    eq(api.loadJournalDraft("2026-09-27", "evening"), null);
    eq(api.loadJournalDraft("nope", "evening"), null);
  });

  it("stamps the draft when the caller does not", () => {
    const { api } = loadJournal();
    const saved = api.saveJournalDraft(draftFor({ updatedAt: "" }));
    assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("keeps one draft per rhythm per day, the newest winning", () => {
    const { api } = loadJournal();
    api.saveJournalDraft(draftFor({ answers: { gratitude: "A first thought." } }));
    api.saveJournalDraft(
      draftFor({
        stepId: "review",
        answers: { gratitude: "A later, longer thought." },
      }),
    );
    eq(api.readAltarJournal().drafts.length, 1);
    const loaded = api.loadJournalDraft("2026-09-26", "evening");
    eq(loaded.stepId, "review");
    eq(loaded.answers.gratitude, "A later, longer thought.");
  });

  it("refuses to store a draft with nothing written in it", () => {
    const { api } = loadJournal();
    eq(api.saveJournalDraft(draftFor({ answers: {}, burden: "   " })), null);
    eq(api.readAltarJournal().drafts, []);
  });

  it("keeps at most eight unfinished drafts, newest first", () => {
    const { api, rhythms } = loadJournal();
    for (let back = 0; back < 10; back += 1) {
      api.saveJournalDraft(
        draftFor({
          dateKey: rhythms.shiftDayKey("2026-09-26", -back),
          answers: { gratitude: `Draft number ${back} of the walk.` },
        }),
      );
    }
    const drafts = api.readAltarJournal().drafts;
    eq(drafts.length, 8);
    eq(api.JOURNAL_DRAFT_CAP, 8);
    eq(drafts[0].dateKey, "2026-09-26");
    eq(drafts[7].dateKey, "2026-09-19");
  });

  it("forgets one draft on request, and says so when there was nothing", () => {
    const { api } = loadJournal();
    api.saveJournalDraft(draftFor());
    eq(api.clearJournalDraft("2026-09-26", "evening"), true);
    eq(api.clearJournalDraft("2026-09-26", "evening"), false);
    eq(api.clearJournalDraft("nope", "evening"), false);
    eq(api.readAltarJournal().drafts, []);
  });

  it("offers back drafts from earlier days only", () => {
    const { api, rhythms } = loadJournal();
    api.saveJournalDraft(draftFor());
    api.saveJournalDraft(
      draftFor({
        dateKey: "2026-09-25",
        answers: { gratitude: "Yesterday, unfinished." },
      }),
    );
    eq(
      api.staleJournalDrafts("2026-09-26").map((draft) => draft.dateKey),
      ["2026-09-25"],
    );
    eq(api.staleJournalDrafts(rhythms.shiftDayKey("2026-09-26", 3)).length, 2);
    eq(api.staleJournalDrafts(rhythms.shiftDayKey("2026-09-26", -5)).length, 0);
    eq(api.staleJournalDrafts(""), []);
  });

  it("keeps writing when the device refuses to store a draft", () => {
    const { api } = loadJournal({ storage: fakeStorage({ failOn: "write" }) });
    eq(api.writeAltarJournal(api.emptyAltarJournal()), false);
    eq(
      api.saveJournalDraft({
        dateKey: "2026-09-26",
        phase: "evening",
        stepId: "gratitude",
        answers: { gratitude: "A thought worth keeping regardless." },
        burden: "",
      }),
      null,
    );
  });

  it("has nowhere to save on the server, and says so", () => {
    const { api } = loadJournal({ storage: null });
    eq(
      api.saveJournalDraft({
        dateKey: "2026-09-26",
        phase: "evening",
        stepId: "gratitude",
        answers: { gratitude: "A thought that never reached a device." },
        burden: "",
      }),
      null,
    );
  });
});

describe("altarJournal — sealed altars and the count they make", () => {
  it("stamps the seal time when the caller did not", () => {
    const { api, rhythms } = loadJournal();
    const entry = entryFor(rhythms, "2026-09-26", { createdAt: "" });
    eq(entry.createdAt, "");
    const store = api.appendJournalEntry(entry);
    assert.match(store.entries[0].createdAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it("replaces the altar when the same day is sealed again", () => {
    const { api, rhythms } = loadJournal();
    api.appendJournalEntry(
      entryFor(rhythms, "2026-09-26", {
        answers: { gratitude: "A first pass at the evening." },
      }),
    );
    const store = api.appendJournalEntry(
      entryFor(rhythms, "2026-09-26", {
        answers: { gratitude: "A second pass, truer than the first." },
      }),
    );
    eq(store.entries.length, 1);
    eq(store.entries[0].answers.gratitude, "A second pass, truer than the first.");
  });

  it("retires the draft when the day is sealed", () => {
    const { api, rhythms } = loadJournal();
    api.saveJournalDraft({
      dateKey: "2026-09-26",
      phase: "evening",
      stepId: "release",
      answers: { gratitude: "Sunlight on the kitchen floor at seven." },
      burden: "Waiting on the results.",
    });
    eq(api.readAltarJournal().drafts.length, 1);
    api.appendJournalEntry(entryFor(rhythms, "2026-09-26"));
    eq(api.readAltarJournal().drafts, []);
    eq(api.loadJournalDraft("2026-09-26", "evening"), null);
  });

  it("holds a season of altars and no more than the cap", () => {
    const { api, rhythms } = loadJournal();
    for (let back = 0; back < 250; back += 1) {
      api.appendJournalEntry(
        entryFor(rhythms, rhythms.shiftDayKey("2026-09-26", -back)),
      );
    }
    const store = api.readAltarJournal();
    eq(api.JOURNAL_ENTRY_CAP, 240);
    eq(store.entries.length, 240);
    eq(store.entries[0].dateKey, "2026-09-26");
    eq(store.entries[239].dateKey, rhythms.shiftDayKey("2026-09-26", -239));
  });

  it("remembers whether the burden went to the wall", () => {
    const { api, rhythms } = loadJournal();
    api.appendJournalEntry(entryFor(rhythms, "2026-09-26"));
    let store = api.markJournalEntryShared("2026-09-26", "evening", true);
    eq(store.entries[0].sharedToWall, true);
    store = api.markJournalEntryShared("2026-09-26", "evening", false);
    eq(store.entries[0].sharedToWall, false);
    store = api.markJournalEntryShared("2026-09-01", "evening", true);
    eq(store.entries[0].sharedToWall, false);
  });

  it("reads a sealed altar back by day and rhythm", () => {
    const { api, rhythms } = loadJournal();
    api.appendJournalEntry(entryFor(rhythms, "2026-09-26"));
    eq(api.sealedExamenFor("2026-09-26", "evening").dateKey, "2026-09-26");
    eq(api.sealedExamenFor("2026-09-26", "morning"), null);
    eq(api.sealedExamenFor("nope", "evening"), null);
    eq(api.entriesForDay("2026-09-26").length, 1);
    eq(api.entriesForDay("nope"), []);
    eq(api.journalEntries().length, 1);
  });

  it("lists the kept days newest first, one per day", () => {
    const { api, rhythms } = loadJournal();
    api.appendJournalEntry(entryFor(rhythms, "2026-09-25"));
    api.appendJournalEntry(entryFor(rhythms, "2026-09-26"));
    api.appendJournalEntry(entryFor(rhythms, "2026-09-26", { phase: "morning" }));
    eq(api.journalDayKeys(), ["2026-09-26", "2026-09-25"]);
  });

  it("counts its own rhythm, with rest honoured", () => {
    const { api, rhythms } = loadJournal();
    for (const day of ["2026-09-24", "2026-09-25", "2026-09-26"]) {
      api.appendJournalEntry(entryFor(rhythms, day));
    }
    eq(api.journalStreak("2026-09-26").days, 3);
    eq(api.journalStreak("2026-09-26").state, "practised");
    eq(api.journalStreak("2026-09-27").days, 3);
    eq(api.journalStreak("2026-09-27").state, "open");
    eq(
      api.journalStreak("2026-09-27", (key) => key === "2026-09-27").state,
      "resting",
    );
    eq(api.journalStreak("").days, 0);
  });

  it("erases the whole journal from the device", () => {
    const { api, rhythms, storage } = loadJournal();
    api.appendJournalEntry(entryFor(rhythms, "2026-09-26"));
    api.saveJournalDraft({
      dateKey: "2026-09-27",
      phase: "evening",
      stepId: "gratitude",
      answers: { gratitude: "Tomorrow's half-written thought." },
      burden: "",
    });
    eq(api.clearAltarJournal(), true);
    eq(storage.removals, 1);
    eq(api.journalEntries(), []);
    eq(api.readAltarJournal().drafts, []);
  });

  it("reports a refused erase instead of pretending", () => {
    const { api } = loadJournal({ storage: fakeStorage({ failOn: "remove" }) });
    eq(api.clearAltarJournal(), false);
  });
});
