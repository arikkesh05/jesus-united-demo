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
    <div className="min-h-screen font-sans text-slate-900">
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="text-center">
          <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-teal-700">
            Demo Preview
          </span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            JesusUnited
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-slate-600">
            A guest-first ministry toolkit with three modules: a daily audio reflection, a church
            gathering map, and automated Sunday pulpit kits.
          </p>
        </header>

        <section id="daily-reflection-section" aria-labelledby="daily-reflection-heading" className="mt-12">
          <h2
            id="daily-reflection-heading"
            className="mb-4 text-center text-xs font-semibold uppercase tracking-widest text-slate-500"
          >
            Module 1 &middot; Daily Audio Reflection
          </h2>
          <div className="flex justify-center">
            <DailyReflection reflection={reflection} />
          </div>
        </section>

        <section id="gathering-map-section" aria-labelledby="gathering-map-heading" className="mt-16">
          <h2
            id="gathering-map-heading"
            className="mb-4 text-center text-xs font-semibold uppercase tracking-widest text-slate-500"
          >
            Module 2 &middot; Church Gathering Map
          </h2>
          <GatheringMap gatherings={gatherings} />
        </section>

        <section id="pulpit-kit-section" aria-labelledby="pulpit-kit-heading" className="mt-16">
          <h2
            id="pulpit-kit-heading"
            className="mb-4 text-center text-xs font-semibold uppercase tracking-widest text-slate-500"
          >
            Module 3 &middot; Sunday Pulpit Kit Generator
          </h2>
          {pulpitKit ? (
            <PulpitKit kit={pulpitKit} />
          ) : (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm leading-6 text-slate-600">
              This week&apos;s pulpit kit is being prepared &mdash; please check back soon.
            </p>
          )}
        </section>

        <footer className="mt-16 border-t border-slate-200 pt-6 text-center text-sm text-slate-500">
          Built for the JesusUnited demo &mdash; guest-first, mobile-responsive, and ready to grow.
        </footer>
      </main>
    </div>
  );
}