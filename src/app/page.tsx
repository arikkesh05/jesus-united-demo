import Link from "next/link";

import AltarOS from "@/app/components/AltarOS";
import DailyReflection from "@/app/components/DailyReflection";
import GatheringMap from "@/app/components/GatheringMap";
import PulpitKit from "@/app/components/PulpitKit";
import PrayerWall from "@/app/components/PrayerWall";
import MissionGlobe from "@/app/components/globe/MissionGlobe";
import { getGatherings, getPublicGatheringMarkers } from "@/lib/gatherings";
import { getLatestPulpitKit } from "@/lib/pulpitKits";
import { getDailyReflection } from "@/lib/reflections";

export default async function Home() {
  const reflection = await getDailyReflection();
  const gatherings = await getGatherings();
  const markerResult = await getPublicGatheringMarkers();
  const markers = markerResult.ok ? markerResult.data : [];
  const pulpitKit = await getLatestPulpitKit();

  return (
    <div className="min-h-screen font-sans text-espresso">
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="text-center">
          <span className="inline-flex items-center rounded-full bg-pill px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-pill-ink">
            Demo Preview
          </span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-espresso sm:text-5xl">
            JesusUnited
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-muted">
            A guest-first ministry toolkit: a daily audio reflection, a church
            gathering map, an interactive 3D mission globe, a community prayer
            wall, and automated Sunday pulpit kits.
          </p>
          <nav
            aria-label="Module shortcuts"
            className="mt-8 flex flex-wrap items-center justify-center gap-2"
          >
            <a
              href="#altar-os-section"
              className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-pill px-4 py-2 text-xs font-bold text-espresso shadow-soft transition hover:border-gold hover:bg-pill"
            >
              Altar OS
            </a>
            <a
              href="#daily-reflection-section"
              className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-pill px-4 py-2 text-xs font-bold text-espresso shadow-soft transition hover:border-gold hover:bg-pill"
            >
              Daily Reflection
            </a>
            <a
              href="#gathering-map-section"
              className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-pill px-4 py-2 text-xs font-bold text-espresso shadow-soft transition hover:border-gold hover:bg-pill"
            >
              Gatherings Map
            </a>
            <a
              href="#mission-globe-section"
              className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-pill px-4 py-2 text-xs font-bold text-espresso shadow-soft transition hover:border-gold hover:bg-pill"
            >
              Mission Globe
            </a>
            <a
              href="#prayer-wall-section"
              className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-pill px-4 py-2 text-xs font-bold text-espresso shadow-soft transition hover:border-gold hover:bg-pill"
            >
              Prayer Wall
            </a>
            <a
              href="#pulpit-kit-section"
              className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-pill px-4 py-2 text-xs font-bold text-espresso shadow-soft transition hover:border-gold hover:bg-pill"
            >
              Pulpit Kit
            </a>
            <Link
              href="/admin"
              prefetch={false}
              className="inline-flex items-center rounded-full border border-sand bg-pill px-4 py-2 text-xs font-bold text-espresso shadow-soft transition hover:border-gold hover:bg-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              Admin · Restricted
            </Link>
          </nav>
        </header>

        <section
          id="daily-reflection-section"
          aria-labelledby="daily-reflection-heading"
          className="mt-12 scroll-mt-8"
        >
          <h2
            id="daily-reflection-heading"
            className="mb-4 text-center text-xs font-bold uppercase tracking-[0.2em] text-muted"
          >
            Module 1 &middot; Daily Audio Reflection
          </h2>
          <div className="flex justify-center">
            <DailyReflection reflection={reflection} />
          </div>
        </section>

        <section
          id="altar-os-section"
          aria-labelledby="altar-os-heading"
          className="mt-16 scroll-mt-8"
        >
          <h2
            id="altar-os-heading"
            className="mb-4 text-center text-xs font-bold uppercase tracking-[0.2em] text-muted"
          >
            Altar OS &middot; Morning Altar &amp; Evening Examen
          </h2>
          <AltarOS
            scriptureFocus={
              reflection
                ? {
                    title: reflection.title,
                    reference: reflection.scripture_reference,
                    excerpt: reflection.reflection_text.slice(0, 240),
                  }
                : null
            }
          />
        </section>

        <section
          id="gathering-map-section"
          aria-labelledby="gathering-map-heading"
          className="mt-16 scroll-mt-8"
        >
          <h2
            id="gathering-map-heading"
            className="mb-4 text-center text-xs font-bold uppercase tracking-[0.2em] text-muted"
          >
            Module 2 &middot; Church Gathering Map
          </h2>
          <GatheringMap gatherings={gatherings} />
        </section>

        <section
          id="mission-globe-section"
          aria-labelledby="mission-globe-heading"
          className="mt-16 scroll-mt-8"
        >
          <h2
            id="mission-globe-heading"
            className="mb-4 text-center text-xs font-bold uppercase tracking-[0.2em] text-muted"
          >
            Mission Globe &middot; Storybook Gathering Atlas
          </h2>
          <MissionGlobe markers={markers} />
        </section>

        <section
          id="prayer-wall-section"
          aria-labelledby="prayer-wall-heading"
          className="mt-16 scroll-mt-8"
        >
          <h2
            id="prayer-wall-heading"
            className="mb-4 text-center text-xs font-bold uppercase tracking-[0.2em] text-muted"
          >
            Intercession Pulse &middot; Community Prayer Wall
          </h2>
          <PrayerWall />
        </section>

        <section
          id="pulpit-kit-section"
          aria-labelledby="pulpit-kit-heading"
          className="mt-16 scroll-mt-8"
        >
          <h2
            id="pulpit-kit-heading"
            className="mb-4 text-center text-xs font-bold uppercase tracking-[0.2em] text-muted"
          >
            Module 3 &middot; Sunday Pulpit Kit Generator
          </h2>
          {pulpitKit ? (
            <PulpitKit kit={pulpitKit} />
          ) : (
            <p className="rounded-3xl border border-dashed border-sand bg-pill p-6 text-center text-sm leading-6 text-muted">
              This week&apos;s pulpit kit is being prepared &mdash; please check
              back soon.
            </p>
          )}
        </section>

        <footer className="mt-16 border-t border-sand pt-6 text-center text-sm text-muted">
          Built for the JesusUnited demo &mdash; guest-first, mobile-responsive,
          and ready to grow.
        </footer>
      </main>
    </div>
  );
}
