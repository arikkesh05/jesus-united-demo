# Active Context

**Altar OS v2, Sprint 3 — Time-gated rhythms, private journal, interactive Examen** (COMPLETE)
**Altar OS v2, Sprint 2 — Community Intercession Pulse** (COMPLETE)
**Altar OS v2, Sprint 1 — Audio engine contract** (COMPLETE)
**Phase 5 / Milestone A — Live host connect** (COMPLETE)
**Phase 4 — Resilient schema, multi-cluster globe, global search, ambassadors** (COMPLETE)

## Just completed (Sprint 3)
- The evening altar is now the five-step Ignatian Examen: one step at a time, a
  draft that autosaves to the device and survives a reload, and a rhythm count
  that is a mercy rather than a threat.
- `src/lib/altarRhythms.ts` is the pure core: canonical hours (`rhythmGate`,
  `quietHoursNotice`), the dawn roll (`altarDayKey` — 05:00, so a 01:00 examen
  files under yesterday), the rhythm count (`rhythmStreak` — today is never a
  break, Grace Seasons bridge without counting, the walk stops at a lived gap),
  the exam state machine, and the entry/draft sanitisers.
- `src/lib/altarJournal.ts` is the private store: one versioned `localStorage`
  key, **no cloud write**, SSR-safe reads, sanitised parsing, non-fatal writes.
- The only text that can leave the device is the single *burden* line, and only
  when the visitor asks — through `sanitizeDropInDraft`, the same privacy screen
  the drop-in dialog uses.
- Sealing mirrors `composeExamenNote(entry)` into the cloud-synced
  `evening_journal` and flips `eveningCompleted`, so the account still shows the
  day while the device keeps the record of truth.
- **324/324** tests green; `tsc`, `lint`, `build` all exit 0. Browser-verified
  end to end (draft → reload → recovery → seal → "1 day of rhythm"), 0 console
  errors, 0 hydration errors.

## Files in play
- `src/lib/altarRhythms.ts` — clocks, gate copy, streaks, exam steps, sanitisers.
- `src/lib/altarJournal.ts` — drafts, sealed entries, day keys, streak, erase.
- `src/app/components/ExamenJournal.tsx` — the interactive Examen: step rail,
  autosave status (`idle`/`saving`/`saved`/`blocked`), recovery notices, sealed
  reading, topic pills + the opt-in wall share, recent altars, two-step erase.
- `src/app/components/AltarOS.tsx` — mount-gated clock, gate notes on both
  gated panels, open-hour marker on the tab rail, the Examen mount, the cloud
  mirror.
- `tests/altarJournal.test.mjs` — 83 tests (vm sandbox; clocks built *inside* the
  context, because the module's `instanceof Date` guard is realm-bound).

## Standing constraints
- The private journal never syncs. One `localStorage` key, no Supabase path, and
  the erase button is the whole erasure.
- The liturgical gate is advisory copy, never a disabled panel or a greyed-out
  write path. Today is never a break; a Grace Season is rest, not a miss.
- Deterministic output: the gate copy uses a fixed 12-hour formatter (no `Intl`),
  and every clock is injected — nothing reads `Date.now()` in render, which is
  both a hydration hazard and a lint error here.
- `react-hooks/set-state-in-effect` is on: storage reads land in a microtask or a
  timer callback, never synchronously in an effect body.
- Gates before any completion claim: `npx tsc --noEmit`, `npm run lint`,
  `npm run build`, `node --test tests/*.test.mjs` — all exit 0, freshly run.
