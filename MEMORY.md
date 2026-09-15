# Project Memory: JesusUnited Demo

## Project Overview
- **Product**: JesusUnited Demo (Audio reflections, PostGIS church gather map, Sunday pulpit kit generator).
- **Stack**: Next.js (App Router, Turbopack), TypeScript, Tailwind CSS, Supabase (PostgreSQL + PostGIS).
- **Deployment**: Vercel CI/CD hooked to GitHub (`arikkesh05/jesus-united-demo`).

## Architecture & Conventions
- App router structure under `src/app`.
- Client components under `src/app/components`; server data helpers under `src/lib`.
- `src/app/page.tsx` is an async Server Component that loads the daily reflection via `getDailyReflection()` (`src/lib/reflections.ts`).
- Path aliases in `tsconfig.json`: `@/*` → `./src/*`, `app/*` → `./src/app/*`, `lib/*` → `./src/lib/*`.
- Environment variables managed in `.env.local` and mirrored on Vercel.
- Database: Supabase PostgreSQL with PostGIS extension enabled.
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
  - [x] Added `lib/*` → `./src/lib/*` and `app/*` → `./src/app/*` path aliases in `tsconfig.json`.
  - [x] Wired `DailyReflection` into the home page (`src/app/page.tsx`) as an async Server Component that awaits `getDailyReflection()` for live Supabase data.
  - [x] Homepage includes a JesusUnited header, the centered Module 1 card in a `max-w-3xl mx-auto px-4 py-12` layout, and "Coming Soon" placeholder cards for Modules 2 & 3.
  - [x] Verified with `npx tsc --noEmit`, `npm run lint`, `npm run build` (prerendered HTML contains seeded row `Walking in Unshakeable Grace` / `Ephesians 2:8-10`) and a `next start` + `curl` runtime check (HTTP 200).
- [ ] **Phase 3: Module 2 - Church Gathering Map (PostGIS)**
- [ ] **Phase 4: Module 3 - Sunday Pulpit Kit Generator**
- [ ] **Phase 5: Polish, Navigation & Final QA**
