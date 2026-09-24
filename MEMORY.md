# Project Memory: JesusUnited Demo

## Project Overview
- **Product**: JesusUnited Demo (Audio reflections, PostGIS church gather map, Sunday pulpit kit generator).
- **Stack**: Next.js (App Router, Turbopack), TypeScript, Tailwind CSS, Supabase (PostgreSQL + PostGIS).
- **Deployment**: Vercel CI/CD hooked to GitHub (`arikkesh05/jesus-united-demo`).

## Architecture & ConvenAct as Lead Frontend Architect & 3D WebGL Specialist. Follow .cline/skills/systematic-debugging/ and .cline/skills/verification-before-completion/:

TASK: ALIGN AVATAR SPRITE GENDER / NAME MAPPING

1. INVESTIGATE AVATAR ASSIGNMENT:
   - Check where avatar textures/sprites are assigned to markers (e.g. in `src/app/components/globe/globeScene.ts`, `src/lib/globeAvatars.ts`, or wherever `avatarTexture` is selected).
   - Inspect the mapping logic: identify why "Sarah" receives the male avatar sprite while "Marcus" and "David" receive female sprites.

2. FIX SPRITE ASSIGNMENT:
   - Ensure explicit alignment based on ambassador name/avatar profile:
     - "Sarah" (and female names) must receive female avatar sprites (e.g. `female-believer`, `avatar-female.png`, etc.).
     - "Marcus" and "David" (and male names) must receive male avatar sprites (e.g. `male-believer`, `pastor`, etc.).
   - If an avatar hash/modulo fallback exists for dynamic markers, ensure known names or explicit gender cues take precedence so names match their visual sprites.

3. RUN VERIFICATION GATES:
   - Run `npx tsc --noEmit`
   - Run `npm run lint`
   - Run `node --test tests/*.test.mjs`
   - Confirm exit code 0 across all checks.tions
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
- Audio resilience (permanent, multi-tier): `getDailyReflection()` normalises `audio_url` in
  `src/lib/reflections.ts` (`normalizeReflectionAudioUrl`) so missing/empty/Ogg-family values resolve to
  the bundled `/audio/daily-reflection.mp3`; `src/lib/reflectionFallback.ts` is the single source of
  truth (`FALLBACK_REFLECTION_AUDIO_URL` + `FALLBACK_REFLECTION`) shared by the data layer and the
  player; `AudioPlayer` renders `<audio>` with **two `<source>` candidates** (the reflection's own URL
  first, the same-origin MP3 last) and deliberately **no `src` attribute** - a `src` on `<audio>`
  overrides `<source>` children and would defeat the fallback. Never reintroduce a single-source player.

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
- [x] **Phase 3: Module 2 - Church Gathering Map (PostGIS)**
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
- [x] **Phase 4: Module 3 - Sunday Pulpit Kit Generator**
  - [x] Inspected the live schema: the `pulpit_kits` table exists (1 seeded row) with columns `id, title, theme, scripture_passages[]`, `outline[{section,subtext}]`, `talking_points[]`, `discussion_questions[]`, `target_sunday`, `created_at`. There is **no** `key_quote`/`call_to_action` column yet, so those are typed as optional extras.
  - [x] Added the `PulpitKit` and `PulpitKitOutlinePoint` interfaces to `src/lib/types.ts`.
  - [x] Added `src/lib/pulpitKits.ts` with `getLatestPulpitKit(): Promise<PulpitKit | null>`: selects the featured kit ordered by `target_sunday` descending, normalises rows defensively (singular/plural passage columns, JSON or Postgres `text[]` strings, string outlines, numeric strings for duration), and logs + falls back to a local kit on error, empty, or malformed rows.
  - [x] Added `src/lib/pulpitKitFallback.ts` - the "Grace in the Wilderness" (Exodus 16 / John 6) kit with 5 discussion questions, key quote, and application challenge, used when the table is pending or unreachable.
  - [x] Added `src/lib/pulpitKitMarkdown.ts` (pure, no Supabase import so it stays out of the client bundle) exporting `buildPulpitKitMarkdown()`, `formatKitDate()`, and `estimateKitMinutes()`.
  - [x] Built the Module 3 UI as small focused components: `src/app/components/PulpitKit.tsx` (client container, tab state, arrow-key navigation), `KitHeader.tsx` (title, scripture badges, theme pill, `36-min Sermon Architecture` duration, target Sunday), `KitActionBar.tsx` (clipboard copy with "Copied!"/"Copy unavailable" feedback plus an `aria-live` status region, and a Print / Export trigger), `KitOutlinePanel.tsx` (homiletical progression with cross-references and hooks), `KitStudyPanel.tsx` (study questions, key quote, application challenge), and `KitSlideDeck.tsx` (Theme / Core Scripture / Point / Application slide previews).
  - [x] Wired into `src/app/page.tsx` with `const pulpitKit = await getLatestPulpitKit();` and `<PulpitKit kit={pulpitKit} />`; the `upcomingModules` array and the final "Coming Soon" card were removed.
  - [x] Test results - Tier 1: `npx tsc --noEmit` exit 0. Tier 2: `npm run lint` exit 0. Tier 3: `npm run build` exit 0 (clean prerender of `/`, no module-resolution errors).
  - [x] Test results - Tier 4 (data harness, compiled against a stubbed Supabase, since removed): 15/15 green covering query shape (`pulpit_kits` / `*` / `target_sunday` desc / limit 1 / `maybeSingle`), live-row normalisation, the derived 36-minute duration, formatted target Sunday, the complete Markdown payload (every section present, no `undefined`/`null` artefacts, 5 fallback questions), schema-drift tolerance, unusable rows returning `null`, and the error / empty / malformed fallback paths.
  - [x] Test results - Tier 4 (UI smoke check of the prerendered output): the live row rendered (`The Architecture of Unity`, `One Body, Many Parts`, both passages, `36-min Sermon Architecture`, `Sunday, September 20, 2026`), the fallback kit was absent, `Coming Soon` was gone, 1 tablist + 3 tabs + 3 tabpanels with `aria-selected`/`aria-controls`/`id` wiring, all outline points and both discussion questions present, 4 slide cards including `Application Challenge`, the `Copy Markdown Kit` and `Print / Export View` buttons, and `print:hidden`/`print:block` print styling. The clipboard handler was confirmed present in the built client chunks.
  - [x] Bug fixed during verification: the deck sliced to 4 cards after adding 2 outline slides, which silently dropped the Application Challenge slide; it now renders a single outline point so the application slide always fits.
- [ ] **Phase 5: Polish, Navigation & Final QA**
  - [x] **Production polish (UI audit fixes, 2026-09-15)** - all 4 tiers verified:
  - [x] Print isolation: `@media print` block in `src/app/globals.css` hides `main > header`/`main > footer` (scoped, so PulpitKit's own `<header>` still prints), `#daily-reflection-section`, `#gathering-map-section`, and `.no-print`; `#pulpit-kit-section` is stripped of margin/padding/border/shadow; `.print-force-visible` forces all kit tab panels visible; `@page { size: portrait; margin: 1.5cm }`. `page.tsx` sections carry the matching IDs; `KitActionBar` toolbar has `.no-print`.
  - [x] Layout widening: `<main>` is now `max-w-5xl mx-auto px-4 py-10 sm:px-6 lg:px-8` (was `max-w-3xl px-4 py-12`); page background moved to `<body>` as `bg-slate-50/75` in `layout.tsx` so white cards get natural elevation.
  - [x] Grid adjustments: GatheringMap `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`; KitSlideDeck `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4` (all 4 slides in one desktop row).
  - [x] Custom audio player: new `src/app/components/AudioPlayer.tsx` (`'use client'`) replaces the raw `<audio controls>` in `DailyReflection.tsx` - hidden `<audio ref>` element, play/pause toggle with SVG icons, `0:00 / m:ss` tabular-nums counter, styled range slider bound to `timeupdate` with seeking (`aria-valuetext`), playback speed cycle 1x/1.25x/1.5x, mute/unmute; 4 new icons added to `icons.tsx`. All audio controls use `type="button"` + `aria-label`/`aria-pressed`.
  - [x] Hierarchy fixes (box-in-a-box): GatheringMap's outer card was demoted to a plain wrapper (toolbar keeps its own card); gathering cards, empty states, and DailyReflection cards promoted to `bg-white shadow-sm` (cards are now the elevated layer); active kit tab upgraded to `bg-white ring-1 ring-slate-200 text-slate-900 shadow-sm font-semibold`; gathering/slide cards got `transition-all duration-200 hover:border-slate-300 hover:shadow-md`.
  - [x] Test results - Tier 1: `npx tsc --noEmit` exit 0. Tier 2: `npm run lint` exit 0. Tier 3: `npm run build` exit 0 (clean Turbopack compile + static prerender of `/`).
  - [x] Test results - Tier 4: built CSS contains `@media print`, `print-force-visible`, `@page`, `size:portrait`; client chunks contain `playbackRate`, `1.25`, and the `Seek through the reflection` handler; prerendered HTML contains all 3 section IDs, `max-w-5xl`, `bg-slate-50/75`, `md:grid-cols-2`/`lg:grid-cols-3`/`lg:grid-cols-4`, the play button (`Play the reflection`), and zero `<audio controls>` elements (only the hidden no-controls `<audio>` remains); `next start` runtime check returned HTTP 200 with the reflection, all three gatherings, and the kit rendered.
  - [x] **Critical bug fix - AudioPlayer dead in production (`0:00 / 0:00`, unresponsive Play), 2026-09-16** - all 4 tiers verified:
    - Root cause: the seeded `reflections.audio_url` values point at Google's retired Actions sound library
      (`https://actions.google.com/sounds/v1/ambiences/morning_birds.ogg` and `gentle_rain.ogg`), which now
      returns **HTTP 404** with `content-type: text/html`. The media element therefore never loads metadata, so
      `duration` stays `NaN` (rendered as `0:00`) and `play()` rejects with `MEDIA_ERR_SRC_NOT_SUPPORTED` (code 4);
      the previous `catch {}` swallowed that rejection silently, which is why the button looked unresponsive.
    - `AudioPlayer.tsx` now resolves the incoming `src` defensively (`resolveAudioSrc`): absolute `http(s)://`,
      `//host`, `blob:` and `data:` values pass through untouched; root-relative values stay as-is; bare DB
      filenames (`morning_birds.ogg`) map to `/audio/<file>`; other relative paths are treated as root-relative;
      empty values resolve to the bundled track.
    - Added `hasError` + `usingFallback` state, a detailed `onError` log (media error code, human-readable
      `MEDIA_ERR_*` label, `networkState`/`readyState`, requested vs. active source), and a Promise-safe
      `togglePlay` (`await audio.play()` in try/catch that logs the rejection and surfaces the notice whenever
      `audio.error` is set - autoplay-policy `NotAllowedError` leaves `audio.error` null so it is not misreported).
    - Automatic fallback: the first load failure of a non-bundled source swaps `<audio>` to
      `/audio/reflection-demo.mp3` (the `key={activeSrc}` swap forces a fresh load); if the bundled track also
      fails, an amber "Audio stream currently unavailable" notice renders with a direct source link plus a retry
      button. A gentler slate notice appears while the bundled track stands in for an unreachable original source.
    - `onLoadedMetadata` / `onDurationChange` / `onTimeUpdate` / `onEnded` / `onError` are now all named handlers;
      `duration` is only stored when finite and positive, and the seek slider is disabled + clamped while metadata
      is missing (so `NaN`/`Infinity` can never reach the UI).
    - Bundled asset: `public/audio/reflection-demo.mp3` - 189 KB, 24.14 s, mono 44.1 kHz, 64 kbps. Synthesized
      locally (F-major pad built from `ffmpeg` `sine` sources + lowpass/tremolo/`aecho`/`alimiter`/fades), so it is
      original work with no third-party licence or attribution requirement. Regenerate with:
      `ffmpeg -y -f lavfi -i "sine=frequency=174.61:duration=24:sample_rate=44100" -f lavfi -i "sine=frequency=220:duration=24:sample_rate=44100" -f lavfi -i "sine=frequency=261.63:duration=24:sample_rate=44100" -f lavfi -i "sine=frequency=349.23:duration=24:sample_rate=44100" -filter_complex "[0:a][1:a][2:a][3:a]amix=inputs=4:normalize=0,volume=0.22,lowpass=f=1600,tremolo=f=0.12:d=0.35,aecho=0.8:0.5:60|140:0.25|0.15,alimiter=limit=0.9,afade=t=in:st=0:d=2.5,afade=t=out:st=21:d=3,aformat=channel_layouts=mono" -c:a libmp3lame -b:a 64k -ar 44100 -ac 1 public/audio/reflection-demo.mp3`
    - Deploy gotcha (same class as the earlier `src/lib` one): `public/audio/` is a new **untracked** path and is
      *not* gitignored, so it must be `git add`-ed and committed or Vercel will serve a 404 for the fallback track.
    - Optional data remediation (not applied - the component fallback already makes playback work without touching
      production data): `update reflections set audio_url = '/audio/reflection-demo.mp3' where audio_url like 'https://actions.google.com/%';`
    - Test results - Tier 1: `npx tsc --noEmit` exit 0. Tier 2: `npm run lint` exit 0. Tier 3: `npm run build`
      exit 0 (clean Turbopack compile + static prerender of `/`).
    - Test results - Tier 4 (runtime via `next start` + curl): `/` HTTP 200 with the player markup
      (`Listen to the reflection`, `Play the reflection`, `Playback speed and mute`); `/audio/reflection-demo.mp3`
      HTTP 200 with `Content-Type: audio/mpeg`, `Accept-Ranges: bytes`, 193934 bytes; a `Range: bytes=0-1023`
      request correctly returned `206 Partial Content` (so seeking works in Chrome/Safari).
    - Test results - Tier 4 (real-browser playback, headless Chrome over CDP, trusted mouse click - no
      `--autoplay-policy` bypass): the metadata step showed `src=/audio/reflection-demo.mp3`, `duration=24.14`,
      `readyState=4`, `mediaError=null`, counter `0:00 / 0:24` (no longer stuck) and the fallback notice visible;
      after the trusted click `paused=false`, `currentTime=2.41`, the button flipped to `Pause the reflection`
      with `aria-pressed=true`, counter `0:02 / 0:24`; pause worked; a seek to 12 s set `currentTime=12` and
      counter `0:12 / 0:24`; the console showed
      `Audio source failed to load (code 4): MEDIA_ERR_SRC_NOT_SUPPORTED: the source is missing or its format is unsupported`,
      proving the previously silent rejection is now logged and surfaced.
    - Test results - Tier 4 (source-normalisation matrix, extracted from the shipped function and executed in Node):
      `''`/whitespace -> `/audio/reflection-demo.mp3`; `morning_birds.ogg` -> `/audio/morning_birds.ogg`;
      `Morning_Birds.OGG` -> `/audio/Morning_Birds.OGG`; `audio/sermon.mp3` -> `/audio/sermon.mp3`;
      `media/kit/wav/talk.wav` -> `/media/kit/wav/talk.wav`; `/audio/x.mp3` unchanged; `https://`, `http://`,
      `//cdn...`, `blob:` and `data:` values unchanged; padded input trimmed; non-audio extensions resolved
      root-relative (`notaudio.txt` -> `/notaudio.txt`).
  - [x] **Bulletproof multi-tier audio architecture + universal MP3 fallback (`daily-reflection.mp3`), 2026-09-16** - all 4 tiers verified:
    - **Tier 1 data.** `getDailyReflection()` in `src/lib/reflections.ts` now normalises `audio_url` before
      it leaves the data layer: `null`/`undefined`/empty/whitespace and every Ogg-family path (`*.ogg`,
      `*.oga`, `*.opus`, `*.webm`, with `?query`/`#fragment` stripped before the check) are replaced by the
      bundled `/audio/daily-reflection.mp3`; `http(s)://`, `//host`, `data:`, `blob:` and other
      root-relative URLs pass through untouched so real hosted audio still plays as the primary source.
      Supabase errors, thrown network failures and an empty table now return `FALLBACK_REFLECTION` (new
      `src/lib/reflectionFallback.ts`, mirroring the existing `pulpitKitFallback.ts` convention), whose
      `audio_url` is the bundled MP3 - so Module 1 always renders a complete reflection and a playable
      track, even fully offline.
    - **Tier 2 asset.** `public/audio/daily-reflection.mp3` - 161,584 bytes, 20.14 s, mono 44.1 kHz,
      64 kbps MP3, ID3-tagged. Synthesised locally with `ffmpeg` (original work, no third-party licence or
      attribution), so there is always a valid same-origin asset at `/audio/daily-reflection.mp3`:
      `ffmpeg -y -f lavfi -i "sine=frequency=174.61:duration=20:sample_rate=44100" -f lavfi -i "sine=frequency=220:duration=20:sample_rate=44100" -f lavfi -i "sine=frequency=261.63:duration=20:sample_rate=44100" -f lavfi -i "sine=frequency=349.23:duration=20:sample_rate=44100" -filter_complex "[0:a][1:a][2:a][3:a]amix=inputs=4:normalize=0,volume=0.22,lowpass=f=1600,tremolo=f=0.12:d=0.35,aecho=0.8:0.5:60|140:0.25|0.15,alimiter=limit=0.9,afade=t=in:st=0:d=2.5,afade=t=out:st=17:d=3,aformat=channel_layouts=mono" -c:a libmp3lame -b:a 64k -ar 44100 -ac 1 public/audio/daily-reflection.mp3`
      The previous session's `public/audio/reflection-demo.mp3` was **deleted** (untracked, and nothing
      referenced it after the refactor) so `public/audio/` holds exactly one canonical asset.
    - **Tier 3 player.** `AudioPlayer.tsx` was re-architected into a multi-source player: the media element
      has **no `src` attribute** and instead renders `<source src={primarySrc} type={primaryType} />` plus a
      guaranteed `<source src="/audio/daily-reflection.mp3" type="audio/mpeg" />` as the last candidate.
      Browsers run the resource-selection algorithm across the candidates, so a 404/decode failure on the
      primary transparently falls through to the MP3 (an element-level `error` only fires once *every*
      candidate has failed). MIME hints are derived per extension (`resolveAudioType`) so a valid
      `.m4a`/`.wav` primary is never wrongly skipped by a hardcoded `audio/mpeg` type, and Ogg-family values
      are still swapped for the MP3 client-side as a second safety net. `key={primarySrc}` remounts the
      element if the prop changes; `retrySource()` re-runs selection via `audio.load()`.
    - `togglePlay` is promise-safe: `await audio.play()` inside `try`; on rejection it logs
      `Primary audio play blocked or failed, retrying reload:`, calls `audio.load()`, retries once, then logs
      `Audio playback fully rejected:` and surfaces `hasError`. A pre-flight guard routes an already-broken
      element (`audio.error` set, where some engines leave `play()` pending forever) into that same branch.
    - **Hydration race fix (the real "0:00 / 0:00" lock).** Because the page is statically prerendered, a
      fast same-origin MP3 can finish loading *before* React hydration attaches the media listeners -
      `loadedmetadata`/`canplay`/`durationchange` have then already fired, so the counter stayed at
      `0:00 / 0:00` forever even though `audio.duration` was 20.14. The player now syncs state from the
      element in the **ref callback** at commit time (`attachAudioElement` -> `syncFromElement`), with a
      `timeupdate` safety net that repairs a missing duration; `onLoadedMetadata` and `onCanPlay` share the
      same handler.
    - UI guarantees: every duration render uses `formatTime(duration || 0)` and duration is only stored when
      finite and positive, so `NaN`/`Infinity` can never reach the DOM; when `hasError` is true a clean amber
      badge reads **"Audio temporarily unavailable"** with a Retry action, and the transport button is
      disabled and always shows Play (`showPlaying = isPlaying && !hasError`) so the UI can never claim to be
      playing while it reports a failure. A slate notice appears when the selected candidate is the bundled
      track instead of the reflection's own URL (detected from the element's real `currentSrc`, not guessed).
      `DailyReflection.tsx` also now renders the player unconditionally (`src={reflection.audio_url ?? ''}`),
      so a missing URL can never remove the transport from the card at all.
- Test results - Tier 1: `npx tsc --noEmit` exit 0. Tier 2: `npm run lint` exit 0. Tier 3:
      `npm run build` exit 0 (clean Turbopack compile + TypeScript + static prerender of `/`).
    - Test results - Tier 4 (asset + markup via `next start` + curl): `/audio/daily-reflection.mp3`
      returns HTTP 200 with `Content-Type: audio/mpeg`, `Accept-Ranges: bytes`, `Content-Length: 161584`,
      an `ID3` header, and HTTP 206 for `Range: bytes=0-1023` (seeking works); the live Supabase row still
      stores `https://actions.google.com/sounds/v1/ambiences/morning_birds.ogg` while the prerendered HTML
      emits two `<source src="/audio/daily-reflection.mp3" type="audio/mpeg"/>` tags with no `src` on the
      `<audio>` element - proving the live `.ogg` value is normalised end-to-end; no error badge in the
      initial HTML.
    - Test results - Tier 4 (real browser, headless Chrome over CDP with a *trusted* mouse click, no
      autoplay-policy bypass, 9 scenarios): mount -> two sources, `currentSrc=/audio/daily-reflection.mp3`,
      `duration=20.14`, `readyState=4`, counter `0:00 / 0:20`; trusted click -> `paused=false`,
      `currentTime=1.92`, counter `0:01 / 0:20`, button `Pause the reflection`; pause -> `paused=true`; the
      primary `<source>` was then pointed at a 404 and `load()` called -> the browser selected the second
      candidate, `currentSrc=/audio/daily-reflection.mp3`, `duration=20.14` (Tier 2 fallback proven) and
      playback advanced to 1.75 s; with **both** candidates 404 -> the badge "Audio temporarily unavailable"
      rendered, `counter=0:00 / 0:00` (no `NaN`) and the transport was disabled; Retry while still broken ->
      stayed unavailable without crashing; restoring a working candidate cleared the badge, restored
      `0:00 / 0:20` and re-enabled the transport (self-heal); the final click played (1.71 s). A separate run
      with an **untrusted** programmatic click (fresh page, `navigator.userActivation.hasBeenActive=false`)
      forced the promise-safe path and logged `warning: Primary audio play blocked or failed, retrying
      reload: NotAllowedError...` then `error: Audio playback fully rejected: NotAllowedError...`, leaving
      the UI sane and never stuck.
    - Test results - Tier 4 (deterministic hydration-race reproduction): with every `/_next/static/chunks/*`
      request held for 3 s via CDP `Fetch` interception, the pre-hydration sample showed
      `counter="0:00 / 0:00"` with `elementDuration=20.14, readyState=4` (metadata beat hydration - the exact
      old failure state) and the post-hydration sample showed `counter="0:00 / 0:20"` with no badge, proving
      the ref-callback sync closes the race.
    - Observation: in one CDP run the very first `play()` reported `paused=false` while the clock stayed at 0;
      the same flow advanced in real time (0 -> 3.32 s in 3.6 s, pause at 3.63 s, resume to 5.14 s) in a
      dedicated sampling run on the same build, so this is a headless Chrome audio-sink warm-up artifact,
      not component state (the counter is driven by the browser's own `timeupdate`).
    - Optional data remediation (not applied - the layers above already make playback work without touching
      production data): `update reflections set audio_url = '/audio/daily-reflection.mp3' where audio_url like 'https://actions.google.com/%';`
    - Deploy gotcha (same class as the earlier `src/lib` one): `public/audio/daily-reflection.mp3` is a new
      **untracked** path and is *not* gitignored, so it must be `git add`-ed and committed or Vercel will
      serve a 404 for the guaranteed fallback track.

## PHASE 5 - Sentry Integration (@sentry/nextjs v10.74.0)
- Installed `@sentry/nextjs@^10.74.0`; DSN comes from `NEXT_PUBLIC_SENTRY_DSN` in `.env.local` (already present).
- Init is **DSN-gated** in every config: with no DSN, `Sentry.init` never runs, so local/CI builds with no credentials stay silent and healthy. Files: `sentry.client.config.ts` (traces 1.0, replays 0.1/1.0), `sentry.server.config.ts` (traces 1.0), `sentry.edge.config.ts` (traces 1.0).
- Next.js 16 + SDK v10 loading gotchas (verified against `node_modules/next/dist/docs` and the SDK's own build output):
  - **Server/edge**: SDK v10 requires an `instrumentation.ts` file; `sentry.server.config.ts` alone is not picked up. `instrumentation.ts` lazily imports server or edge config by `NEXT_RUNTIME` and exports `onRequestError = Sentry.captureRequestError`.
  - **Client**: with Turbopack (Next 16 default), `sentry.client.config.ts` is NOT auto-loaded (SDK logs "When using Turbopack `sentry.client.config.ts` will no longer work"). `instrumentation-client.ts` imports it and exports `onRouterTransitionStart = Sentry.captureRouterTransitionStart` (SDK warns at build time if this hook is missing).
  - Both instrumentation modules just evaluate the config files; module singleton guarantees `Sentry.init` runs exactly once per bundle.
- `next.config.ts` wrapped with `withSentryConfig` imported from **`@sentry/nextjs/config`** (root re-export is deprecated, removed in v11). Options used: `silent: !process.env.CI`, `widenClientFileUpload: true`, and v10 replacements for two deprecated task options - `sourcemaps: { deleteSourcemapsAfterUpload: true }` (instead of `hideSourceMaps`, removed in v10) and `webpack.treeshake.removeDebugLogging: true` (instead of `disableLogger`; webpack-only, no-op under Turbopack).
- Smoke route `src/app/api/sentry-test/route.ts`: `force-dynamic` GET, captures a labeled test exception, awaits `Sentry.flush(2000)` (serverless freeze safety), wraps everything in try/catch so monitoring failures can never break the endpoint, returns `{success, message, timestamp}`.
- Test results - Tier 1/2/3: `npx tsc --noEmit` exit 0, `npm run lint` exit 0, `npm run build` exit 0 (also clean under `CI=1`; route appears as `ƒ /api/sentry-test`).
- Test results - Tier 4 (real browser, headless Chrome over CDP against `next start`): client SDK initialized with exactly the configured options (`tracesSampleRate=1`, `replaysSessionSampleRate=0.1`, `replaysOnErrorSampleRate=1`) and **5 envelopes delivered HTTP 200** to the real Sentry ingest host - client init, transport, and DSN proven end-to-end. Server-side `onRequestError` wired via `instrumentation.ts`.
- Build-log note (expected, not a failure): with `CI=1`, `[@sentry/nextjs - After Production Compile]` prints "No auth token provided" warnings - source-map upload + release creation are skipped until `SENTRY_AUTH_TOKEN` (+ optional `SENTRY_ORG`/`SENTRY_PROJECT`) are set. Build itself succeeds and source maps are simply kept on disk (nothing is deleted when upload is off).
- Untracked files to commit: `sentry.{client,server,edge}.config.ts`, `instrumentation.ts`, `instrumentation-client.ts`, `src/app/api/`, plus the modified `next.config.ts` / `package.json` / `package-lock.json`.


## PHASE 0 COMPLETION - Official Visual Reskin & Brand Alignment with JesusUnited.org (2026-09-16)
> Originally executed and logged as the visual reskin phase; this record certifies Phase 0 completion
> (brand system foundation: typography, palette, canvas, and module treatments for all three modules).
- **Design tokens** (`src/app/globals.css`, Tailwind v4 `@theme inline`): full JesusUnited.org palette as
  named tokens — `--color-canvas #FAF7EE` (warm ivory canvas), `--color-espresso #2D261E` (primary text),
  `--color-muted #786F66` (secondary text), `--color-sand #EDE7D9` (warm borders/dividers), `--color-gold
  #D4A359` + `--color-gold-deep #C49348` (honey gold accent/hover), `--color-pill #F6EFE2` +
  `--color-pill-ink #8C6221` (badges/pills). Warm ambient elevation via theme shadows: `--shadow-soft`
  (cards) and `--shadow-lift` (hover) — both rgba(45,38,30,*) warm-tinted instead of cold black. Removed the
  `prefers-color-scheme: dark` override (it broke the warm brand in dark mode); `:root` now sets
  `--background #FAF7EE` / `--foreground #2D261E` and `body` uses `var(--font-jakarta)`.
- **Typography** (`src/app/layout.tsx`): Geist/Geist Mono replaced with `Plus_Jakarta_Sans` from
  `next/font/google` (self-hosted, weights 400/500/600/700/800, `display: swap`, variable
  `--font-jakarta`, zero CLS). Geometric tracking + bold weights applied across headings: `font-extrabold
  tracking-tight` (800) on the hero h1, reflection title, and kit title; `font-bold` (700) on card/module
  headings; uppercase eyebrow labels use `tracking-[0.18em]`–`[0.2em]` with `font-bold`. Metadata rebranded
  ("JesusUnited — Guest-First Ministry Toolkit"). `<html>` gained `scroll-smooth`; `<body>` is
  `bg-canvas font-sans text-espresso`. Verified in build: 4 self-hosted woff2 files in
  `.next/static/media/`, `@font-face "Plus Jakarta"` in the compiled CSS chunk, and
  `--font-sans:var(--font-jakarta)` emitted.
- **Demo shell** (`src/app/page.tsx`): brand hero (pill "Demo Preview" badge in pill/pill-ink, espresso
  extrabold h1, muted lede) plus a NEW accessible pill navigation (`<nav aria-label="Module shortcuts">`)
  with rounded-full anchor links to the three module sections (white surface → gold border/pill bg on
  hover). Module eyebrow headings moved to muted + tracking-[0.2em]; footer divider is now warm
  `border-sand`. Sections gained `scroll-mt-8` for anchor offsets under smooth scroll.
- **Module 1 — Daily Reflection**: card is `rounded-3xl border-sand bg-white shadow-soft`; "DAILY BREAD"
  is now a soft warm pill (`bg-pill text-pill-ink`, both states — the solid teal badge is gone); scripture
  reference uses `text-pill-ink` (5.4:1 on white); body text `text-espresso/80`; title extrabold.
  `AudioPlayer.tsx` is gold-accented: play transport `bg-gold text-espresso hover:bg-gold-deep`, track
  `bg-sand` with gold progress fill and gold webkit/moz range thumbs (plus a `focus-visible:ring-gold`
  keyboard-focus ring on the scrubber input), warm pill speed/mute buttons, warm inset container
  (`rounded-2xl border-sand bg-pill/40`); fallback notice restyled to `bg-pill text-espresso/80` with
  `text-pill-ink` retry link; error badge keeps amber semantics. No playback-architecture logic was
  touched (multi-tier `<source>` fallback and hydration sync from Phase 3/5 are intact).
- **Module 2 — Gatherings Map**: toolbar card `rounded-3xl` + `shadow-soft`; search input is now
  **rounded-full** on warm `bg-canvas` with gold focus (`focus:border-gold ring-gold/25`); metro badge and
  counts use pill/pill-ink and muted; empty states rounded-3xl with warm dashed sand borders.
  `GatheringCard.tsx` is `rounded-3xl` with soft elevation and a hover lift (`hover:-translate-y-0.5
  hover:border-gold/40 hover:shadow-lift`); meeting-time badge is a warm pill; **NEW warm distance badge**
  renders when PostGIS `distance_meters` is present (`formatDistance` → `(m/1609.34).toFixed(1) mi away`),
  in the same pill style; WhatsApp CTA is the primary gold action (`bg-gold text-espresso rounded-full
  hover:bg-gold-deep`); Email/Google Maps secondary links are rounded-full with warm hover.
- **Module 3 — Pulpit Kit Generator**: container `rounded-3xl shadow-soft`; the tab switcher is now a
  **rounded-full** pill rail on `bg-pill` with the active tab highlighted in gold (`bg-gold text-espresso
  rounded-full shadow-sm`) and muted inactive tabs (keyboard arrow-key navigation and print-forcing
  classes unchanged). `KitHeader` badges: "Pulpit Kit" pill in pill/pill-ink, meta pills white with sand
  border + muted text, theme pill gold with espresso ink, scripture pills pill/pill-ink.
  `KitActionBar` triggers are rounded-full: "Copy Markdown Kit" gold/espresso, "Print / Export View"
  white/sand with gold hover. `KitSlideDeck` slide previews are clean white cards (`rounded-2xl
  border-sand shadow-soft`, pill-tinted header strip, pill-ink label, espresso title, muted body) — the
  old slate-900 dark slides are gone. `KitOutlinePanel`/`KitStudyPanel` use warm `bg-canvas` inset rows,
  gold number circles (`bg-gold text-espresso`), pill-ink section eyebrows, gold-bordered quote block
  (`border-l-4 border-gold bg-pill`), and warm CTA panel.
- **Accessibility (WCAG 2.1 AA)** — every gold/pill pairing was contrast-computed before adoption; white
  text on gold (#D4A359) was REJECTED at ~2.3:1, so all gold buttons/controls carry espresso ink:
  espresso-on-gold 6.5:1, espresso-on-gold-deep 5.4:1, pill-ink-on-pill 4.7:1, pill-ink-on-white 5.4:1,
  muted-on-white 4.9:1, muted-on-canvas 4.6:1, espresso-on-canvas ≈12:1. All ARIA labels/roles (tablist,
  tab, tabpanel, range slider `aria-valuetext`, live-region notices, `sr-only` dl terms) preserved
  unchanged through the reskin; new nav is a labelled landmark; scrubber gained a visible keyboard focus
  ring. All icons remain `aria-hidden` decorations.
- Test results - Tier 1: `npx tsc --noEmit` exit 0. Tier 2: `npm run lint` exit 0. Tier 3: `npm run
  build` exit 0 (clean Turbopack compile + TypeScript + static prerender of `/`, 4/4 pages).
- Test results - Tier 4: all 8 brand hex values present in the compiled CSS chunk; 4 self-hosted
  Plus Jakarta woff2 files emitted and referenced; `--font-sans:var(--font-jakarta)` in CSS; prerendered
  HTML contains the brand utilities (text-espresso ×54, border-sand ×50, text-muted ×41, bg-pill ×32,
  text-pill-ink ×23, bg-gold ×19, bg-canvas ×8, rounded-3xl ×6) and zero legacy teal/slate/indigo
  classes (grep hits were only `-translate-y-` false positives); `next start` runtime smoke: HTTP 200
  with Daily Bread pill, WhatsApp CTA, Print/Export View, and Sermon Architecture all rendered.
- Files touched: `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`, and all 10 components
  under `src/app/components/` (DailyReflection, AudioPlayer, GatheringMap, GatheringCard, PulpitKit,
  KitHeader, KitActionBar, KitSlideDeck, KitOutlinePanel, KitStudyPanel). No changes to `src/lib/`,
  print isolation CSS, or audio fallback architecture.
- Lint-gate fix (Phase 0 re-certification): after the `.cline/skills/` directory landed in the workspace,
  `npm run lint` swept up skill tooling (`html2pptx.js` require-import errors) that is not app code.
  Fixed by adding `".cline/**"` to `globalIgnores` in `eslint.config.mjs` (the config overrides
  eslint-config-next's default ignores, so the skills dir must be ignored explicitly). Zero lint
  warnings/errors across the app after the fix.
- Phase 0 completion re-certification: `npx tsc --noEmit` exit 0, `npm run lint` exit 0, `npm run build`
  clean (4/4 pages prerendered) — all three mandatory gates green on the final tree.

## PHASE 1 - Authentication & Community - Task 1: Session Middleware & Typed Schemas (2026-09-16)
- **Next.js 16 gotcha honored (AGENTS.md rule)**: the task asked for `src/middleware.ts`, but this Next
  version **deprecates the `middleware` file convention and renames it to `proxy`** (verified in
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`). Implemented as
  **`src/proxy.ts`** exporting a single async `proxy(request: NextRequest)` function + `config.matcher`;
  the build route table confirms registration (`ƒ Proxy (Middleware)`). Do not add a `middleware.ts` —
  it would conflict/deprecate-warn.
- **Session refresh** (`src/proxy.ts`): standard `@supabase/ssr` v0.12 server-client pattern on
  `NextRequest` cookies — `getAll()` reads request cookies; `setAll()` re-sets them on the request and
  replays each rotated cookie onto a FRESH `NextResponse.next({ request })` (recreated inside `setAll`
  so token rotations always reach the browser). Calls `supabase.auth.getUser()` — the server-VERIFIED
  refresh path; never `getSession()`/`getClaims()` in proxy, which trust the client-forgable cookie
  payload. Resilience: env-gated pass-through when `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` are absent
  (same DSN-gated philosophy as Sentry init), and `getUser()` is wrapped in try/catch so an auth-server
  outage logs and continues as guest rather than blocking page loads.
- **Matcher** (all routes minus static assets): `'/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|mp3|ogg|wav|woff|woff2)$).*)'`
  — covers pages, `/api/*`, and Server Actions; excludes build chunks, image optimizer, favicon, images,
  audio, and webfonts. Per Next 16 docs, auth must still be verified inside Server Functions (proxy
  matchers can silently skip them); RLS remains the real authorization layer.
- **Typed schemas** (`src/lib/types.ts`, appended after the demo-portal types): `DatabaseTimestamp`
  (timestamptz → ISO string) and `DatabaseDate` (`date` → `YYYY-MM-DD`) aliases, then strict interfaces —
  `Profile` (city/country nullable), `AltarCompletion` (evening_journal nullable), `HabitEntry` (four
  minute counters), `GatheringSubmissionStatus` union (`'pending' | 'approved' | 'rejected'`),
  `GatheringSubmissionData` (strict shape for the `gathering_data` jsonb so approved rows can be
  inserted into `gatherings` without inference surprises), `GatheringSubmission`, `GatheringAttendance`,
  `PrayerRequest` (`topics: string[]` for `text[]`), `PrayerIntercession`. Nullable columns are typed
  `| null` (never `undefined`), per the deterministic-schema rule.
- Test results - Tier 1: `npx tsc --noEmit` exit 0. Tier 2: `npm run lint` exit 0. Tier 3: `npm run
  build` exit 0 with **zero warnings**, route table showing `ƒ Proxy (Middleware)`.
- Test results - Tier 4 (`next start` + curl): `/` HTTP 200, `/api/sentry-test` HTTP 200 (proxy-covered
  route), `/audio/daily-reflection.mp3` HTTP 200 (matcher-excluded asset), server log clean (no errors).
- Files touched: new `src/proxy.ts`; extended `src/lib/types.ts`. No changes to `supabaseBrowser.ts`,
  `supabaseServer.ts` (their try/catch `setAll` comment now refers to this proxy), or any component.
- Note for next tasks: no test runner is installed (tdd-workflow skill) — `tsc` type-determinism plus
  the three gates are the verification layer, consistent with Phases 2-5.

## PHASE 1 - Task 2: Altar OS v1 (Morning Altar & Evening Examen with Habit Logging) (2026-09-16)
- **Data layer** (`src/lib/altar.ts`, client-safe): `AltarDayState` (morningCompleted/eveningCompleted/
  eveningJournal + `HabitMinutes` prayer|scripture|worship|service), `HABIT_STEP=5`/`HABIT_MAX=600` with
  `clampHabitMinutes`. Cloud mode: parallel `.maybeSingle()` reads from `altar_completions` + `habits`
  filtered by (user_id, date), and `upsert(..., { onConflict: 'user_id,date' })` on both tables on save
  (snake_case payloads mapped from the strict camel interfaces). Guest mode: localStorage
  `jesusunited:altar-os:v1` keyed by local `YYYY-MM-DD`, all storage access try/catch-guarded (private
  mode / quota / corrupt JSON never throw). Auth via `supabaseBrowser.createClient().auth.getUser()`;
  a cloud read failure keeps mode 'cloud' (saves still attempted) while a failed cloud SAVE always
  leaves a localStorage backup behind (`persistAltarDay` returns `{ok, mode}`).
- **Component** (`src/app/components/AltarOS.tsx`, 'use client'): ivory Altar OS card per brand spec —
  outer container `bg-canvas rounded-3xl border-sand shadow-soft` with white inner panels. Rounded-full
  tab rail (Morning Altar / Evening Examen / Habit Logger) with gold active tab + ArrowLeft/Right
  keyboard navigation (full tablist/tab/tabpanel ARIA). Morning: scripture focus card (pill-ink
  reference pill, title, excerpt; falls back to Lamentations 3:22-23 when no daily reflection exists),
  3 guided reflection prompts with gold number circles, "Mark morning complete" toggle (outline → gold,
  `aria-pressed`). Evening: 3 examen prompt cards (Gratitude / Awareness / Grace), journal textarea
  with debounced 800ms autosave + `aria-live` save notice (Saving… / Saved to your account / Saved on
  this device / Save failed — kept on device), evening complete toggle. Habits: 4 counters (±5 min
  rounded-full buttons, `tabular-nums` extrabold totals, disabled at bounds, labelled per-control).
  Header shows an Altar OS pill, the live date pill, and a mode badge (pill = signed-in syncing, gold =
  guest on-device).
- **Hydration safety**: the date is computed ONLY after mount (`todayLocalDate()` inside useEffect) and
  the server render is a `role="status"` skeleton ("Preparing your altar…") — the prerendered HTML and
  first client render match exactly, so timezone-dependent UI never causes a hydration mismatch.
- **Ref lint fix**: the new `react-hooks/refs` rule forbids `stateRef.current = state` during render;
  fixed with a single `updateState()` mutation path (ref + `setState` together), so debounced journal
  writes and rapid counter taps always persist the latest state.
- **Page integration** (`src/app/page.tsx`): Altar OS section mounted between Module 1 and Module 2
  (`#altar-os-section`, eyebrow "Altar OS · Morning Altar & Evening Examen", mt-16 + scroll-mt-8), fed
  live scripture focus from `getDailyReflection()` (title/reference/first 240 chars, null-safe); a new
  "Altar OS" pill was added first in the hero module-shortcut nav. `globals.css` print isolation now
  also hides `#altar-os-section` so Print/Export still yields only the Pulpit Kit.
- Test results - Tier 1: `npx tsc --noEmit` exit 0. Tier 2: `npm run lint` exit 0 (after the
  react-hooks/refs fix). Tier 3: `npm run build` exit 0, zero warnings, 4/4 pages prerendered, proxy
  still registered.
- Test results - Tier 4 (`next start` + curl): `/` HTTP 200; prerendered HTML contains the
  `altar-os-section`, the "Altar OS" nav pill, and the SSR skeleton (`Preparing your altar`) exactly
  once; server log clean.
- Files touched: new `src/lib/altar.ts`, new `src/app/components/AltarOS.tsx`; edited
  `src/app/page.tsx`, `src/app/globals.css`. No changes to `src/lib/types.ts` (Task 1 schemas reused
  as-is) or the Supabase clients.
- Schema dependency to verify with the DBA/MCP before enabling cloud mode in prod: UNIQUE constraints
  on `altar_completions(user_id, date)` and `habits(user_id, date)` are required for the upsert
  conflict targets; RLS must restrict all four write columns to `auth.uid() = user_id`.

### Task 2 addendum - AltarOS.tsx "JSX syntax error" diagnostics triage (2026-09-16)
- IDE diagnostics claimed unmatched braces/unclosed JSX at lines 168/207/255/301. Full-file audit found
  the on-disk file is VALID: the reported lines point at `void persist(...)`, the `saveNotice` ternary,
  `isActive`, and `state.morningCompleted` — none are syntax errors. The diagnostics matched the
  INTERMEDIATE states while the component was authored in sequential editor chunks (Part A-D), i.e.
  stale editor state, not real defects.
- Evidence: `npx tsc --noEmit` exit 0; `npm run lint` exit 0; `npm run build` exit 0 (zero errors,
  4/4 prerendered); a quote/string-aware balance audit returned 0/0/0 for braces/parens/brackets; all
  three tab panels (`morning`/`evening`/`habits` conditionals, 36 closing JSX tags) present; runtime
  `next start` smoke: `/` HTTP 200, SSR skeleton present once, and "Evening Examen"/"Habit Logger"/
  "Mark morning complete" all compiled into client chunk `2vq-wy11b_j3q.js`; server log clean.
- Gotcha for future smoke tests: run `next start` only AFTER `next build` fully completes — starting
  mid-build yields "Could not find a production build ... build-id" and curl HTTP 000 (first attempt
  raced the build; retry with a longer wait succeeded). No code changes were required for this task.



## PHASE 1 - Task 3: Gathering Submissions & Community Attendance Tracking (2026-09-16)
- **Data layer** (`src/lib/gatheringsSubmissions.ts`, client-safe on `supabaseBrowser.createClient()`):
  `submitGathering(Omit<GatheringSubmission, 'id' | 'status' | 'created_at'>)` inserts into
  `gathering_submissions` with hard-coded `status: 'pending'` (promotion to `gatherings` is an
  editor-only flow, never client-side) and returns `{ ok, error }` instead of throwing.
  `recordAttendance(gatheringId)` resolves the user via `getCurrentUserId()` (reused from
  `src/lib/altar.ts`) and inserts `{ gathering_id, user_id }` into `gathering_attendances`; guests and
  failed cloud writes degrade to localStorage `jesusunited:gathering-attendance:v1`
  (`LocalAttendanceRecord[]`, every storage read/write try/catch-guarded like Altar OS).
  `getAttendanceCount(gatheringId)` uses the `head: true, count: 'exact'` PostgREST count and folds in
  +1 for the viewer's own on-device record ONLY when unauthenticated (a signed-in believer's row is
  already inside the cloud count — avoids double-counting); count-query failure falls back to the
  on-device count. `hasLocalAttendance(gatheringId)` exposes the attended flag for UI state.
  Auth resolution is cached in a module-level `cachedUserId` so N cards trigger one auth round-trip.
- **Modal** (`src/app/components/GatheringSubmissionModal.tsx`, 'use client'): accessible dialog
  (`role="dialog"`, `aria-modal`, labelled/described by ids) with full focus trap (Tab/Shift+Tab
  cycling over a `FOCUSABLE_SELECTOR` query), Esc-to-close, backdrop-click close, body scroll lock,
  focus-into-first-field on open and focus restore to the trigger on close. Nine validated inputs:
  Gathering Name, City, Country, Denomination/Type (optional), Meeting Times, Street Address,
  Coordinates (optional, parsed `lat, lng` with range checks), Submitter Name, Submitter Email
  (regex + required) — inline `role="alert"` errors with `aria-invalid`/`aria-describedby`, warm
  linen canvas surface (`bg-canvas rounded-3xl border-sand shadow-lift`), gold/pill accents, gold
  submit with submitting state, gold-check success panel, and form reset after a completed close.
  Payload mapping: `leader_name`=submitter name, `contact_email`=submitter email, denomination folded
  into `description`, address = "street, city, country", optional lat/lng into `gathering_data`.
- **Card integration** (`src/app/components/GatheringCard.tsx` → now 'use client'): new "I attended"
  counter button above the WhatsApp CTA — optimistic count+state, `aria-pressed`, `motion-safe:animate-ping`
  gold pulse ring (re-keyed `pulseKey` so repeat pulses restart; timer cleaned up on unmount),
  `tabular-nums` count badge showing "—" until the client count resolves (hydration-safe: prerendered
  HTML matches first client render), `role="status"` notice line ("You are counted — see you there!" /
  "Counted on this device." / rollback+error message on failure), disabled once attended. New icons
  in `icons.tsx`: `PlusIcon`, `UsersIcon`, `CloseIcon`.
- **Map integration** (`src/app/components/GatheringMap.tsx`): gold rounded-full "Submit a Gathering"
  pill button in the toolbar (flex-wrap added for mobile) mounting `GatheringSubmissionModal`
  (`submissionOpen` state, render-gated so nothing modal-ish ships in prerendered HTML).
- Authoring gotcha (same class as Task 2's addendum): chunked editor inserts left one missing `};`
  (after `requestClose`), one duplicated closing brace (EOF of `gatheringsSubmissions.ts`), and a
  stranded `fieldError` line inside JSX — all caught immediately by Gate 1 (`tsc`) and fixed; the
  final tree is fully verified.
- Test results - Tier 1: `npx tsc --noEmit` exit 0. Tier 2: `npm run lint` exit 0 (zero warnings).
  Tier 3: `npm run build` exit 0 — compiled successfully, zero warnings, 4/4 pages prerendered,
  `ƒ Proxy (Middleware)` still registered. Tier 4 (`next start` + curl): `/` HTTP 200; prerendered
  HTML contains 3× "I attended" (one per seeded card), 1× "Submit a Gathering", and 0× modal markup
  (render-gated as designed); server log clean.
- Schema dependency to verify with the DBA/MCP before prod: `gathering_attendances` needs RLS
  restricting inserts to `auth.uid() = user_id`; `gathering_submissions` needs an anon-writable
  insert policy with `status` defaulting/forced to `'pending'`. No `src/lib/types.ts` changes were
  required (Task 1 schemas reused as-is).


### Task 3 addendum - "syntax/structural errors" diagnostics triage (2026-09-16)
- IDE diagnostics reported: `GatheringCard.tsx:15` ('from' expected), `GatheringSubmissionModal.tsx:277-278`
  (unescaped `>`/`}` in JSX, unclosed `div`/`form`), a dangling brace near line 462, and
  `gatheringsSubmissions.ts:206` (extra trailing brace). Full-file audit found ALL on-disk files VALID —
  zero code changes were required. The reported line numbers correspond exactly to the INTERMEDIATE
  authoring states that Gate 1 (`tsc`) already caught and fixed during the original task (missing `};`
  after `requestClose`, duplicated EOF brace, stranded `fieldError` inside JSX) — i.e. stale editor
  diagnostics, the same class as the Task 2 addendum.
- Evidence (all on the final tree, cold cache): `rm -f tsconfig.tsbuildinfo && npx tsc --noEmit` exit 0;
  `npm run lint` exit 0 (zero warnings); `npm run build` captured with explicit `echo BUILD_EXIT=$?` →
  **0** with zero error/warning strings in the full log; `GatheringCard.tsx:15` is `getAttendanceCount,`
  inside a well-formed multi-line import closed at line 18; modal line 277-278 are
  `<form noValidate ...>` + `<div className="grid gap-4">` (no raw `>`/`}` outside expression braces);
  the file ends at 461/462 with the single closing brace of `SubmissionField` (no `};`);
  `gatheringsSubmissions.ts` ends at 205 with one closing brace.
- Structural audit (parser-independent): braces/parens/brackets balance 0/0/0 in all three files; zero
  control characters; modal `<div>` audit 11-open vs 10-close explained — line 213's
  `<div aria-hidden onClick={requestClose} />` is self-closing (backdrop), so pairing is exact; `form`
  pairs 1/1. Runtime smoke from the original task stands: `/` HTTP 200 with 3× "I attended" and 1×
  "Submit a Gathering" in the prerendered HTML.
- Guidance: treat stale-diagnostics reports for files whose `tsc`/`lint`/`build` gates exit 0 as
  editor-state artifacts — verify against the on-disk file + gates before editing; never "fix" valid
  code (e.g. replacing a structural `>` with `&gt;`) to silence a phantom diagnostic.

## PHASE 1 - Task 4: Prayer Network v1 (Prayer Wall, Submission Modal & Intercession Pulse) (2026-09-17)
- **Data layer** (`src/lib/prayers.ts`, client-safe on `supabaseBrowser.createClient()` +
  `getCurrentUserId()` from `altar.ts`):
  - `getPrayerRequests(filter?: { topic?: string; answeredOnly?: boolean })` fetches
    `prayer_requests` where `is_public = true` ordered `created_at desc` (server-side
    `.contains('topics', [topic])` / `.eq('is_answered', true)` filters). Empty table or ANY cloud
    read failure degrades to the bundled `DEMO_PRAYERS` fallback (5 Scripture-grounded entries with
    deterministic UUIDs, incl. one answered with `answered_note`) filtered client-side by the same
    filter — the wall is never blank. Rows are normalized defensively via `parsePrayerRow` (never
    throws; skips unparseable rows).
  - `submitPrayerRequest(Omit<PrayerRequest, 'id' | 'created_at' | 'intercession_count'>)` inserts
    into `prayer_requests` and returns `{ ok, error }` (never throws). The signed-in user id is
    resolved inside the data layer: guests/anonymous submit with `user_id: null` (payload typed
    `Omit<…, 'user_id'> & { user_id: string | null }` — a plain `& { user_id: string | null }`
    intersection collapses to `string` and fails tsc; use `Omit` first). A blank `user_id` on the
    incoming payload is treated as guest.
  - `recordIntercession(requestId)` inserts into `prayer_intercessions` then bumps
    `intercession_count` (read-then-`update(+1)` via `bumpIntercessionCount` — PostgREST has no
    `count = count + 1` without an RPC; the bump is best-effort, the intercession row is the source
    of truth). Postgres `23505` unique violation (same believer already prayed today) is treated as
    success WITHOUT a second bump. Signed-in failures and guests persist to localStorage
    `jesusunited:prayer-intercessions:v1` (`{ records: [{ request_id, prayed_at }] }`,
    deduplicated per LOCAL day to mirror the DB unique-per-day rule; all storage access
    try/catch-guarded). Exports `hasLocalIntercession` / `getLocalIntercessionIds` (same local-day
    semantics) so the wall can pre-disable "I Prayed" for on-device guests.
- **Wall component** (`src/app/components/PrayerWall.tsx`, 'use client'): white rounded-3xl
  border-sand shadow-soft container on the ivory canvas. Toolbar: "All prayers" + six topic filter
  pills + "Answered" toggle (all `aria-pressed`, gold/pill active states, one shared
  `role="group"` labelled "Filter prayers by topic") + gold rounded-full "Share a Prayer" trigger.
  `aria-live="polite"` result count line ("5 prayers in Healing · answered only"). Skeleton is a
  `role="status"` pulsing grid while `prayers === null` (prerendered HTML and first client render
  match — hydration-safe; data loads client-side exactly like AltarOS/GatheringCard). Cards
  (`bg-canvas` inner): gold/pill initial avatar, author ("Anonymous" when `author_name` is blank),
  formatted date, "Answered" gold badge, title, body, topic pills, italic `answered_note` callout,
  intercession footer — `<UsersIcon> N praying` (count in `aria-live="polite"` tabular-nums span)
  plus the "I Prayed" button: optimistic +1 via `optimisticCounts` override map, disabled after
  intercession ("You prayed"), gold pulse via the `prayer-pulse` CSS class applied while
  `pulseId === prayer.id` and cleared on `onAnimationEnd`; failed cloud writes roll back both the
  count and the interceded flag. Empty state: dashed card inviting the first submission.
- **Lint gotcha (new react-hooks rules)**: `react-hooks/set-state-in-effect` flags BOTH a
  synchronous `setState` in an effect body AND `void load()` when `load` is a useCallback whose
  body setState's (even after `await`). Approved pattern (mirrors `GatheringCard.tsx:72`): the
  effect calls a PURE async fetcher and applies state inside `.then()` behind an `active` cleanup
  flag — `useEffect(() => { let active = true; void fetchWall().then((r) => { if (active)
  applyResult(r); }); return () => { active = false; }; }, [fetchWall, applyResult])`. Also:
  `icons.tsx` `IconProps` has no `strokeWidth` — never pass it to an existing icon.
- **Submission modal** (`src/app/components/PrayerSubmissionModal.tsx`, 'use client'): full
  accessibility clone of GatheringSubmissionModal — `role="dialog"` + `aria-modal` +
  labelled/described by header ids, focus moved to first field on open, Tab/Shift+Tab trap via
  `FOCUSABLE_SELECTOR`, Escape closes, body scroll locked, focus restored to trigger on unmount,
  backdrop click closes, X button with `aria-label`. Fields: Author name (disabled when anonymous)
  + "Remain Anonymous" toggle (custom `aria-pressed` gold check circle; clears the name
  requirement), Title (maxLength 120), Prayer request textarea (10–1000 chars), Topic multi-select
  pills (`role="group"`, `aria-pressed`, ≥1 required). Validation clears per-field on edit; errors
  are `role="alert"` + `aria-invalid`/`aria-describedby` wired. A crisis-escalation note
  (pastor/local church/emergency services — per the .clinerules theological-safety rail) sits above
  the footer. Success state: gold check circle + James 5:16 quote panel; calls the new
  `onSubmitted?` prop (PrayerWall refetches through `fetchWall().then(applyResult)`) and resets on
  close. New icons: `HeartIcon`, `HandHeartIcon`.
- **Page integration** (`src/app/page.tsx`): `#prayer-wall-section` mounted between Gatherings Map
  and Pulpit Kit (eyebrow "Intercession Pulse · Community Prayer Wall", mt-16 + scroll-mt-8);
  "Prayer Wall" pill added to the hero module-shortcut nav after "Gatherings Map"; hero blurb
  updated to four modules. `globals.css`: `@keyframes prayer-pulse` + `.prayer-pulse` (700ms gold
  ring, `prefers-reduced-motion: reduce` disables it) and `#prayer-wall-section` added to the
  print-isolation hidden list.
- Test results - Tier 1: `npx tsc --noEmit` exit 0. Tier 2: `npm run lint` exit 0 (zero
  warnings — after the set-state-in-effect restructure). Tier 3: `npm run build` exit 0, compiled
  successfully, zero errors, 4/4 pages prerendered, `ƒ Proxy (Middleware)` still registered.
- Test results - Tier 4 (`next start` + curl): `/` HTTP 200; prerendered HTML contains
  `prayer-wall-section` (1×), the "Prayer Wall" nav pill (1×), "Share a Prayer" (1×), 0×
  `role="dialog"` markup (render-gated as designed); server log clean. (Start-after-build gotcha
  from Task 2 recurred: launching `next start` while `next build` was still running yielded
  "Could not find a production build" — rerun sequentially.)
- Files touched: new `src/lib/prayers.ts`, `src/app/components/PrayerWall.tsx`,
  `src/app/components/PrayerSubmissionModal.tsx`; edited `src/app/components/icons.tsx`,
  `src/app/page.tsx`, `src/app/globals.css`. No `src/lib/types.ts` changes (Task 1
  `PrayerRequest`/`PrayerIntercession` reused as-is).
- Schema dependency to verify with the DBA/MCP before prod: `prayer_requests` needs RLS allowing
  anon INSERT with `user_id` nullable (guest/anonymous submissions); anon SELECT must be restricted
  to `is_public = true`; `prayer_intercessions` needs the UNIQUE (request_id, user_id, per-day)
  constraint (the 23505 path depends on it) plus RLS restricting inserts to
  `auth.uid() = user_id`; a security-definer RPC for the atomic `intercession_count + 1` bump would
  replace the read-then-update once available.

## PHASE 2 - Task 1: Realtime Prayer Wall & Intercession Streams (2026-09-17)
- **Subscription layer** (`src/lib/usePrayerRealtime.ts`, new, 'use client'): one-shot
  `useEffect` subscribing to `postgres_changes` (`event: '*'`, `schema: 'public'`,
  `table: 'prayer_requests'`) via `supabaseBrowser.createClient()`, channel name
  `prayer-wall:public:prayer_requests`. Channel logic hoisted into `setupChannel()` so the hook
  body stays lean; handlers read fresh values through refs (`prayersRef`, `activityRef`) because the
  subscription never re-mounts.
- Event handling (all rows go through the shared `parsePrayerRow` — now **exported** from
  `prayers.ts` so fetch and realtime normalise identically):
  - INSERT → prepend only `is_public` prayers; **duplicate guard** both against the current list
    (ref read) AND inside the functional updater (StrictMode-safe); non-public rows are dropped.
  - UPDATE → patch `intercession_count` / `is_answered` / `answered_note` in place on the matching
    card; a row turning non-public is removed; a private→public row that isn't on the wall is
    prepended. When the counter actually changed, `onRemoteActivity(requestId)` fires.
  - DELETE → removed by `payload.old.id` (empty id = no-op).
- **Teardown / leak safety**: cleanup returns `client.removeChannel(channel)` (unsubscribe +
  server-side teardown), covering unmount and React StrictMode double-mount.
- **Guest/offline resilience**: `createClient()` wrapped in try/catch — missing/malformed Supabase
  env vars degrade to status `unavailable` (never throws); `SUBSCRIBED` → `live`,
  `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED` → `unavailable`. Return type
  `PrayerRealtimeStatus = 'connecting' | 'live' | 'unavailable'`. GOTCHA: the new
  `react-hooks/set-state-in-effect` rule flagged a synchronous `setStatus` inside the effect's
  catch — deferred with `queueMicrotask(() => setStatus('unavailable'))` to satisfy it.
- **Component wiring** (`src/app/components/PrayerWall.tsx`): hook receives
  `prayers ?? []`, a `updatePrayerList` wrapper (no-ops while the list is `null` — initial fetch
  replaces the list wholesale anyway), and `handleRemoteActivity` which (a) sets `remotePulseId` to
  run the existing 700ms gold `prayer-pulse` on the card's **counter badge** (the `aria-live`
  tabular-nums span, cleared on `onAnimationEnd` — the local "I Prayed" button pulse is untouched)
  and (b) **clears that card's `optimisticCounts` override** so the counter shows server truth once
  any realtime bump (including the visitor's own, which arrives as its own UPDATE) lands. UI: a
  "Live" gold-dot pill (`bg-pill`/`border-gold/40`, `animate-pulse` dot) appears next to the count
  line only while the channel is `live`; connecting/unavailable renders nothing extra (silent
  degradation, wall still works off the last fetch).
- Test results - Tier 1: `npx tsc --noEmit` exit 0. Tier 2: `npm run lint` exit 0 (after the
  queueMicrotask fix). Tier 3: `npm run build` exit 0, compiled successfully, zero
  warnings/errors, 4/4 pages prerendered, `ƒ Proxy (Middleware)` registered.
- Runtime note: live verification against a real second client was not possible in this
  environment — the Supabase project must have realtime enabled for `prayer_requests`
  (Dashboard → Database → Replication → add to `supabase_realtime` publication) and the Task-4 RLS
  (anon SELECT on `is_public = true`) applies to realtime frames too; until both are confirmed the
  hook degrades to `unavailable` and the wall keeps rendering from `getPrayerRequests`.
- Files touched: new `src/lib/usePrayerRealtime.ts`; edited `src/lib/prayers.ts` (exported
  `parsePrayerRow` + header doc), `src/app/components/PrayerWall.tsx`. No schema or type changes.



## Phase 2 Task 2 — Admin Moderation Deck (2026-09-17)
- Shipped: `src/lib/moderation.ts` (moderator-gated data layer: `getModerationAccess`,
  `getPendingGatherings`, atomic `moderateGathering` RPC, `getModeratedPrayers`,
  `setPrayerVisibility`, `deletePrayerRequest`), `src/app/admin/page.tsx` (Moderation Deck:
  access-gated shell, accessible tabs, gathering review cards, prayer oversight panel with
  hide/publish + confirm-guarded spam removal), `/admin` entry pill on the homepage nav, and
  `supabase/migrations/202609170001_admin_moderation.sql` (community_moderators allowlist table,
  `can_moderate()` security-definer check, restrictive submission-read policies, prayer oversight
  policies, partial queue index, transactional `moderate_gathering(uuid, text)` RPC that validates
  payload completeness + lat/lng ranges and publishes a PostGIS point in one transaction).
- Design: Warm Linen Ivory canvas, white cards on Sand borders, `#C5A880` gold approve action with
  `#B49770` hover, subtle destructive reject/remove styling; reduced-risk href-free focus rings.
- TDD (tests/moderation.test.mjs, node:test + ts.transpileModule + vm sandbox — no new deps):
  10 tests covering denied-access table isolation, missing-config fail-closed, queue filter/order,
  failure-vs-empty separation, one-atomic-RPC moderation contract, invalid-action and stale-RPC
  rejection, oversight including hidden prayers with 50-row bound, and zero-row mutation detection
  (visibility + delete). RED first (4 failures), then GREEN 10/10.
- Quality gates: `npx tsc --noEmit` exit 0; `npm run lint` exit 0; `npm run build` exit 0; smoke
  test: production server returns 200 for `/` (admin pill present) and `/admin` (access-check shell).
- Blocked on live data: no moderator allowlist exists and no DB-management connection is
  available, so the allowlist seeding, live approve/reject against real rows, and RPC application
  must be executed by an administrator (apply the migration, insert the moderator's
  `community_moderators` row, then retry this deck against the live project).

## Phase 2 Task 3.1 — 3D Globe Math Foundation & Privacy-Preserving Gathering Centroid Layer (2026-09-17)
- **Shipped — `src/lib/globe.ts`** (new, pure/dependency-free, no `window`/`THREE` at module scope so
  it is RSC-, browser- and `node:test`-safe):
  - `latLngToVector3(lat, lng, radius = 100)` — right-handed Y-up convention: **+Y = North Pole,
    Equator in the X/Z plane, Prime Meridian (0°,0°) on +Z, eastward longitude (90°E → +X, 180° → −Z)**.
    Documented gotcha: a textured `THREE.SphereGeometry` must be rotated −90° about Y (or its
    equirectangular 0° column laid on +Z) to line up with these markers.
  - `calculateGreatCircleSpline(p1, p2, altitude = 1.25, pointsCount = 30)` — slerp control points
    along the shortest great circle, lifted by a **sine arch** (exactly radius 100 at both endpoints,
    peak `100 × altitude` at the midpoint) for intercession beams; coincident pairs reuse the start
    direction and **antipodal pairs use a Rodrigues rotation** about an orthogonal axis so no NaN
    geometry is ever produced.
  - `sanitizeToCentroidWithJitter(lat, lng, seedString)` — **FNV-1a 32-bit hash of the row id**
    split into two 16-bit halves mapped to ±`MAX_CENTROID_JITTER_DEGREES` (0.015°) per axis, rounded
    to 6dp; deterministic across renders/processes and always within ~2.4km of the true point.
    Exports `GLOBE_BASE_RADIUS = 100` and `MAX_CENTROID_JITTER_DEGREES = 0.015`.
- **Schema** — `GlobeMarker { id, city, first_name, member_count, lat, lng }` added to
  `src/lib/types.ts` under a Phase 2 header (the payload is deliberately minimal).
- **Data layer — `getPublicGatheringMarkers()` in `src/lib/gatherings.ts`** (existing private EWKB/
  GeoJSON/WKT/named-column parser reused via `extractCoordinates`, so PostGIS geography and fallback
  `latitude`/`longitude` columns both work):
  - Read is **bounded** (`limit 500`) and newest-first; a `status = 'approved'` filter is attempted
    first, then **falls back to an unfiltered read** because the deployed `gatherings` table has no
    `status` column (a hard `.eq('status', …)` would break PostgREST with 42703). Rows that do carry
    a non-`approved` status are still dropped client-side.
  - Privacy stripping: only `id`, `city`, `first_name`, `member_count` and jittered `lat`/`lng` leave
    the function. `first_name` strips honorifics/surnames from `leader_name`; `city` prefers an
    explicit `city` column and otherwise only takes comma-separated segments **after** the street line,
    rejecting any candidate that still contains digits (so `1234 Secret Street` or a no-comma address
    can never leak); `member_count` falls back to 1. Street address, description, email, meeting time
    and full name are never included.
  - Contract: `{ ok: true, data: GlobeMarker[] }` or `{ ok: false, data: [], error }` — never throws
    (missing config, read errors and unparseable rows are all contained).
- **TDD (`tests/globe.test.mjs`, node:test + `ts.transpileModule` + `vm` sandbox, no new deps)**:
  RED first (13 failures: file/module absent, then `getPublicGatheringMarkers is not a function`),
  then GREEN **18/18**. Covers equator/pole/prime-meridian/antimeridian Vector3 projection (exact
  `30°N → y = 50, z = 86.6025…`), radius default, out-of-range/NaN input, arc altitude scaling
  (peak exactly 125 / 150 with a midpoint sample), equatorial arc staying in-plane, custom point
  count, coincident + antipodal safety, jitter determinism/bounds/`< 3km` haversine across 6 global
  sites, marker key whitelist, zero-address/full-name leak, EWKB + fallback columns + GeoJSON + WKT
  resolution, status/`member_count` gating, bounded query contract, status-column fallback, and both
  failure paths. **Realm gotcha**: `assert/strict` `deepEqual` fails on values created inside a
  `vm` context ("same structure but not reference-equal") — compare via a `plain()`
  `JSON.parse(JSON.stringify(...))` copy or primitives/`.length`.
- Quality gates: `node tests/globe.test.mjs` **18/18 exit 0**; `npx tsc --noEmit` exit 0;
  `npm run lint` exit 0 (zero warnings); `npm run build` exit 0 (compiled, 5/5 pages prerendered,
  `ƒ Proxy (Middleware)` registered).
- Files touched: new `src/lib/globe.ts`, new `tests/globe.test.mjs`; edited `src/lib/types.ts`,
  `src/lib/gatherings.ts`. No component/UI wiring yet (the WebGL globe component is a later task);
  `getPublicGatheringMarkers()` is currently unused by any route.

## Phase 2 Task 3.2 — Interactive 3D WebGL Globe Canvas & Billboard Avatar Marker Pipeline (2026-09-17)
- **Shipped**: `public/assets/avatars/*.svg` (6 storybook colourways), `src/lib/globeCamera.ts` (pure
  orbit/zoom/marker maths), `src/lib/globeAvatars.ts` (pure avatar catalog),
  `src/app/components/globe/globeScene.ts` (three.js engine),
  `src/app/components/globe/MissionGlobe.tsx` (React boundary + accessible roster), `GlobeIcon` in
  `src/app/components/icons.tsx`, `tests/globeScene.test.mjs`, plus homepage wiring
  (`#mission-globe-section` + "Mission Globe" nav pill + hero blurb + print isolation in
  `globals.css`).
- **SSR isolation (critical Next 16 finding)**: `ssr: false` is **not allowed** with `next/dynamic` in a
  Server Component (see `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`), so the engine is
  loaded with `await import('./globeScene')` **inside a client `useEffect`**. Verified: `.next/server`
  contains **no** `WEBGLRenderer`, while the scene lands in a lazy client chunk
  (`.next/static/chunks/*.js` holding `vViewDirection` / `webglcontextlost` / `gl_FragColor`). The
  server-prerendered HTML is the ivory card + `role="status"` skeleton + the storybook roster.
- **DPR clamp** at mount **and** on every resize (`Math.min(window.devicePixelRatio || 1, 2)`).
- **Teardown** (`dispose()`): cancels the RAF, disconnects the `ResizeObserver`, removes all six canvas
  listeners, disposes every registered geometry/material/texture (Set registries **plus** a
  `scene.traverse` sweep and `TEXTURE_MAP_KEYS` map introspection as belt-and-braces), clears the caches,
  `scene.clear()`, `renderer.dispose()`, `forceContextLoss()`, and removes the canvas from the DOM.
  `dispose()` is idempotent. Deferred async work (SVG avatar decode, `document.fonts.ready` label
  repaint) checks the `disposed` flag before touching GPU state.
- **Earth**: radius 100, `MeshStandardMaterial` (roughness 0.94) over a **procedurally painted 2048×1024
  equirectangular parchment canvas** (warm-linen base, pole→equator banding, 15° graticule, gold equator
  and prime meridian, stylised softened landmasses — decorative, not cartographic). Lighting = ambient +
  hemisphere + warm key + gold rim light. **Texture orientation derived from three's source**:
  `SphereGeometry` sets `uvs.push(u + uOffset, 1 - v)` with `vertex.x = -ringRadius * cos(phi)`, so a
  standard equirectangular canvas needs `earth.rotation.y = -Math.PI / 2` for 0° longitude to land on +Z
  (matching `latLngToVector3`) — the exact counterpart of the note in `src/lib/globe.ts`.
- **Atmosphere**: a separate shell at `radius × 1.05` with a custom `ShaderMaterial` Fresnel rim
  (`pow(1 - |dot(normalView, viewDir)|, 2.6)`), gold, `AdditiveBlending`, `depthWrite: false`. GLSL1
  (`varying` / `gl_FragColor`) is fine on WebGL2 because three patches the shader preamble.
- **Billboard avatars**: `THREE.Sprite` + `SpriteMaterial({ sizeAttenuation: true, depthWrite: false,
  toneMapped: false })`, positioned along the **surface normal** at `radius + 4.2`; sprites face the
  camera by construction (that *is* the billboard). Plus a tangent shadow pedestal (`RingGeometry` +
  quaternion from +Z→normal), a gold stem (`CylinderGeometry`, +Y→normal) and a first-name pill sprite
  whose canvas aspect exactly matches its world scale. One texture per avatar style, shared by every
  gathering wearing it; per-marker sprite materials carry the horizon fade (`markerHorizonOpacity`, floor
  0.25). `markerScaleForDistance` compensates camera distance (0.88 at zoom 130 → 1.0 at 260 → 1.55 at
  400) on top of natural perspective attenuation. A single shared additive ring pulses on the selected
  marker (disabled under `prefers-reduced-motion`).
- **Controls**: damped orbit drag (`applyOrbitDrag`, pitch clamped 0.22…π−0.22 so the camera can never
  flip), pinch via a pointer-map span ratio, wheel zoom with a ±600 delta bound, **zoom bounded to
  130–400**, arrow keys / `+` / `−` / `Escape` via React → handle, a "Reset view" button, and a slow idle
  drift that resumes 2.6s after the last interaction (disabled under `prefers-reduced-motion`).
- **Raycasting**: `Raycaster` + `setFromCamera` against the sprite hit targets; `pointerup` only selects
  when total travel ≤ `CLICK_SLOP_PX` (6px), so a drag never selects. Hover changes the cursor and
  emphasises the label. `onSelectMarker(marker | null)` fires from taps only; the accessible roster and
  buttons drive `handle.selectMarker()` **without** re-notifying, so there is no feedback loop.
- **Avatars / zero broken images**: each sprite texture starts as a **procedural canvas badge** and is
  only replaced if the SVG decodes, so a 404/blocked/corrupt asset can never render as a broken image.
  Every catalogued SVG is self-contained (no `<image>`, no `xlink:href`, no remote refs, fixed
  width/height) and is asserted on disk by the test suite. **No `<img>` tags** in the component — the
  roster uses CSS `background-image` swatches, which also dodges the `@next/next/no-img-element` lint
  warning (`next/image` would have needed `dangerouslyAllowSVG`).
- **TDD (`tests/globeScene.test.mjs`, node:test + `ts.transpileModule` + `vm`, no new deps)**: RED first
  (15 failures, modules + assets absent), then GREEN **15/15** — zoom bounds (130/400/NaN→260), pitch
  clamp, damping (monotonic, no overshoot, dt=0 no-op), `stepOrbit` bounds, drag signs and no-flip,
  `orbitToPosition` axis agreement, opening-view framing (Austin cluster theta ≈ −97.74° in radians,
  empty → documented fallback), marker scale 0.88/1.0/1.55, horizon fade floor, wheel/pinch clamps, tap
  vs drag slop, label-width bounds, ≥4 unique avatar styles with valid hex colourways, on-disk SVG
  validation, deterministic + well-distributed assignment over 240 seeds, and name normalisation. One
  assertion was corrected during GREEN: λ=9 over 1s settles to 99.88%, so "almost settled" is 0.002.
- **Quality gates**: `npx tsc --noEmit` exit 0; `npm run lint` exit 0 (**zero warnings**);
  `npm run build` exit 0 (zero warnings/errors, 5/5 pages prerendered, `ƒ Proxy (Middleware)`);
  `node tests/globeScene.test.mjs` **15/15**; `node tests/globe.test.mjs` **18/18** (no regression).
- **Runtime smoke test** (`npx next start -p 3123` + curl): `/` HTTP 200, both spot-checked avatar SVGs
  HTTP 200, HTML carries `#mission-globe-section` (4×), the "Preparing the mission globe…" skeleton (1×),
  the "Gatherings on the globe" roster (1×) and **3 live `/assets/avatars/` swatches**, server log clean.
- **Live-schema confirmation**: the build log printed `Status-filtered gathering read failed, retrying
  without the filter: column gatherings.status does not exist`, proving the Task 3.1 two-tier read fires
  against the real database and still yields the 3 seeded Austin markers.
- Limitations: SVG→canvas rasterisation cannot be GPU-verified headlessly (the procedural badge is the
  in-code fallback); landmasses are stylised, not cartographic; transparent-object sort order is
  approximate (sprites vs the additive atmosphere); `prefers-reduced-motion` disables only the idle drift
  and the selection pulse.
- Files touched: new `public/assets/avatars/avatar-{grace-sage,micah-gold,naomi-terracotta,elias-slate,
  zuri-plum,samuel-olive}.svg`, `src/lib/globeCamera.ts`, `src/lib/globeAvatars.ts`,
  `src/app/components/globe/globeScene.ts`, `src/app/components/globe/MissionGlobe.tsx`,
  `tests/globeScene.test.mjs`; edited `src/lib/globe.ts` (exported `stableHashSeed` for the deterministic
  avatar picker), `src/app/components/icons.tsx` (+`GlobeIcon`), `src/app/page.tsx`, `src/app/globals.css`.
  No `src/lib/types.ts` changes (`GlobeMarker` from Task 3.1 was reused as-is).
## PHASE 4 - Sprint 1: Resilient Supabase Schema Contract (`gatherings.status`) - COMPLETE (2026-09-18)
- Root cause: `gatherings` has **no `status` column** - `supabase/migrations/202609170001_admin_moderation.sql` keeps moderation state on `gathering_submissions` (partial index `where status = 'pending'`; `moderate_gathering()` updates that table) and reserves `gatherings` for already-approved rows. The speculative `.eq('status', 'approved')` probe therefore failed with SQLSTATE 42703 on every read, firing an unconditional `console.warn` that surfaced as `column gatherings.status does not exist` during static prerender.
- Fix (`src/lib/gatherings.ts`): `isMissingColumnError()` matches SQLSTATE `42703` **and** the message form; `statusColumnSupport: 'unknown' | 'supported' | 'absent'` probes the column at most once per process and caches the verdict silently, so the now-expected schema difference produces no log noise while genuine read failures still warn. The unfiltered fallback cannot publish a non-approved row because `parsePublicMarkerRow` re-checks any returned `status`. `console` is injectable in the test harness (defaults to the real one).
- Production pipeline: `src/app/page.tsx` -> `getPublicGatheringMarkers()` -> `<MissionGlobe markers={...} />`. A temporary live probe against real Supabase returned `ok=true rows=3` (sample `{city: Austin, first_name: Marcus, member_count: 1}`, no address/email/leader_name) with **0 captured console messages**. Failures degrade to MissionGlobe's empty state - zero UI breakage. No hardcoded mock markers exist in the globe path.
- Results: `tests/globe.test.mjs` +3 regression tests (RED: 2 failures proven before the fix; GREEN: 0) -> **51/51 tests passing**; `npx tsc --noEmit` exit 0; `npm run lint` exit 0; clean `rm -rf .next && npm run build` exit 0 with **0 occurrences** of the status warning in the log.

## PHASE 4 - Sprint 2: Dynamic Multi-Cluster Aggregation - COMPLETE (2026-09-18)
- Delivered (`src/lib/globeCamera.ts`): the static 3-marker fan was replaced by dynamic N-marker geographic clustering. `markerGroundDistance()` partitions the payload by angular proximity (`MARKER_JITTER_CLUSTER_DEGREES = 0.75` around a running geographic mean) and `groupMarkerClusters()` returns each cluster's centroid, formation geometry and summary copy.
- Formations are regular spherical polygons: a **line for 2** (`MARKER_PAIR_LINE_DEGREES`), a **triangle for 3** (`MARKER_CLUSTER_FAN_RADIUS_DEGREES = 3.8`), and a **uniform circle for 4+** with an adaptive radius (`clusterFanRadiusDegrees()` = `clamp(max(minChordRadius, 3.8), 0, 9)` derived from `chord = 2R*sin(pi/N)`), so a growing cluster widens rather than crowding. Slot angles are exactly `phase + slot*2pi/N` (`clusterDistributionAngles()`), phase set by the lead id's FNV-1a hash - deterministic under any payload reshuffle.
- Aggregation ramp: `clusterAggregationForDistance()` smoothsteps across `CLUSTER_AGGREGATE_NEAR_DISTANCE = 205` -> `CLUSTER_AGGREGATE_FAR_DISTANCE = 255`, deliberately bracketing the default framing (260 -> fully aggregated summary pills) and the selection fly-to (190 -> fully fanned individuals). `clusterLayerOpacities()` splits the blend per layer (name tags fade first, avatars second, summary pill last) so the handover is a dissolve rather than two overlapping labels.
- Renderer (`globeScene.ts`): every marker carries `fannedPosition` (its polygon slot) and `clusterPosition` (the cluster centroid), interpolated per frame by `updateMarkers()`. One aggregated summary pill per cluster of 2+ is owned by the lead member, anchored at the centroid, hidden in the fanned view, and pushed into `pickables` so clicking it selects the lead - which flies to the centroid and unfolds the formation through the **existing** selection path (ground disc + gold badge stroke included, no special-casing).
- Two-line measurement fix (a real defect the new tests caught): the summary pill does not draw one wide banner. `clusterPillLines()` splits it into a bold city headline plus a muted `N Gatherings` subline and `clusterPillWidth()` measures the **widest line** - `"San Antonio * 12 Gatherings"` was 30 chars x 1.5 = 45 units against a 34-unit cap. `clusterSummaryLabel()` remains the single-line accessible name.
- Results: **56/56** tests passing (up from 51; +5 Sprint 2 tests covering proximity partitioning, geographic-mean centroid, uniform `2pi/N` spacing, adaptive radius clamping, ramp/opacity handover, and two-line width measurement); `npx tsc --noEmit` exit 0; `npm run lint` exit 0; `npm run build` exit 0.

## PHASE 4 - Sprint 3: Global Search & Location Autocomplete - COMPLETE (2026-09-18)
- Goal: a frosted-glass global search overlay for the mission globe - `Cmd+K`/`Ctrl+K` focuses, `Escape` closes, arrow keys navigate - searching across ambassador first name, city and gathering count, with a selection routed through the globe's existing `selectMarker(id)` pipeline so the camera flies in and any cluster unfolds smoothly.
- Placement: mounted in the HUD's **left cluster** (after the status badges, inside a `pointer-events-auto` wrapper on the otherwise pointer-events-none HUD bar), so it can never obstruct the top-right zoom controls, centred interaction hint, or bottom-left docked ambassador card.
- Design tokens per `.cline/skills/ui-ux-pro-max` / Refero parity: `backdrop-blur-md bg-white/10 border border-white/15 text-white placeholder-white/50`; trigger exposes `aria-haspopup="listbox"` + `aria-expanded`, the popover uses a real `role="listbox"` with `role="option"` children and `aria-selected` (a combobox wrapper was deliberately NOT used - it would have re-introduced the `aria-expanded`-on-textbox violation that jsx-a11y correctly flags).
- Integration: a selection routes through `sceneRef.current.selectMarker(id)` + `setSelectedId(id)` - the exact pipeline of a direct tap (fly-to the cluster centroid at distance 190, inside the 205 fan-out window, so clusters unfold on arrival); the input's Escape handler stops propagation so closing search never deselects the current ambassador.
- Implementation: new `src/app/components/globe/GlobeSearch.tsx` (debounced query, avatar swatches from the existing catalog, count column, status footer) + new `src/lib/globeSearch.ts` (pure search core: accent-folded token matching across name/city/count, deterministic ranking, bounded results, selection wrap/clamp maths, copy formatters).
- Results: **85/85** tests passing (56 -> 85; +29 in `tests/globeSearch.test.mjs` covering fold/tokenise/index/query filtering, case-insensitivity across all three fields, empty-state handling, selection wrap/clamp, and copy formatters); `npx tsc --noEmit` exit 0; `npm run lint` exit 0 (**0 warnings**); `npm run build` exit 0 (**0 warning lines**, clean `rm -rf .next` rebuild, 5/5 prerendered).
- Gotchas recorded for future HUD work: `aria-expanded` is invalid on the implicit `textbox` role; a literal `\u2318` escape inside JSX text renders verbatim (use the real glyph); prettier/edit-tool whitespace slips on generated components must be re-verified with the parser before claiming completion.

## PHASE 4 - Sprint 4: Ambassador Card Engagement & Production Hardening - COMPLETE (2026-09-19)
- Goal: engagement actions on the docked ambassador card — a "Connect" primary action opening an accessible connection modal (focus trap, Escape/backdrop close, focus restore) and a "Share" secondary action (Web Share API with clean `AbortError` handling, clipboard fallback to `window.location.origin + '?gathering=' + encodeURIComponent(marker.id)` with a temporary "Copied!" badge, graceful clipboard-denial degradation) — plus deep-link initialization (`?gathering=` selects the marker and flies the camera to its centroid through the existing selection pipeline), mobile safe-area padding on the docked card, and live `prefers-reduced-motion` honoring for camera lerp + HUD without rebuilding the WebGL context.
- Scene change (`globeScene.ts`): `reducedMotion` is now a mutable closure variable exposed through a new `GlobeSceneHandle.setReducedMotion(boolean)`; the per-frame orbit update snaps `current` straight onto the pre-clamped `target` pose instead of exponential damping when reduced motion is on (targets are clamped at every write site: `nudgeOrbit`/`nudgeZoom`/`flyToMarker`/`initialOrbitForMarkers`).
- Component change (`MissionGlobe.tsx`): share pipeline (`navigator.share` → clipboard fallback; `AbortError` treated as a deliberate no-op; clipboard denial shows "Copy blocked — copy the link from the address bar." via an `aria-live` status region; notice timer cleaned up on unmount); connect dialog with `role="dialog"`/`aria-modal`, Tab-cycle focus trap, Escape `stopPropagation` (closes the dialog without deselecting the ambassador, per the Sprint 3 gotcha), backdrop-click close, and focus restore to the invoking Connect button; deep-link effect compares `?gathering=` only against server-provided marker ids (never rendered/trusted) with a `selectedIdRef` replay in the boot `.then` so selections made before the async WebGL boot still fly; docked card gains `pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]`; all new controls are `min-h-11` (44px) with `motion-reduce:transition-none`.
- Deep-link note (lint-driven design change): the first draft resolved the deep link in a synchronous effect (`react-hooks/set-state-in-effect` error). Final design resolves it inside the async scene-boot callback via the pure module helper `readDeepLinkGatheringId(markers)` (SSR-safe, strict-match against marker ids, `deepLinkAppliedRef` once-guard so later marker refetches never re-steal the user's selection).
- Results: **85/85** tests passing; `npx tsc --noEmit` exit 0; `npm run lint` exit 0 (0 warnings); `npm run build` exit 0 (compiled + TypeScript + 5/5 static pages, `ƒ Proxy (Middleware)`); privacy sweep greps clean (no `data-lat`/`data-lng`/`{selected.lat}`-style DOM leaks, no `console.*`, no `any`/`@ts-ignore` in the touched globe files).
- Deep-link viewport scroll (follow-up): a valid `?gathering={id}` now also scrolls the globe into view — `document.getElementById('mission-globe') ?? containerRef.current` → `scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' })` inside the boot callback (reduced motion skips the smooth glide); the component root carries `id="mission-globe"` so `/#mission-globe` anchor links navigate straight to the globe. Verified after the change: tsc/lint/tests all exit 0 (85/85).
- Avatar gender/name alignment (follow-up): root cause of Sarah-wearing-male / Marcus-and-David-wearing-female was `avatarVariantForMarker(id, role)` in `globeCamera.ts` falling back to the gender-blind FNV-1a id hash (`avatarSpriteVariantForId`) whenever no role keyword matched. Fix: extended the signature to `(id, role, firstName?)` with curated exact-match name sets (`FEMALE_NAME_CUES` / `MALE_NAME_CUES`, normalised trim+lowercase, no substring matching so "Sandra" ≠ "Sarah") layered above the hash fallback. Precedence: clergy role → pastor sheet **unless** a known female name (pastor sheet is male-coded — female clergy wears the female sheet); clergy still outranks youth when both keyword groups appear in one title (pre-existing invariant, briefly regressed mid-fix and caught by the suite); kid roles → kid sheet (gender-ambiguous); known female/male names → female/male sheet; unknown names → stable id hash. Scene call site now passes `marker.first_name`. 9 new RED-first regression assertions in `tests/globeScene.test.mjs` (incl. hash-contradiction fixtures: gathering-1 hashes to 0 but "Sarah" → 1; gathering-2 hashes to 1 but "Marcus" → 0). Gates after fix: tsc 0, lint 0, 85/85 tests.

## PHASE 5 - Production Expansion
## Milestone A: Live Host Connect Workflow & Form Experience - ACTIVE (2026-09-19)
- **Data layer** (`src/lib/gatherings.ts`, patterns per the existing fail-closed read layer): new strict types `GatheringInquiryPayload` / `GatheringInquiryResult` in `src/lib/types.ts` (Phase 5 section, deterministic-schema rule: `message` empty string, never undefined); `validateGatheringInquiryInput({name, contact, message})` returns field-scoped error copy (name required; contact must be a plausible email `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` or ≥7 digits for WhatsApp; message optional but ≥10 chars when present); `submitGatheringInquiry(payload)` inserts a **visitor-data-only row** `{gathering_id, visitor_name, contact, message|null}` into `gathering_inquiries` with trims + length caps (80/120/1000). **Fail-open**: missing remote table (Postgres `42P01` or PostgREST `PGRST205`, plus message heuristics) resolves `{ok:true, delivered:'simulated'}` so the visitor flow completes before the schema ships; genuine failures (RLS/network) resolve `{ok:false, error}` and never throw. **Privacy Lens**: the host's private email/phone is resolved host-side and never appears in the payload, a returned row, or a log line (only the server error message is logged — asserted by test).
- **Form modal** (`MissionGlobe.tsx`): the Connect dialog is now a full inquiry form — Name (required) / Email or WhatsApp (required) / Message (optional) with visible `<label>`s, `aria-required`, `aria-invalid` (rose border via `aria-[invalid=true]`), and `aria-describedby`-linked `id="…-error"` paragraphs; focus moves into the first input on mount (falls back to first focusable when the success card shows); the existing Tab-cycle focus trap covers inputs/textarea; validation failure focuses the first invalid field, and field errors clear as the visitor types (tactile). Submit is a primary pill with a `motion-reduce:animate-none` spinner, `disabled` while submitting, and `active:scale-[0.98]` press feedback (all new controls ≥44px via `min-h-11`). Success state: `role="status"` confirmation card — "Inquiry sent to {FirstName}! They will reach out to welcome you." — with a Done button and 4-second auto-dismiss that closes through `closeConnectModal()` so focus restores to the Connect trigger; an in-flight submission that outlives the dialog is discarded via `connectOpenRef` (no late setState). Form state resets on every open (event-handler setState, not in an effect body — the `react-hooks/set-state-in-effect` rule from Sprint 4 still applies).
- Tests: harness `setupGatherings` extended with an `insert` method on the Supabase double; 7 RED-first tests in `tests/globe.test.mjs` (strict privacy-safe insert payload, `42P01` + `PGRST205` fail-open, local rejection of 5 invalid payloads with zero network calls, empty-message → null + 1000-char bound, genuine failure surfaces error/never throws/never logs visitor contact, field-scoped validation copy). Suite now **92/92**.
- Results: `npx tsc --noEmit` exit 0; `npm run lint` exit 0 (0 warnings); `npm run build` exit 0 (5/5 static pages, `ƒ Proxy (Middleware)`); `node --test tests/*.test.mjs` exit 0 (**92/92**).
- **Design primitives** (`src/components/ui/`): `button.tsx`, `input.tsx`, `dialog.tsx`, `badge.tsx` are compiler-verified (tsc/lint/build all exit 0 with them consumed by `MissionGlobe.tsx`) and ready for consumption across the app. Tokens match the Phase 6 warm-linen palette: canvas `#FAF7EE`, border `#EDE7D9`, primary text `#2D261E`, muted text `#786F66`, accent `#D4A359` (Button primary is ink-on-linen `#2D261E`→`#FAF7EE`; `dialog.tsx` was extended with optional `ariaLabelledBy`/`ariaDescribedBy` props — backward-compatible pass-throughs to the `role="dialog"` element).
- **Modal refactor (primitives)**: the Connect dialog now composes the primitives instead of raw markup — `Dialog`/`DialogClose` (spring entrance via framer-motion, Escape + backdrop close handled by the primitive; our Tab-cycle trap, focus-into-first-input, and focus-restore-to-trigger preserved via the inner wrapper that keeps `modalRef`), `Input` (Name + Contact, `error` prop drives the red border; aria-required/aria-invalid/aria-describedby intact), `Button` (`glass` variant for the HUD-card Connect/Share triggers, `primary` for Send/Done, `secondary` for Copy link — all ≥44px via the primitive's size styles), and `Badge variant="gold" size="sm"` for the member count. The message textarea keeps a matching hand-rolled warm token class (`INQUIRY_TEXTAREA_CLASS`) since the primitive covers inputs only. The full palette sweep of the dialog block is clean: zero `slate-/cyan-/rose-/white/12/bg-black` classes — warm linen tokens only (`#FAF7EE`/`#EDE7D9`/`#2D261E`/`#786F66`/`#D4A359`/`#8F6522`); the docked HUD card outside the dialog intentionally keeps the dark glass HUD language.
- Results (fresh, post-refactor): `npx tsc --noEmit` exit 0 (0 diagnostics); `npm run lint` exit 0 (0 warnings); `npm run build` exit 0 (5/5 static pages, `ƒ Proxy (Middleware)`); `node --test tests/*.test.mjs` exit 0 (**92/92**).
- Open production work: create the `gathering_inquiries` table + RLS (anon INSERT only, no SELECT) and the host-side delivery workflow (email/WhatsApp fan-out) — until then the pipeline fails open with simulated success by design.

## MODULE 1 OVERHAUL - Layers-style Morning Altar, Daily Reflection & Audio Player (2026-09-21)
- **Scope**: complete Layers-style visual + interaction overhaul of `src/app/components/DailyReflection.tsx` and `src/app/components/AudioPlayer.tsx` (Module 1 only; props contracts unchanged - `DailyReflection({reflection: Reflection | null})`, `AudioPlayer({src, title?})` still instantiated identically in `src/app/page.tsx`).
- **AudioPlayer**: frosted glass card (`border-white/80 bg-white/70 backdrop-blur-xl shadow-md rounded-2xl`, `focus-visible` gold ring); spring play/pause transport (`whileTap scale 0.95`, h-12, gold with ring highlight + disabled-safe); 32-bar animated waveform visualizer with **deterministic** heights (pure sine/cosine of bar index - never `Math.random()`, so SSR/first render match) that pulse via staggered infinite scaleY springs while playing and settle via spring when paused, with played/unplayed gold/sand split; custom scrub track (sand rail, gold gradient fill, hover thumb indicator, - **Scope**: complete Layers-style visual + interaction overhaul of `src/app/components/DailyRar- **AudioPlayer**: frosted glass card (`border-white/80 bg-white/70 backdrop-blur-xl shadow-md rounded-2xl`, `focus-visible` gold ring); spring play/pause transport (`whileTap scale 0.95`, h-12, gold with ring highlight + disabled-safe); 32-bar animated waveform visualizer with **deterministic** heights (pure sine/cosine of bacurrentTarget` so inner buttons/slider keep native behavior).
- **Playback architecture preserved verbatim**: no `src` attribute on `<audio>`; two `<source>` candidates (normalized primary + guaranteed `/audio/daily-reflection.mp3` last); `resolveAudioSrc`/Ogg-swap logic; ref-callback hydration race sync; multi-candidate error handling + Retry notice; `cycleSpeed` replaced by direct `setSpeed(index)`.
- **DailyReflection**: `MotionConfig reducedMotion="user"` wrapper (both components); atmospheric radial backlight glow (`radial-gradient(ellipse at 50% 0%, rgba(194,155,56,0.12), transparent 70%)`, blur-3xl, `-z-10`); multi-layer glass container (`rounded-[2.25rem] border-white/80 bg-white/75 backdrop-blur-2xl` + inset ring highlight + layered warm shadow) matching the PulpitKit Layers language; lift-on-hover Daily Bread pill; editorial **serif** title + serif italic scripture anchor (gold quote glyph, gold left rule, pill figure panel) per task directive; glass empty state; **new Reflective Examen section**: 3 p- **Playback architecture preserved verbatim**: no `src` ant- **DailyReflection**: `MotionConfig reducedMotion="user"` wrapper (both components); atmospheric radial backlight glow (`radial-gradient(ellipse at 50% 0%, rgba(194,155,56,0.12), transparent 70%)`, blur-3xl, `-z-10`); multi-layer glass container (`rounded-[2.25rem] border-white/80 bg-white/75 backdrop-blur-2xl` + inset ring highlight + lan-examen:v1`, keyed by reflection date, mount-gated async load - no hydration mismatch, corrupt/quota-safe); footer progress line (`aria-live`) + tactile **Copy Reflection** button (clipboard API with `execCommand` fallback, "Copied!" gold feedback for 2s, sr-only `role="status"` announcement).
- Results: `npx tsc --noEmit` exit 0; `npm run lint` exit 0 (0 warnings, 0 unescaped-entity issues); `npm run build` exit 0 (5/5 pages prerendered); `git status -s` shows exactly `AudioPlayer.tsx` + `DailyReflection.tsx` modified. Prerendered HTML verified: 32 waveform bars, glass container + radial glow, Examen headers, `aria-expanded` prompt buttons, player group scrub aria, `<audio preload="metadata" class="hidden">` with two bundled-MP3 `<source>` candidates and zero `<audio controls>`. `next start` runtime check: HTTP 200 with all new markup.

## PALETTE C MIGRATION - "Midnight Gethsemane" Design Token Migration (2026-09-21)
- **Scope**: global design-token migration from warm-linen light theme (Palette B) to high-contrast, luminous dark theme "Midnight Gethsemane" (Palette C) so frosted glass (`backdrop-blur-2xl`), specular rings, and ambient glows read sharp and vibrant.
- **Tokens** (`src/app/globals.css`, Tailwind v4 `@theme inline`): `--color-canvas #0A1118` (deep royal lapis), `--color-espresso #F8FAFC` (crisp alabaster ink), `--color-muted #94A3B8` (slate silver, ~7.4:1 on canvas), `--color-sand #1E2E42` (dark slate borders/rails), `--color-gold #F59E0B` (living ember amber), `--color-gold-deep #FBBF24` (ember hover lift — brighter on dark), `--color-pill #101D2B` (frosted maritime glass surface), `--color-pill-ink #E2E8F0` (11.6:1 on pill). `--background/--foreground` mirror canvas/espresso; `body` now binds `var(--color-canvas)` / `var(--color-espresso)` directly.
- **Elevation & luminosity**: `--shadow-soft`/`--shadow-lift` re-tinted to deep lapis near-black `rgba(2,8,18,*)`; `prayer-pulse` and `amen-breath` keyframes re-inked to ember `rgba(245,158,11,*)`; radial backlight glows migrated from washed beige to amber/lapis (`rgba(245,158,11,0.14)` in DailyReflection empty + main states; PulpitKit header gradient `rgba(245,158,11,0.22)` → `rgba(14,31,56,0.5)` → transparent).
- **Surface sweep (dark-mode correctness)**: all light surfaces remapped across `src/app/components/*`, `globe/*`, `page.tsx`, `admin/page.tsx`, `src/components/ui/*` — `bg-white` → `bg-pill` (incl. opacity variants ≥ /50; ≤ /25 white hairline accents kept on already-dark HUD contexts), `border-white/80` → `border-white/10`, `ring-black/[0.04..0.06]` → `ring-white/10`, warm card shadows `rgba(42,37,33,0.07)` → `rgba(2,8,18,0.55)`, modal scrims `bg-espresso/*` → `bg-canvas/*`, `ring-offset-white` → `ring-offset-canvas`, layout spinner `bg-white` → `bg-gold`.
- **Contrast-critical ink pairing**: gold-filled elements flipped from `text-espresso`/`text-white` (white-on-amber ≈ 1.9:1 under Palette C) to `text-canvas` (dark ink on ember ≈ 7:1) — buttons, badges, tabs, number circles, admin retry/notice actions; `gold-deep` hover now `#FBBF24` so hover lifts brighter on dark. Hard-coded hex in `ui/badge|button|input`, `MissionGlobe`, `admin` remapped old→new (e.g. `#D4A359→#F59E0B`, `#F6EFE2→#101D2B`, `#8F6522/#C5A880→#E2E8F0/#F59E0B`).
- **Print isolation preserved**: `@media print` flattens `#pulpit-kit-section` to white paper with almanac-dark `#2D261E` ink (dark canvas no longer prints unreadable); all other sections still hidden in print.
- **Unchanged**: Globe HUD (`globeHud.ts`, `GlobeSearch.tsx`, `globeScene.ts`) was already dark-first (slate/white-hairline glass) and 3D avatar art colors in `globeAvatars.ts` are character art, not UI tokens; PulpitKit `print:bg-white` kept for paper.
- **Results**: `npx tsc --noEmit` exit 0; `npm run lint` exit 0 (zero warnings); `npm run build` exit 0 (routes `/`, `/_not-found`, `/admin` prerendered, middleware intact). Audit greps confirm zero leftover warm-rgba/`bg-white`-light-surface literals and zero gold fills with light ink.

## GRACE-BASED HABIT ENGINE — Identity-First Formation (2026-09-21)
- **New data layer `src/lib/habitEngine.ts`** (guest-first, key `jesusunited:habit-engine:v1`): 4 rhythms (`morning` Morning Consecration/Prayer, `word` Word Anchoring/Scripture, `midday` Midday Breath/Silence & Worship, `community` Communal Intercession/Service) mapped to the cloud-synced `HabitMinutes` keys; store = `{ graceMode, graceSeasons[], days{YYYY-MM-DD→{minutes,completed}} }`; all reads sanitized (corrupt storage → empty), writes quota-safe; helpers `stepRhythmMinutes` (clamped ±5), `toggleRhythmCompleted`, `setGraceMode` (opens a season on enable, closes it on disable — history preserved), `isRestingDay`, `dayFullness`/`dayMinutes` (practised = ≥5 min or consecrated), `weekDatesFor` (Mon–Sun window), `formationLabel` (Fully Formed / Forming / Taking Root / First Steps / Day of Rest), `weekFullness`.
- **AltarOS "Rhythms of Grace" tab rebuilt**: identity heading "A Person Who Walks in Rhythms of Grace" + subtitle "Consistency rooted in His faithfulness, not your performance." (no numeric streaks anywhere); **Grace Season switch** (`role="switch"` + spring thumb, 44px, disabled while engine loads) that freezes counters, shows the warm badge "Rest is Consecration — Grace Mode active. No streaks broken." (`role="status"`, gold halo + radial ember tint), and renders compass days as moon-marked *resting* (fullness 1) instead of missed; **Weekly Formation Compass** (7 conic-gradient day dials, moon glyph for resting days, breathing gold "today" dot, aria-labels naming each date, spring width bar + % of days lived in rhythm); **4 tactile rhythm cards** (spring hover lift, conic progress to the 5-minute "practised" mark, ±5 min steppers + consecration check with gold pulse ring, all frozen/disabled during a Grace Season). Whole panel wrapped in `<MotionConfig reducedMotion="user">`; all motion springs within Refero 400–450/30–35.
- **Dual-write continuity**: rhythm writes persist to the engine mirror AND mirror minutes into the Altar OS cloud layer (`saveEngineDay` + `persistAltarDay` via `commitRhythmDay`), keeping `altar_completions`/`habits` sync for signed-in believers; on a first visit (no engine record yet) the day derives from the cloud-synced Altar state so counters never restart.
- **SSR safety**: engine loads inside the existing mount-gated async pass (`setEngine(readHabitEngine())` before `setMounted(true)`) — server HTML = "Preparing your altar…" skeleton, zero hydration mismatch; the lint `set-state-in-effect` rule passes because the load lives in the mount effect's async body, not a synchronous effect.
- **Results**: `npx tsc --noEmit` exit 0; `npm run lint` exit 0 (zero warnings); `npm run build` exit 0 (routes `/`, `/_not-found`, `/admin` prerendered, middleware intact); prerendered HTML still shows the mount skeleton (engine state is client-gated by design).

## PWA — MOBILE MANIFEST & OFFLINE NOTIFICATION SERVICE WORKER (2026-09-22)
- **Installable PWA (Palette C)**: `public/manifest.json` — name "Jesus United" / short_name "JesusUnited", guest-first description, `start_url`/`scope` `/`, `display: standalone`, `background_color`/`theme_color` `#0A1118` (deep royal lapis), portrait, icons `/icons/icon-192.png` + `/icons/icon-512.png` (`any`) and `/icons/maskable-512.png` (`maskable`, safe-zone-aware).
- **Icon set**: `scripts/generate-pwa-icons.mjs` (one-shot, `node scripts/generate-pwa-icons.mjs`) renders an ember-cross mark (`#F59E0B` on lapis `#0A1118`, ember glow radial, gold-deep `#FBBF24` accent) via sharp (transitive dep of next/image — no new packages) into `public/icons/{icon-192,maskable-512,apple-touch-icon}.png` + `icon.svg`. Regenerate whenever brand tokens change.
- **Offline & notifications**: `public/sw.js` (vanilla, `self.*`-only access so ESLint passes) — versioned cache `jesus-united-shell-v1`; install precaches the shell (`/`, manifest, favicon, icons, `public/audio/daily-reflection.mp3`) with `Promise.allSettled` + `cache: 'reload'` so one miss can't break install; navigations network-first (fresh liturgy online, cached shell offline), `/_next/static/` + `/icons/` + `/audio/` cache-first with 504 fallback; `push` handler renders Diurnal Prayer Watch chimes (title/body/tag overridable from payload, mirrors PrayerWatchModal tone); `notificationclick` focuses an open client or opens `/`.
- **Registration (non-blocking, SSR-safe)**: `src/app/components/PwaRegistrar.tsx` — `'use client'`, guards `typeof window`, `'serviceWorker' in navigator`, and `window.isSecureContext`; defers `navigator.serviceWorker.register('/sw.js')` until window `load` + `requestIdleCallback` (setTimeout fallback); all failures silent no-ops; rendered at the end of `<body>` in `layout.tsx`.
- **Meta**: `layout.tsx` adds `manifest`, PNG/SVG `icons` (incl. Apple 180px), `appleWebApp { capable, statusBarStyle: 'black-translucent', title: 'JesusUnited' }`; new `viewport` export (Next 16 API) sets `themeColor: '#0A1118'`, `device-width/initialScale 1`, `viewportFit: cover` for notch-safe standalone chrome.
- **Results**: `npx tsc --noEmit` exit 0; `npm run lint` exit 0 (zero warnings); `npm run build` exit 0; icons generated and `git status -s` shows only the intended PWA additions (no commits made).

## HERO 3D WATCHMAN AVATAR — PHASE 1 MVP (2026-09-22)
- **Dependencies**: installed `@react-three/fiber@^9.7.0` + `@react-three/drei@^10.7.8` (React 19 compatible); `three@^0.186.0` + `@types/three` were already present. No other packages added.
- **New 3D module** (`src/app/components/3d/`):
  - `WatchmanModel.tsx` — stylized low-poly clay figure from smooth primitives: tapered capsule robe + shoulder mantle (matte midnight-slate `#101D2B`, roughness 0.82/0.85), gold torus shoulder trim + cowl edge (specular `#F59E0B`, metalness 0.85, low emissive), smooth sphere head inside an open cowl. Interior amber core (emissive sphere at `[0, 0.62, 0.3]`) + ember `#FBBF24` point light breathe at idle (intensity 1.2) and **pulse for exactly 800ms** on Amen (sin envelope: core scale +35%, emissiveIntensity → 4.0, light → 7.7). Damped pointer tracking (lerp factor 0.08): head yaw ±0.45 rad / pitch ±0.22 rad toward `state.pointer`, plus a slow contemplative z-tilt; idle body sway (rot ±0.02, bob ±0.02). `still` prop (reduced motion) disables tracking/sway; the Amen pulse still plays via `state.invalidate()` keeping the demand frameloop fed for the 800ms envelope. Material writes guarded with `!Array.isArray(material) && 'emissiveIntensity' in material` (three r186 `Material` union typing).
  - `WatchmanScene.tsx` — R3F `Canvas` with `dpr={[1, 1.5]}` (mobile battery clamp), `powerPreference: 'low-power'`, lapis fog `#0A1118` (4.5→9), camera `[0, 1.35, 3.4] fov 42`, transparent background; `frameloop={still ? 'demand' : 'always'}`; exports `EMBER_GLOW` tint constant.
  - `AvatarCanvas.tsx` — the SSR gate: `next/dynamic(() => import('./WatchmanScene'), { ssr: false })` so no three.js symbol ever reaches the server bundle; frosted `WatchmanFallback` skeleton (pill surface, ember orb `animate-pulse`) during chunk load; `useReducedMotion()` (framer-motion) flips the scene to still/demand mode live.
- **Amen Resonance integration**: `DailyReflection.tsx` `sayAmen()` now also increments `amenPulseCount`; the count flows DailyReflection → AvatarCanvas → WatchmanScene → WatchmanModel where an effect stamps the scene-clock start time and useFrame drives the 800ms ember pulse (prop-driven so it fires even under `frameloop="demand"`; ref-only would never invalidate).
- **Hero placement**: frosted-glass frame above the Scripture anchor — `rounded-[1.75rem] border-white/10 bg-pill/40 backdrop-blur-2xl` with lapis shadow, `h-64 sm:h-72 max-w-[280px]`, radial `EMBER_GLOW` ambient tint behind the canvas, `role="img"` + descriptive aria-label (decorative canvas stays non-focusable/keyboard-safe).
- **SSR safety**: server HTML = frosted skeleton (identical markup), client chunk loads the Canvas post-hydration — zero hydration mismatch; `<Canvas>` never renders on the server.
- **Results**: `npx tsc --noEmit` exit 0; `npm run lint` exit 0 (zero warnings); `npm run build` exit 0 (5/5 pages, middleware intact); `git status -s` = `package.json`/`package-lock.json`/`DailyReflection.tsx` modified + untracked `src/app/components/3d/`. **No git commit made** — awaiting approval.

## WATCHMAN AVATAR VISIBILITY & HYDRATION FIX (2026-09-23)
- **Root cause of "canvas invisible on localhost:3000" — stale server, not code**: a zombie `next-server (v16.3.5)` process (started before the avatar existed) held port 3000 and served the pre-avatar build byte-for-byte (`pkill -f 'next dev'` missed it because the process re-titles itself `next-server`). Killed PID; fresh server now serves the avatar markup. Lesson: verify with `lsof -nP -iTCP:3000 -sTCP:LISTEN` before debugging rendering; `next dev` auto-falls-back to 3001 silently.
- **Hydration-race hardening** (`AvatarCanvas.tsx`): added the standard `mounted` guard (`useState(false)` + `useEffect` → `requestAnimationFrame(() => setMounted(true))`, rAF-deferred so the sync `set-state-in-effect` lint rule stays satisfied); frosted skeleton renders identically on server + first client render, then the `<Canvas>` mounts only post-paint — the R3F canvas can no longer race hydration inside the framer-motion/AnimatePresence subtree and collapse to 0px.
- **Static-import leak removed**: `AvatarCanvas` no longer does `import { EMBER_GLOW } from './WatchmanScene'` (a static edge that pulled three.js + fiber into the hero's synchronous module graph and defeated the dynamic boundary); the glow tint is inlined locally and `WatchmanScene` no longer re-exports it. `next/dynamic { ssr: false }` is now the *only* edge to the WebGL module.
- **Camera/framing fix** (`WatchmanScene.tsx`): camera moved from `[0, 1.35, 3.4] fov 42` (side-on, head-height — figure half out of frame) to the spec'd `[0, 0, 4] fov 45`, with the model wrapped in `<group position={[0, -0.45, 0]}>` so the silhouette's visual center (~y 0.4) sits on the camera axis, fully centered and visible; fog relaxed to 5→10 so the figure isn't fog-washed.
- **Visibility lift** (`WatchmanModel.tsx`): lighting raised (ambient 0.5→0.62, alabaster key 1.15→1.3, ember rim 2.0→2.4) so the matte `#101D2B` figure reads against `#0A1118` instead of melting into it. Damped pointer tracking, 800ms Amen pulse, reduced-motion `still` mode unchanged.
- **Container**: `h-64 w-full max-w-[280px] sm:h-72 relative overflow-hidden` on the hero frame in `DailyReflection.tsx` was already correct — verified present in served HTML.
- **Verified**: `npx tsc --noEmit` exit 0; `npm run lint` exit 0 (zero warnings after removing the orphaned `EMBER_GLOW` export); `npm run build` exit 0; fresh `next dev` serves HTTP 200 on port 3000 with SSR HTML containing the hero frame (`h-64 w-full max-w-[280px]`), the watchman `aria-label`, and the frosted skeleton — three.js absent from the server payload (client-only chunk). No commit made.

## PERSPECTIVE FIGURINE SHOWCASE — CSS 3D HERO REPLACES THE WEBGL PLACEHOLDER (2026-09-23)
- **What shipped**: `src/app/components/3d/WatchmanStage.tsx` — the hero is now a pointer-driven CSS-perspective showcase (`[perspective:1000px]` + framer-motion springs, no WebGL): damped card tilt (rotateX ±8°, rotateY ±11°), artwork window lifted at `translateZ(18px)`, cursor-chasing specular glare at `translateZ(26px)`, and the figure carrying the deep parallax (x/y drift ±9/±7px + a 4.5% lean toward the cursor). `AvatarCanvas.tsx` keeps its mount-gated skeleton contract (byte-identical server/first-client markup) and now gates `WatchmanStage`; `WatchmanScene.tsx` + `WatchmanModel.tsx` (R3F/three.js) were **deleted** — three.js is out of the hero entirely.
- **Asset reality (verified with `xxd`/`sips` — never trust the filename)**: `public/watchman-avatar.png` is a **progressive JPEG** (FFD8FFE0 JFIF, 631×869, 3 components, `hasAlpha: no`), i.e. an opaque near-white studio backdrop with no transparency. A BMP-decode probe (`sips -s format bmp` + a node pixel reader) sampled 121 backdrop points: **every one is pure `#ffffff`**; the figure is framed tightly (crown, both hands, sandals touch the source edges).
- **Compositing (the key decision)**: no alpha and no safe margin to feather, so the figure is keyed with `mix-blend-multiply` onto a luminous ivory→sand artwork panel (`linear-gradient(180deg,#FFFDF8,#FBF3E2 46%,#F2E2C6)`) inside an `isolate`d `overflow-hidden` window — white multiplies away into the panel tint (no hollowness), the baked sole shadow grounds the pose, and a soft radial shadow + gold pedestal ring land exactly under the sandals (figure bottom `pb-7` = 28px ≈ the ring's ~29px top edge, checked at both `h-64` and `sm:h-72`). Deliberately **no** edge mask/feather: it would clip the hands and crown.
- **Engine-safety rationale**: clipping keeps the multiply blend in a plain 2D context — `mix-blend-mode` inside `preserve-3d` is unreliable in WebKit. Depth is carried by the artwork plane (z18) / rim (z1) / glare (z26) layers plus the figure's parallax + lean, not by a `translateZ` on the multiplied image itself.
- **Amen wiring (`amenPulseCount`)**: zero timers, zero pulse state — the 800ms amber aura bloom (`#F59E0B`) and the gold rim pulse are **one-shot CSS animations replayed by keying on `amenPulseCount`** (`key={aura-${n}}`), and the −8px levitation lift runs imperatively via framer's `useAnimate` (scope ref on the wrapper directly around `<Image />`) so the heavy image is never remounted mid-flight. (The first draft used `setState`+`setTimeout` and was rejected by the React `set-state-in-effect` lint rule; the keyed/imperative design satisfies it.)
- **Reduced motion**: `useReducedMotion()` disables tilt/parallax/glare (pointer handler returns early) and the lift; the CSS media query calms the resting float to −2px/9s, freezes the shadow breathe, and swaps the aura to an opacity-only fade. The resting float is the one motion kept on purpose (spec: "a subtle resting float").
- **A11y**: the stage is `aria-hidden="true"` (decorative, zero focusables, no keyboard traps), the hero wrapper in `DailyReflection.tsx` keeps `role="img"` with an updated descriptive label, and the wrapper gained `[touch-action:pan-y]` so vertical scrolling still works over the card.
- **Files touched**: new `src/app/components/3d/WatchmanStage.tsx`; rewritten `src/app/components/3d/AvatarCanvas.tsx`; deleted `WatchmanScene.tsx` + `WatchmanModel.tsx`; `src/app/components/DailyReflection.tsx` (hero wrapper — the glass card moved inside the stage); `src/app/globals.css` (`watchman-float`, `watchman-float-gentle`, `watchman-shadow-breathe`, `watchman-aura`, `watchman-aura-still`, `watchman-rim-pulse` + their reduced-motion block).
- **Results (all fresh, after the final edit)**: `npx tsc --noEmit` exit 0; `npm run lint` exit 0 (zero warnings); `npm run build` exit 0 (5/5 pages, `ƒ Proxy (Middleware)`, clean prerender); `node --test tests/*.test.mjs` → **101/101 pass, exit 0**; `next start -p 3111` + curl: `/` 200, `/watchman-avatar.png` 200 `image/png` 40104 B, `/_next/image?url=%2Fwatchman-avatar.png&w=640&q=75` → **200 `image/jpeg` 32625 B** (the optimizer sniffs the true JPEG format), SSR HTML contains the new `aria-label` + the frosted skeleton, server log clean.
- **Gotchas for next sprint**: (1) the asset is JPEG-in-`.png` — serve it through `next/image` (its optimizer sniffs content) or rename to `.jpg`; bypassing the optimizer (e.g. `unoptimized`) would ship it as `image/png` bytes-that-are-JPEG. (2) There is still **no global `*` reduced-motion guard** in `globals.css` — the repo's deliberate pattern is feature-level overrides, and a global `animation-duration: 0.01ms !important` block would kill the mandated resting float. (3) `public/watchman-avatar.png` (plus the untracked `public/avatars/` and `public/models/` dirs) must be staged for Vercel or the hero 404s in deploy — same class of gotcha as the untracked `src/lib/*` files. (4) **No git commit made** — awaiting approval.


## WATCHMAN WEBGL HERO — THE REAL GLB FIGURINE IN REACT-THREE-FIBER (2026-09-23)
- **What shipped**: the CSS-3D showcase is gone; the hero renders the real `/public/models/watchman.glb` (1.72 MB glTF 2.0 trimesh export) in a live Three.js viewport — `WatchmanScene.tsx` (Canvas + studio rig), `WatchmanModel.tsx` (loader + rig + Amen resonance), `AvatarCanvas.tsx` (client gate) — on a transparent `h-[380px]`/`max-w-[340px]` stage in `DailyReflection.tsx` (no glass card, no border, no artwork panel).
- **Two asset facts decided the implementation** (read from the GLB's JSON chunk, then proven against three's source): (1) the mesh has **no `NORMAL` attribute** (`POSITION` + `TEXCOORD_0` only) → `MeshStandardMaterial` shades at `dot(N,L)=0`, so the entire studio rig would be invisible; `prepareScene()` calls `geometry.computeVertexNormals()` (executed proof: normals absent → present, unit length **1.000000**). (2) The export omits `metallicFactor`, which glTF defaults to **1.0** — `GLTFLoader.js:3640` (`metallicFactor !== undefined ? … : 1.0`) — and a pure *metal* has no diffuse term, so the spec'd ambient/key/fill/rim lights would yield a black silhouette; `prepareScene()` normalises `metalness = 0` (the embedded PNG is a baked albedo, so dielectric clay is the correct read). Both mutations are guarded → idempotent, StrictMode-safe.
- **Rig**: `<primitive scale={2.4} />` inside a group at `y = -1.0` (the spec'd placement, exact) — the group is the **pivot**, so yaw spins in place and pitch tips at the waist instead of pendulum-swinging from above the crown. The exporter already centres the model on the origin (bounds `y -0.5003..0.4999`, exactly 1.0 unit tall) → 2.4 units centred at −1.0.
- **Camera**: `[0, -1.0, 4.6]`, fov 45, no `lookAt` (R3F looks down −Z). Level with the figurine's centre → symmetric framing: 0.705u margin above and below at rest (figure = 63% of viewport height), still clearing every edge at the tracker extremes (worst-case rotated half-width 0.899u vs. 1.364u visible at the narrowest phone aspect).
- **Motion**: damped pointer follow (lerp 0.08; `rotation.y → pointer.x·0.55`, `rotation.x → −pointer.y·0.25`) + breathing float `y = −1.0 + sin(t·1.5)·0.03`, all inside `useFrame` with **zero per-frame allocations** and **zero React state** — the Amen pulse is stamped by comparing `amenPulseCount` against a ref inside the frame loop (no effects, no timers, nothing for `set-state-in-effect` to catch).
- **Amen resonance**: 800ms amber rim surge `3.5 → 6.0` decaying as `(1−p)^1.4` on the rim light (ref owned by `WatchmanScene`, driven by `WatchmanModel`) + an elastic scale bump `A·e^(−ζp)·sin(ωp)` on the rig. **Calibration gotcha**: the damped-spring peak sits at `p* = atan(ω/ζ)/ω ≈ 0.166`, not where I first assumed — `A = 0.165` overshot to **+7.25%**; re-solved to **0.1364**, measured peak now **5.992% (×1.0599)** and back within 0.1% of 1.0× at `p = 1` (verified numerically, never by eye).
- **Reduced motion**: holds the figurine level and still (pointer tracking, levitation and the scale bump all skipped; the rig *eases* back to rest so a live preference flip does not jump) — the Amen acknowledgement still answers in light.
- **Failure isolation (two measured failure modes)**: (1) drei's `Environment preset="city"` fetches its HDRI from `raw.githack.com` at runtime and that CDN currently answers **HTTP 403**; R3F re-throws any canvas-tree error up to the *parent* React tree (`Canvas` line 60 `if (error) throw error`), which would take the whole DailyReflection card down — so the IBL sits in its own `<Suspense>` + `EnvironmentBoundary` and degrades silently to the four studio lights. (2) `WEBGL_SUPPORTED` is probed at module scope (client-only chunk, outside render) so a browser that refuses a context gets a quiet factual line instead of a blank 380px void — R3F's own `fallback` prop renders *inside* `<canvas>`, i.e. invisibly, so it cannot cover this.
- **Lighting decision**: the Canvas keeps the spec'd `gl` config exactly (`antialias`, `alpha`, ACESFilmic, exposure 1.35) and deliberately **no `shadows`** — a transparent overlay with no receiving surface would only gain acne on a 17,147-triangle scanned mesh; `castShadow` stays on the key light for parity with the rig spec.
- **Bundle**: three/R3F/drei load client-only (`dynamic(..., { ssr: false, loading: <AvatarSkeleton /> })`, skeleton SSR'd); three lands in its own chunk (verified: `WebGLRenderer` present in `.next/static/chunks/*.js`, absent from the prerendered HTML); `useGLTF.preload('/models/watchman.glb')` fires as soon as the chunk executes.
- **Files**: rewritten `src/app/components/3d/WatchmanModel.tsx` + `WatchmanScene.tsx` (deleted by the CSS sprint, so they now diff against their commit-`b22172d` originals); rewritten `src/app/components/3d/AvatarCanvas.tsx`; `DailyReflection.tsx` (hero slot only); `globals.css` (all six dead `watchman-*` keyframe/animation rules removed); deleted the untracked `WatchmanStage.tsx`.
- **Results (all fresh, after the final edit)**: `npx tsc --noEmit` exit 0; `npm run lint` exit 0 (zero warnings); `npm run build` exit 0 (`/`, `/_not-found`, `/admin` static, `/api/sentry-test` dynamic, `ƒ Proxy (Middleware)`); `node --test tests/*.test.mjs` → **101/101 pass, exit 0**; live dev server :3000 → `/` **HTTP 200** (95,893 B) containing the new `aria-label`, the SSR'd skeleton and **zero `<canvas>` in server HTML** (proves `ssr:false`); `/models/watchman.glb` → **200 `model/gltf-binary` 1,727,348 B**.
- **Gotchas for next sprint**: (1) `public/models/watchman.glb` is **untracked** — Vercel builds from a git clone, so the hero 404s on deploy until `public/models/` is staged (same class as the untracked `src/lib/*` gotcha); (2) because the HDRI CDN 403s, the IBL is genuinely absent right now — the hero is calibrated to read correctly on lights alone, and serving a local `potsdamer_platz_1k.hdr` + `<Environment files="/hdri/…" />` is the drop-in upgrade if the sheen is wanted; (3) `public/watchman-avatar.png` is now unreferenced (kept); (4) the WebGL-unsupported branch is type-checked and lint-clean but cannot be exercised in this environment; (5) **no git commit made** — awaiting approval.

## WATCHMAN HERO — GROUNDED PEDESTAL, 360° ORBIT, CLICK/AMEN IMPULSE (2026-09-23)
- **What shipped**: the figurine no longer floats. The stage gained an illuminated acrylic pedestal (slab + gold halo + ember core + `ContactShadows` pool), the camera gained real 360° drag-orbit, and the figurine gained a tactile impulse — click it (or say Amen) and it hops 0.25u off the acrylic and whips one elastic turn. New pure module `src/lib/watchmanStage.ts` + new suite `tests/watchmanStage.test.mjs`.
- **The spec's own coordinates fixed the composition**: `ContactShadows [0,-1.0,0]` + `pedestal [0,-1.02,0]` only make sense if **y = −1.0 is the ground plane**. The old rig centred the 2.4-unit figurine at −1.0 (soles at **−2.2**, floating in a void), so a pedestal at −1.02 would have sliced it at the knees. Fix: `FIGURINE_CENTER_Y = GROUND + scale/2 = +0.2` (derived, not hard-coded — the Model's JSX `position` prop never changed, only the constant's derivation) and the camera re-centred on the composition's midpoint `ORBIT_TARGET_Y = (PEDESTAL_BOTTOM_Y + FIGURINE_TOP_Y)/2 = 0.1795`, mounted 18° above the horizon (eye level would show the slab edge-on as a line). The pedestal's top face lands exactly on the plane; a 2mm `PEDESTAL_Z_FIGHT_GUARD` keeps the acrylic and the shadow plane from z-fighting.
- **Sizes came from the mesh, not from taste**: POSITION accessor spans x −0.2727..0.2660, z −0.2601..0.2609 → half-width `hypot(0.2727,0.2601)·2.4 = 0.905` → pedestal radius **1.0**, hit cylinder radius **0.95**.
- **Raycast budget (source-proven)**: R3F raycasts *every object with a pointer handler and all of its descendants* (`intersectObject(obj, true)`, events chunk line 617), so an `onClick` on the rig would walk **17,147 triangles on every pointer move** across the hero. three's `Raycaster` has **no `visible` check** (grep: zero occurrences in `Raycaster.js`), so a `visible={false}` 24-triangle cylinder takes the handler while being skipped by the renderer *and* by drei's ContactShadows pass (`scene.overrideMaterial` + `visible === false` skip, ContactShadows.js line 80).
- **Drag vs click**: R3F sets `event.delta = hypot(offsetX − initialClickX, offsetY − initialClickY)` — pixels travelled since pointerdown — so `if (event.delta > 6) return` is what stops every 360° orbit-drag from firing a celebratory turn.
- **The hop is ballistic, not a spring** (deliberate): a damped spring driven back to rest *undershoots* — with workable damping the soles would sink ~0.17u **through the acrylic**, so gravity + restitution bounces (which can only ever return them to the surface) carry the hop. Calibration: semi-implicit Euler on a fixed 1/120 sub-step bleeds energy, so the continuous ideal `sqrt(2gh)=2.8284` peaks at only **0.2387**; solved to **2.8952** → measured apex **0.249993** (a 30fps grid samples it 0.0008 low, i.e. one sub-step). Fixed-step integration + a 1/15s catch-up clamp makes the apex refresh-rate independent and tab-stall proof.
- **`easeOutElastic` overshoot was mis-remembered — the suite caught it**: the true peak is **1.3731 at p ≈ 0.135** (not the ~1.0956 I first asserted); the revolution completes by p ≈ 0.19 (~150ms of the 800ms window) and then the elastic settle swings back — fast turn plus spring, exactly the spec's ask. Because the ease is exactly 1 at p = 1, a completed impulse folds `2π` into the base yaw: **zero drift** across unlimited impulses, and a second click mid-turn folds the in-flight offset so the yaw never jumps.
- **The suite also caught a real geometry bug before it ever rendered**: `CAMERA_POSITION` had `sin`/`cos` swapped (camera 72° up instead of 18°); the framing case passed because it computes its own pose, but the "mounted camera sits inside its own polar limits" case failed. The convention is now pinned in code *and* test.
- **Framing is a proven invariant, not a hope**: zoom and pan are off, so the camera can only travel a fixed-radius arc inside the spec'd polar clamps (60°..87.8°). `watchmanStage.test.mjs` runs an exact frustum test (vertical/horizontal angles vs the half-fovs, at 3 polar angles × 5 azimuths × the worst-case silhouette *including the hop's apex*) against the **narrowest** hero aspect (0.65 — a 320px viewport) → the pedestal and the crown can never leave frame.
- **The pedestal's visible flare is the emissive**: the spec'd point light sits *inside* the slab (2cm under the soles), where it can only light surfaces whose normals point **down** — robe underside, sheep belly, acrylic interior, all hidden from a camera ≥2° above the horizon. So the light does what the spec says physically, and the slab's + halo ring's `emissiveIntensity` carry the answer a visitor can actually see (0 → 6.0 light, 1.4 → 3.2 ring, 0.08 → 0.93 slab, all on the same 800ms `(1−p)^1.4` envelope). `amenFlare` clamps internally — `Math.pow` of a negative base with a fractional exponent is NaN, and callers legitimately evaluate it before the window opens and long after it closes.
- **ContactShadows facts**: `frames = Infinity` by default → the pool re-renders every frame, so the shadow visibly softens and tightens as the figurine hops (a free, strong grounding cue). Its depth material writes alpha `1 − fragCoordZ`, so the plane is **fully transparent where nothing casts** — no dark square can appear over the transparent canvas. The halo ring is kept strictly **below** the ground plane so the depth pass (which renders everything above the plane) can never burn a phantom ring into the pool.
- **Mobile scroll trap closed, and the fix needed two tries**: drei's OrbitControls connects with `touch-action: none` on R3F's event source — verified from source to be the Canvas's **outer div** (line 86 `events.connect(... : divRef.current)`, and `{...props}` spread onto that same div at line 135), i.e. the element my `className` reaches. Tailwind's `[touch-action:pan-y_pinch-zoom]!` arbitrary property generated **nothing** in the shipped CSS (proven by grepping the built CSS), so the rule lives in `globals.css` as `.watchman-stage { touch-action: pan-y pinch-zoom !important }` — an `!important` *author* declaration outranks an inline style, which is the only reason it wins. Safe because r186's OrbitControls ends its gesture on `pointercancel` (the event a scroll-claim dispatches). Verified present in `.next/static/chunks/*.css`.
- **Retired on purpose**: the previous sprint's breathing float (±0.03) — with a real surface it would push the soles ~3cm *through* the acrylic every cycle and ~3cm off it at the other extreme, which is the exact "floating in mid-air" complaint this sprint exists to fix. Life now comes from the slow auto-orbit (60s/revolution), the hop/spin impulse, and the Amen flare.
- **Reduced motion**: `autoRotate={false}`, and the hop / turn / scale bump are all skipped — the figurine stands level and still while the Amen **still answers in light** (rim surge + pedestal flare are luminance, not motion); a live preference flip eases the rig back to rest instead of snapping.
- **Files**: new `src/lib/watchmanStage.ts` (300 lines, dependency-free pure logic — geometry facts, camera/orbit config, Amen envelope, ballistic hop, elastic turn — the same `src/lib` + transpile-harness architecture as `globeCamera`/`globeHud`); new `tests/watchmanStage.test.mjs` (263 lines); rewritten `WatchmanScene.tsx` (321 lines: `Pedestal`, `OrbitControls`, the `watchman-stage` class); rewritten `WatchmanModel.tsx` (invisible hit volume + impulse + `event.delta` guard; `prepareScene()` byte-identical); `globals.css` (the `.watchman-stage` rule); `DailyReflection.tsx` (hero `aria-label` now describes the lit pedestal).
- **Results (all fresh, after the final edit)**: `npx tsc --noEmit` exit 0 (zero output); `npm run lint` exit 0 (zero warnings); `npm run build` exit 0 ("Compiled successfully", 5/5 static pages, `ƒ Proxy (Middleware)`); `node --test tests/*.test.mjs` → **114/114 pass, exit 0, 13 suites** (was 101 — the new file adds 13 cases); `next start -p 3111` + curl: `/` **200** (85,390 B) with the new `aria-label`, the SSR'd skeleton and **zero `<canvas>`** in server HTML (proves the client-only gate); `/models/watchman.glb` **200 `model/gltf-binary` 1,727,348 B**; the shipped CSS contains `touch-action: pan-y pinch-zoom !important`.
- **Gotchas for next sprint**: (1) `public/models/watchman.glb` is still **untracked** — Vercel clones from git, so the hero 404s on deploy until `public/models/` is staged (same class as the untracked `src/lib/*`); (2) the acrylic's `transmission` look and the pedestal's exact lighting balance **cannot be verified without a GPU** in this environment — the code path, types and gates are verified, the *render* is not; (3) a vertical swipe on the hero now scrolls the page instead of rotating (horizontal drags rotate and auto-orbit continues) — intentional, flag if a rotation-first touch model is preferred; (4) the always-on auto-orbit has no visible pause control (WCAG 2.2.2 leans on `prefers-reduced-motion` here) — a small toggle would close that gap if wanted; (5) `hasAmenToday` daily-locks the Amen button, so the Amen celebration is once-a-day, which is exactly why clicking the figurine itself now matters; (6) **no git commit made** — awaiting approval.


## WATCHMAN ASSET NORMALIZATION & HYDRATION CONTRACT — UNIT-HEIGHT GLB ON THE STAGE (2026-09-24)
- **What shipped**: `public/models/watchman.glb` swapped upstream to a new FBX2glTF shepherd (2.14 MB: 4,055 verts / 8,116 tris, 1 skin / 34 mixamo joints, clips `Idle` / `Wave` / `ThumbsUp`, base-color PNG, metallic 0.05 / roughness 0.85) authored in a ~0.01-unit box (crown 0.0099881, soles already exactly 0, x/z exactly centred) — while `watchmanStage.ts` still pinned the old 4.4612-unit RobotExpressive constants, so `FIGURINE_SCALE` shrank the hero to 5.4 mm (the stage showed pedestal glow only).
- **Normalization bake** (`scripts/normalizeWatchmanGlb.mjs`, one-shot, refuses to re-bake): uniform scale `100.119148` baked into POSITION data (accessor min/max recomputed from the quantised float32 values — spec-exact), all 43 node translations, the translation column of both MAT4 bone sets (the referenced IBM + FBX2glTF's orphaned duplicate at the buffer tail), and both hips translation tracks — the `S·M·S⁻¹` conjugation, so rotations keep pivoting about their joints. Result: min `[−0.18837918, 0, −0.12028715]`, max `[0.18837918, 1, 0.12028715]` — soles exactly 0, crown exactly 1, x/z exactly centred.
- **Proof of purity**: `scripts/measureWatchmanBounds.mjs` (three's GLTFLoader + the skin-aware `getVertexPosition` under Node, with a `document`/`self` image shim) sampled rest and every frame of every clip before and after the bake — every bound equals the raw value ×100.119 to float32 precision. Soles never dip below 0 in any clip (Idle closest approach +3e-5); crown peaks at rest; radii: rest 0.1970, idle sway 0.3470, gesture peak 0.3669.
- **Stage recalibration** (`src/lib/watchmanStage.ts`): `MODEL_CROWN_Y = 1.0`, `MODEL_SOLE_Y = 0.0`, `MODEL_HEIGHT = 1.0`, `MODEL_SILHOUETTE_RADIUS = 0.38` (directed approximation; measured full-play peak 0.3669, rest width 0.3768 — carries the tap-volume ledge), `MODEL_GESTURE_REACH = 0.3669`. `FIGURINE_SCALE = 2.4`, `FIGURINE_BASE_Y = −1.0` (soles exactly on the ground plane), `FIGURINE_HALF_WIDTH = 0.912` (hit ledge 0.958, inside the 1.0 platter). Camera/orbit/Amen constants unchanged — composition still 2.44 units, framing suite still green. Gesture note rewritten: Wave now peaks at 0.88 world units out and under crown height, so it never leaves the guaranteed frame.
- **Hydration**: audited `AvatarCanvas.tsx` against Next 16's own `node_modules/next/dist/docs/.../lazy-loading.md` — the rAF `mounted` gate means the server pass, the hydration pass and the `next/dynamic` loading fallback all render the single `AvatarSkeleton` (same `div` + `h-full w-full` fill inside DailyReflection's `h-[380px] max-w-[340px]` stage), and the dynamic never renders pre-mount, so there is no mismatch surface; legacy `h-64` / `sm:h-72` / `max-w-[280px]` exist nowhere in the path. New **`tests/avatarCanvasSsr.test.mjs`** pins the contract: transpiles the real component and `renderToString`s it (server ≡ first-client-pass stand-in) asserting the exact skeleton classes, prop-independence, and absence of `<canvas>` / `watchman-stage` / legacy hero classes.
- **Tests**: `watchmanStage.test.mjs` recalibrated — asset facts now 3 clips / 1 skin / 34 joints / 4,055 verts / 8,116 tris; new file-contract case reads the shipped POSITION accessor and pins soles 0, crown 1, centred x/z, `MODEL_HEIGHT` = box height, silhouette within 0.01 of the shipped width; the 1%-drift test became a two-sided rim test (no overhang, ≤15% underfill — the invisible-figure guard); `reach ≤ silhouette` invariant added.
- **Results (all fresh, after the final edit)**: `npx tsc --noEmit` exit 0; `npm run lint` exit 0 (zero warnings); `npm run build` exit 0 (5/5 static, middleware intact); `node --test tests/*.test.mjs` → **117/117 pass, 0 fail** (was 114: +1 file-contract case, +2 hydration cases); `next start -p 3210` → `/` 200 (85,386 B) passing the 10-point hero HTML check (stage classes, skeleton, aria-label, **no `<canvas>`, no `h-64`/`max-w-[280px]`, no `watchman-stage`**); `/models/watchman.glb` → 200 `model/gltf-binary` 2,139,952 B, byte-identical to the baked file.
- **Gotchas**: (1) the pristine un-normalized GLB is backed up at `.git/watchman.glb.pre-normalize` and `/tmp/watchman.glb.pre-normalize` — restore it before ever re-running the bake (which refuses normalized files); (2) `public/models/` is still **untracked** — stage it before deploy or the hero 404s; (3) **Wave and ThumbsUp share all 35 channel outputs byte-for-byte upstream** — the two named clips are the same animation, so the Amen gesture will look like the wave (clip policy is still correct: both names ship, and the spec allows either); (4) visual/GPU verification (texture, motion feel, WebGL) still needs a real browser — none in this environment; (5) **no git commit made** — awaiting approval.

## HERO CLOSE-OUT — 380PX STAGE, TOUCH-ACTION, AUTHOR FIX, MEMORY SYNC (2026-09-24)
- **Author identity fixed**: the global config carried the placeholder `Your Name <your.email@example.com>` across the entire history; set repo-local `git config user.name/user.email` to `Arikkesh <arikkesh05@users.noreply.github.com>` (GitHub noreply for the `arikkesh05/jesus-united-demo` remote owner — no personal email invented) and re-authored HEAD with `git commit --amend --no-edit --reset-author` **while the index was empty**: `b9509c4` → **`d30b528`**, tree OID byte-identical (`f0e4ed7b…`). Older commits left as originally authored.
- **Hero integration via partial staging (churn untouched)**: `DailyReflection.tsx` staged with `git apply --cached` of the single `@@ -516,11 +524,13 @@` hunk — viewport comment, container `h-64 … max-w-[280px] … sm:h-72` → `flex h-[380px] w-full max-w-[340px] items-center justify-center`, and the pedestal/tap `aria-label` (with `role="img"` retained). The other **44 cross-sprint style/quote hunks stay unstaged** (file is `MM`). `globals.css` staged whole — its diff is only `.watchman-stage { touch-action: pan-y pinch-zoom !important; }` (the `!important` outranks OrbitControls' inline `touch-action: none`, so a vertical swipe scrolls the page on mobile while horizontal drags still orbit; the controller ends its gesture on `pointercancel`).
- **No layout shift**: the stage's fixed `h-[380px]` box is filled by the skeleton (`h-full w-full`) and later by R3F's full-bleed canvas — same box, zero CLS; the framing suite pins crown + pedestal rim inside the frustum at the 0.65 narrowest aspect this height allows.
- **Asset + stage recap (committed in `d30b528`)**: unit-height normalization — soles pinned `Y = 0`, crown `Y = 1`, x/z exactly centred in the shipped POSITION accessor; **`FIGURINE_BASE_Y = -1.0`** (soles exactly on the pedestal — Idle's closest approach +3e-5 model units), `FIGURINE_SCALE = 2.4` over the **1.0 unit-height** box (2.4-unit composition, crown at world 1.4); animation clips **`Idle` / `Wave` / `ThumbsUp`** all shipped and bound (`Idle` cross-fades in over 0.5s and loops; gestures are clamped one-shots; Wave and ThumbsUp share keyframe data upstream — one motion under two names).
- **Full battery, clean pass**: executed on the commit snapshot (`git stash push --keep-index`) *and* the final worktree — `npx tsc --noEmit` **0** · `npm run lint` **0** · `npm run build` **exit 0** (5/5 static pages + middleware) · `node --test tests/*.test.mjs` → **117/117 pass, 0 fail**.
- **Follow-up commit**: `feat(hero): wire watchman canvas container dimensions and mobile touch action` (hero hunk + touch-action rule + this entry). Supersedes the previous entry's "(6) no git commit made — awaiting approval". Still uncommitted by design: DailyReflection's 44 churn hunks, the other sprints' files, untracked `public/avatars/`, `public/models/sample.glb`, `public/watchman-avatar.png`; GLB backups remain at `.git/watchman.glb.pre-normalize` + `/tmp/watchman.glb.pre-normalize`, outside the tree; nothing pushed (origin stays at `a8a7cc1`).

