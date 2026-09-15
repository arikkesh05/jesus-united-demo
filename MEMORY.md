# Project Memory: JesusUnited Demo

## Project Overview
- **Product**: JesusUnited Demo (Audio reflections, PostGIS church gather map, Sunday pulpit kit generator).
- **Stack**: Next.js (App Router, Turbopack), TypeScript, Tailwind CSS, Supabase (PostgreSQL + PostGIS).
- **Deployment**: Vercel CI/CD hooked to GitHub (`arikkesh05/jesus-united-demo`).

## Architecture & Conventions
- App router structure under `src/app`.
- Client components under `src/app/components`; server data helpers under `src/lib`.
- `src/app/page.tsx` is an async Server Component that loads the daily reflection via `getDailyReflection()` (`src/lib/reflections.ts`).
- Path alias: `@/*` → `./src/*` (the canonical Next.js alias) only. All internal imports use the
  `@/` form (`@/lib/...`, `@/app/...`); the custom `lib/*` and `app/*` aliases were removed on
  2026-09-15. Verified after normalization: `npx tsc --noEmit`, `npm run lint`, and
  `npm run build` all exit 0 with a clean `.next`.
- Deploy gotcha: `src/lib/reflections.ts`, `src/lib/types.ts`, and `src/lib/gatherings.ts` are
  still **untracked in git** (they are not gitignored). This broke the Vercel deploy of commit
  `3c203be` with `Module not found: Can't resolve 'lib/reflections'` because the build ran from a
  git clone that never contained them - they must be staged and committed for deploys to succeed.
- Environment variables managed in `.env.local` and mirrored on Vercel.
- Database: Supabase PostgreSQL with PostGIS extension enabled. `gatherings.location` is a
  geography column returned by PostgREST as EWKB hex; `src/lib/gatherings.ts` decodes it into
  `latitude`/`longitude`.
- Rendering: the homepage is statically prerendered at build time, so reflection data is
  fetched from Supabase during `next build`. Add `export const revalidate = 60` (ISR) or
  `export const dynamic = 'force-dynamic'` if the card must refresh without a redeploy.

## Phase Progress
- [x] **Phase 0: Environment Setup**
  - Scaffolded Next.js with TypeScript and Tailwind.
  - Linked GitHub to Vercel continuous deployment.
  - Configured Supabase JS client and `.env.local`.
  - Verified clean production build (`npm run build`).
- [x] **Phase 1: Database Schema & Seed Data**
  - Enabled PostGIS extension (`00_enable_postgis`).
  - Created `reflections` table with RLS policy (`01_create_reflections_table`).
  - Created `gatherings` table with spatial GiST index and RLS policy (`02_create_gatherings_table`).
  - Created `pulpit_kits` table with RLS policy (`03_create_pulpit_kits_table`).
  - Seeded initial demo data across all three tables (`04_seed_demo_data`).
- [x] **Phase 2: Module 1 - Daily Audio Reflection**
  - [x] Added `DailyReflection` client component (`src/app/components/DailyReflection.tsx`) with empty state, formatted date badge, scripture, body text, and conditional HTML5 audio player.
  - [x] Introduced internal path aliases for these imports (later standardized to the canonical `@/*` alias; see Architecture & Conventions).
  - [x] Wired `DailyReflection` into the home page (`src/app/page.tsx`) as an async Server Component that awaits `getDailyReflection()` for live Supabase data.
  - [x] Homepage includes a JesusUnited header, the centered Module 1 card in a `max-w-3xl mx-auto px-4 py-12` layout, and "Coming Soon" placeholder cards for Modules 2 & 3.
  - [x] Verified with `npx tsc --noEmit`, `npm run lint`, `npm run build` (prerendered HTML contains seeded row `Walking in Unshakeable Grace` / `Ephesians 2:8-10`) and a `next start` + `curl` runtime check (HTTP 200).
- [ ] **Phase 3: Module 2 - Church Gathering Map (PostGIS)**
  - [x] Added the `Gathering` interface to `src/lib/types.ts` (nullable `description`/`contact_email`, optional `latitude`/`longitude`/`distance_meters`).
  - [x] Added `src/lib/gatherings.ts` with `getGatherings()`: selects all rows from `gatherings` ordered by `name` ascending, then decodes each row defensively into the typed `Gathering` shape. Returns `[]` and logs via `console.error` on any failure.
  - [x] PostGIS handling: `gatherings.location` is a geography column that PostgREST returns as **EWKB hex** (e.g. `0101000020E6100000...`), so coordinates are decoded from EWKB/WKB (little or big endian, SRID optional, 2D/3D points) with fallbacks for GeoJSON objects/strings, WKT strings, coordinate arrays (`[lng, lat]`), named `lat`/`lng` or `latitude`/`longitude` fields, and arbitrarily nested objects. Malformed, truncated, non-point, or null payloads degrade to rows without `latitude`/`longitude` instead of throwing.
  - [x] Test results - Tier 1: `npx tsc --noEmit` exit 0. Tier 2: `npm run lint` exit 0. Tier 3: `npm run build` exit 0 (Turbopack + TypeScript + prerender clean).
  - [x] Test results - Tier 4 (data smoke test): a temporary server route calling the real `getGatherings()` against live Supabase rendered `count=3` in name order with decoded coordinates - Downtown Central Fellowship (30.2672, -97.7431), North Loop House Church (30.3175, -97.7126), Oak Hill Community Chapel (30.2312, -97.8631). Temp route removed afterwards.
  - [x] Test results - parser matrix (temporary harness against a stubbed Supabase, since removed): 25/25 green covering query shape, row filtering, EWKB little/big endian with and without SRID, GeoJSON object/string, WKT, nested objects, coordinate arrays, named lat/lng as numbers and strings, `distance_meters` strings, null/malformed/truncated/non-point payloads, and the error / `data: null` / non-array failure paths.
  - [x] Added `GatheringMap` client component (`src/app/components/GatheringMap.tsx`) with a search/filter input (matches name, city/area, address, leader, schedule, description), an `Austin, TX Metro` distance-indicator placeholder, a live "N of M gatherings" count, a responsive 1-column (mobile) / 2-column (sm+) card grid, and friendly empty states for "no data" and "no search matches" (with a Clear search button).
  - [x] Split the card into `src/app/components/GatheringCard.tsx` (name, meeting-time badge, description, address, leader, `Connect via WhatsApp` link built as `https://wa.me/?text=<prefilled greeting>`, an Email button when `contact_email` exists, and `Google Maps` using decoded coordinates - falling back to the address) and shared inline SVGs in `src/app/components/icons.tsx`.
  - [x] Wired `getGatherings()` into `src/app/page.tsx` as `const gatherings = await getGatherings();` and replaced the Module 2 "Coming Soon" placeholder with the new `<GatheringMap gatherings={gatherings} />` section. Module 3 (Sunday Pulpit Kit Generator) remains a "Coming Soon" placeholder card.
  - [x] Test results - Tier 1: `npx tsc --noEmit` exit 0. Tier 2: `npm run lint` exit 0. Tier 3: `npm run build` exit 0 (clean prerender of `/`, no module-resolution errors).
  - [x] Test results - Tier 4 (UI & data smoke check): the prerendered build output contains all 3 seeded Austin gatherings - Downtown Central Fellowship, North Loop House Church, Oak Hill Community Chapel - each with 3 action links: `wa.me` links with encoded prefilled greetings (e.g. "Hi Pastor Marcus Vance, I found Downtown Central Fellowship on JesusUnited..."), `Google Maps` links using the decoded coordinates (30.2672,-97.7431 / 30.3175,-97.7126 / 30.2312,-97.8631), and `mailto:` links for all three leaders. The "3 of 3 gatherings", `Austin, TX Metro` indicator, search input, and the Module 3 placeholder were also present.
- [ ] **Phase 4: Module 3 - Sunday Pulpit Kit Generator**
- [ ] **Phase 5: Polish, Navigation & Final QA**
