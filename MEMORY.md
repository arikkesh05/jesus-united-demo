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


