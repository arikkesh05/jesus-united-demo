import { BookIcon, CalendarIcon, ClockIcon } from '@/app/components/icons';
import { estimateKitMinutes, formatKitDate } from '@/lib/pulpitKitMarkdown';
import type { PulpitKit } from '@/lib/types';

interface KitHeaderProps {
  kit: PulpitKit;
}

const pillClass =
  'inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600';

export default function KitHeader({ kit }: KitHeaderProps) {
  return (
    <header>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-indigo-700">
          Pulpit Kit
        </span>
        <span className={pillClass}>
          <ClockIcon className="h-3.5 w-3.5" />
          {estimateKitMinutes(kit)}-min Sermon Architecture
        </span>
        {kit.target_sunday ? (
          <span className={pillClass}>
            <CalendarIcon className="h-3.5 w-3.5" />
            {formatKitDate(kit.target_sunday)}
          </span>
        ) : null}
      </div>

      <h3 className="mt-3 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
        {kit.title}
      </h3>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {kit.theme ? (
          <span className="inline-flex items-center rounded-full bg-teal-700 px-3 py-1 text-xs font-semibold text-white">
            {kit.theme}
          </span>
        ) : null}
        {kit.series_name ? <span className={pillClass}>{kit.series_name}</span> : null}
        {kit.scripture_passages.map((passage) => (
          <span
            key={passage}
            className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700"
          >
            <BookIcon className="h-3.5 w-3.5" />
            {passage}
          </span>
        ))}
      </div>
    </header>
  );
}