import AltarOS from '@/app/components/AltarOS';
import DailyReflection from '@/app/components/DailyReflection';
import GatheringMap from '@/app/components/GatheringMap';
import PulpitKit from '@/app/components/PulpitKit';
import { getGatherings } from '@/lib/gatherings';
import { getLatestPulpitKit } from '@/lib/pulpitKits';
import { getDailyReflection } from '@/lib/reflections';

export default async function Home() {
  const reflection = await getDailyReflection();
  const gatherings = await getGatherings();
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
            A guest-first ministry toolkit with three modules: a daily audio reflection, a church
            gathering map, and automated Sunday pulpit kits.
          </p>
          <nav
            aria-label="Module shortcuts"
            className="mt-8 flex flex-wrap items-center justify-center gap-2"
          >
            <a
              href="#altar-os-section"
              className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-white px-4 py-2 text-xs font-bold text-espresso shadow-soft transition hover:border-gold hover:bg-pill"
            >
              Altar OS
            </a>
            <a
              href="#daily-reflection-section"
              className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-white px-4 py-2 text-xs font-bold text-espresso shadow-soft transition hover:border-gold hover:bg-pill"
            >
              Daily Reflection
            </a>
            <a
              href="#gathering-map-section"
              className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-white px-4 py-2 text-xs font-bold text-espresso shadow-soft transition hover:border-gold hover:bg-pill"
            >
              Gatherings Map
            </a>
            <a
              href="#pulpit-kit-section"
              className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-white px-4 py-2 text-xs font-bold text-espresso shadow-soft transition hover:border-gold hover:bg-pill"
            >
              Pulpit Kit
            </a>
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
            <p className="rounded-3xl border border-dashed border-sand bg-white p-6 text-center text-sm leading-6 text-muted">
              This week&apos;s pulpit kit is being prepared &mdash; please check back soon.
            </p>
          )}
        </section>

        <footer className="mt-16 border-t border-sand pt-6 text-center text-sm text-muted">
          Built for the JesusUnited demo &mdash; guest-first, mobile-responsive, and ready to grow.
        </footer>
      </main>
    </div>
  );
}