# Progress Log — JesusUnited Demo

> Companion to the repo's canonical `MEMORY.md`. This file tracks sprint-level
> status only; deep technical detail lives in `MEMORY.md` (see the dated
> `## PHASE …` sections) and in `memory-bank/activeContext.md`.

## Phase 4 — Globe Data Contract & Cluster Intelligence

### ✅ Sprint 1 — Resilient Supabase schema contract (`gatherings.status`) — COMPLETE
- **Root cause (not a symptom fix):** the `gatherings` table has **no `status`
  column** — `supabase/migrations/202609170001_admin_moderation.sql` keeps
  moderation state on `gathering_submissions` (partial index
  `where status = 'pending'`; `moderate_gathering()` updates that table) while
  `gatherings` holds already-approved rows. The speculative
  `.eq('status', 'approved')` probe therefore failed with SQLSTATE 42703 on
  **every** read and logged an unconditional `console.warn`, which is what
  surfaced during static prerender as
  `column gatherings.status does not exist`.
- **Fix (`src/lib/gatherings.ts`):** `isMissingColumnError()` recognises both
  SQLSTATE `42703` *and* the message form; a per-process
  `statusColumnSupport: 'unknown' | 'supported' | 'absent'` cache probes the
  column **at most once** and caches the verdict **silently**. Genuine read
  failures still warn. `parsePublicMarkerRow` re-checks any returned `status`,
  so the unfiltered fallback can never publish a non-approved row.
- **Production pipeline (verified live, not assumed):** `page.tsx` →
  `getPublicGatheringMarkers()` → `<MissionGlobe markers={…} />`; a temporary
  live probe returned `ok=true rows=3`, sample
  `{city: Austin, first_name: Marcus, member_count: 1}` (privacy preserved: no
  address / email / leader name) with **0 captured console messages**.
  Empty/failed fetches degrade to the roster's empty state — zero UI breakage.
- **Results:** `tests/globe.test.mjs` +3 regression tests (RED 2 failures proven
  first, then GREEN) → **51/51 tests passing**; `npx tsc --noEmit` exit 0;
  `npm run lint` exit 0; `npm run build` exit 0 with **0 build warnings**
  (`column gatherings.status does not exist` eliminated — clean `rm -rf .next`
  rebuild grepped for 0 occurrences).

### ✅ Sprint 2 — Dynamic Multi-Cluster Aggregation — COMPLETE
- **Delivered:** the static 3-marker fan is gone. `groupMarkerClusters()` in
  `src/lib/globeCamera.ts` now partitions the payload by angular proximity
  (`markerGroundDistance()`, `MARKER_JITTER_CLUSTER_DEGREES = 0.75°` around a
  running geographic mean), and returns each cluster's centroid, formation
  geometry, and summary copy.
- **Formations:** regular spherical polygon per cluster — a **line for 2**
  (`MARKER_PAIR_LINE_DEGREES`), **triangle for 3** (`MARKER_CLUSTER_FAN_RADIUS_DEGREES
  = 3.8°`), and a **uniform circle for 4+** whose radius is adaptive
  (`clusterFanRadiusDegrees()` = `clamp(max(minChordRadius, 3.8°), 0, 9°)` from
  `chord = 2R·sin(π/N)`), so a growing cluster widens instead of crowding.
  Angles are exactly `phase + slot·2π/N` (`clusterDistributionAngles()`), with
  the phase from the lead id's FNV-1a hash — deterministic under any payload
  reshuffle.
- **Aggregation ramp:** `clusterAggregationForDistance()` smoothsteps over
  `CLUSTER_AGGREGATE_NEAR_DISTANCE = 205` → `CLUSTER_AGGREGATE_FAR_DISTANCE = 255`,
  deliberately bracketing the default framing (260 → fully aggregated) and the
  selection fly-to (190 → fully fanned). `clusterLayerOpacities()` splits the
  blend per layer so name tags fade first, avatars second, summary pill last —
  the handover is a dissolve, never two overlapping labels.
- **Renderer (`globeScene.ts`):** every marker carries `fannedPosition` (its
  polygon slot) and `clusterPosition` (the centroid); `updateMarkers()`
  interpolates between them. One aggregated summary pill per cluster of 2+, owned
  by the lead member, anchored at the centroid, hidden in the fanned view, and
  added to `pickables` so clicking it selects the lead — which flies to the
  cluster centroid and unfolds the formation through the *existing* selection
  path (ground disc + gold badge stroke included, no special-casing).
- **Two-line measurement fix:** the summary pill does **not** draw one wide
  banner. `clusterPillLines()` splits it into a bold city headline plus a muted
  `N Gatherings` subline, and `clusterPillWidth()` measures the **widest line** —
  this is what fixed a genuine width-cap overflow (`"San Antonio • 12 Gatherings"`
  = 30 chars × 1.5 = 45 units vs a 34-unit cap) uncovered by the tests. The
  single-line `clusterSummaryLabel()` remains for accessible names.
- **Results:** **56/56** tests passing (was 51; +5 Sprint 2 tests covering
  proximity partitioning, geographic-mean centroid, uniform `2π/N` spacing,
  adaptive radius clamping, ramp/opacity handover, and the two-line width
  measurement); `npx tsc --noEmit` exit 0; `npm run lint` exit 0; `npm run build`
  exit 0.

### 🔵 Sprint 3 — Global Search & Location Autocomplete — ACTIVE
- Goal: a frosted-glass global search overlay for the globe — `Cmd+K`/`Ctrl+K`
  to focus, `Escape` to close, arrow keys to navigate — searching ambassadors by
  **first name, city, and gathering count**, and routing a selection through the
  globe's existing `selectMarker(id)` pipeline so the camera flies in and any
  cluster unfolds smoothly.
- Placement must not obstruct the top-left status badges, the top-right zoom
  controls, the centred interaction hint, or the bottom-left docked ambassador
  card.
- Placement: the search lives in the HUD's **left cluster** (after the status
  badges, wrapped in `pointer-events-auto` since the HUD bar is
  `pointer-events-none`), so it cannot obstruct the top-right zoom controls,
  the centred interaction hint, or the bottom-left docked ambassador card.
- **Results:** **85/85** tests passing (was 56; +29 in the new
  `tests/globeSearch.test.mjs` covering fold/tokenise/index/query filtering,
  case-insensitivity across name/city/count, empty-state handling, the
  selection mover's wrap/clamp, and the copy formatters); `npx tsc --noEmit`
  exit 0; `npm run lint` exit 0 (**0 warnings**); `npm run build` exit 0 with
  **0 warning lines** in a clean `rm -rf .next` build; full
  `node --test tests/*.test.mjs` exit 0.
- Component gotchas fixed during verification: `aria-expanded` is invalid on
  the implicit `textbox` role (input) — replaced with `aria-label` +
  conditional `aria-controls`; a literal `\u2318` escape in JSX text renders
  verbatim — replaced with the real `⌘` glyph; the input's `Escape` handler
  must `stopPropagation()` so closing search never bubbles into the stage's
  Escape handler and deselects the current ambassador.
