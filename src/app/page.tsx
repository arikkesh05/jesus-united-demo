import DailyReflection from '@/app/components/DailyReflection';
import { getDailyReflection } from '@/lib/reflections';

const upcomingModules = [
  {
    module: 'Module 2',
    title: 'Church Gathering Map',
    description:
      'Discover fellowships and local church gatherings near you on a PostGIS-powered map, then connect with a leader over WhatsApp in one tap.',
  },
  {
    module: 'Module 3',
    title: 'Sunday Pulpit Kit Generator',
    description:
      'Preview Sunday service slides and generate dynamic QR codes so every congregation can follow along from their own device.',
  },
];

export default async function Home() {
  const reflection = await getDailyReflection();

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <main className="mx-auto max-w-3xl px-4 py-12">
        <header className="text-center">
          <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-teal-700">
            Demo Preview
          </span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            JesusUnited
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-slate-600">
            A guest-first ministry toolkit with three modules: a daily audio reflection, a
            church gathering map, and automated Sunday pulpit kits.
          </p>
        </header>

        <section aria-labelledby="daily-reflection-heading" className="mt-12">
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

        <section aria-labelledby="upcoming-modules-heading" className="mt-16">
          <h2
            id="upcoming-modules-heading"
            className="text-center text-xs font-semibold uppercase tracking-widest text-slate-500"
          >
            More Modules In Progress
          </h2>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            {upcomingModules.map((item) => (
              <article
                key={item.module}
                className="flex flex-col rounded-2xl border border-dashed border-slate-300 bg-white p-6"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                    {item.module}
                  </p>
                  <span className="inline-flex shrink-0 items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                    Coming Soon
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
              </article>
            ))}
          </div>
        </section>

        <footer className="mt-16 border-t border-slate-200 pt-6 text-center text-sm text-slate-500">
          Built for the JesusUnited demo &mdash; guest-first, mobile-responsive, and ready to grow.
        </footer>
      </main>
    </div>
  );
}
