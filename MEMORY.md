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

