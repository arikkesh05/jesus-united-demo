# Project Memory: JesusUnited Demo

## Project Overview
- **Product**: JesusUnited Demo (Audio reflections, PostGIS church gather map, Sunday pulpit kit generator).
- **Stack**: Next.js (App Router, Turbopack), TypeScript, Tailwind CSS, Supabase (PostgreSQL + PostGIS).
- **Deployment**: Vercel CI/CD hooked to GitHub (`arikkesh05/jesus-united-demo`).

## Architecture & Conventions
- App router structure under `src/app`.
- Client utilities under `src/lib` (`src/lib/supabase.ts`).
- Environment variables managed in `.env.local` and mirrored on Vercel.

## Phase Progress
- [x] **Phase 0: Environment Setup**
  - Scaffolded Next.js with TypeScript and Tailwind.
  - Configured git repo and initial commits.
  - Linked GitHub to Vercel continuous deployment.
  - Provisioned Supabase instance with PostGIS enabled.
  - Configured Supabase JS client and `.env.local`.
  - Verified clean production build (`npm run build`).
- [ ] **Phase 1: Database Schema & Seed Data**
- [ ] **Phase 2: Module 1 - Daily Audio Reflection**
- [ ] **Phase 3: Module 2 - Church Gathering Map (PostGIS)**
- [ ] **Phase 4: Module 3 - Sunday Pulpit Kit Generator**
- [ ] **Phase 5: Polish, Navigation & Final QA**
