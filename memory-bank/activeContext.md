# Active Context

**Phase 4, Sprint 3 — Global Search & Location Autocomplete** (ACTIVE)
**Phase 4, Sprint 2 — Dynamic Multi-Cluster Aggregation** (COMPLETE)
**Phase 4, Sprint 1 — Resilient `gatherings.status` schema contract** (COMPLETE)

## Just completed (Sprint 2)
- Static 3-marker fan replaced by dynamic N-marker geographic clustering:
  proximity partitioning, geographic-mean centroids, `phase + slot·2π/N`
  formations (line / triangle / adaptive circle), and a smooth
  distance→aggregation ramp with per-layer opacity handover.
- Two-line pill measurement fix uncovered by the new width assertions: the
  summary pill draws `{City}` over `{N} Gatherings` and is measured from its
  **widest line**.
- **56/56** tests green; `tsc`, `lint`, `build` all exit 0.

## Current work (Sprint 3)
Files in play:
- `src/lib/globeSearch.ts` — pure search index + query logic (framework-free, so
  the tests can verify filtering, ranking, and empty-state behaviour without a
  DOM): `buildSearchIndex()`, `searchGlobeMarkers()` (returns
  `{ query, results, isEmptyQuery, truncated }`), ranking helpers, keyboard
  navigation (`moveSearchSelection`), and result copy formatters.
- `src/app/components/globe/GlobeSearch.tsx` — the frosted-glass overlay:
  `backdrop-blur-md bg-white/10 border border-white/15 text-white
  placeholder-white/50`, `Cmd+K`/`Ctrl+K` to focus, `Escape` to close, arrow
  keys to move the highlight, `role="combobox"` + `aria-activedescendant` for
  screen readers.
- `src/app/components/globe/MissionGlobe.tsx` — mounts the overlay inside the
  stage's existing top bar as its middle flex item (own full-width row on small
  screens), so it can never cover the top-left badges, top-right zoom controls,
  bottom hint, or the bottom-left ambassador card. A selection calls the
  existing `setSelectedId(id)`, which drives `sceneRef.current.selectMarker(id)`
  → fly-to + cluster unfold.
- `tests/globeSearch.test.mjs` — new suite (same `node:test` +
  `ts.transpileModule` + `node:vm` harness as the other suites).

## Standing constraints
- Deterministic output only: clustering follows the stable server payload order
  and formation slots are ranked by FNV-1a id hash, so a payload reshuffle can
  never change who stands where. Search ordering must be equally deterministic.
- Privacy: markers carry only `{city, first_name, member_count, lat, lng}` — no
  addresses, emails, or leader names reach the client.
- Every GPU resource must stay in the disposal registry (`trackGeometry` /
  `trackMaterial` / `trackTexture`) and be released by `dispose()`.
- Gates before any completion claim: `npx tsc --noEmit`, `npm run lint`,
  `npm run build`, `node --test tests/*.test.mjs` — all exit 0, freshly run.