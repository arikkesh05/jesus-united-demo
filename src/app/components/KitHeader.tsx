import { BookIcon, CalendarIcon, ClockIcon } from '@/app/components/icons';
import { estimateKitMinutes, formatKitDate } from '@/lib/pulpitKitMarkdown';
import type { PulpitKit } from '@/lib/types';

interface KitHeaderProps {
  kit: PulpitKit;
}

const pillClass =
  'inline-flex items-center gap-1.5 rounded-full border border-sand bg-white px-2.5 py-1 text-xs font-semibold text-muted';

export default function KitHeader({ kit }: KitHeaderProps) {
  return (
    <header>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-pill px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-pill-ink">
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

      <h3 className="mt-3 text-xl font-extrabold tracking-tight text-espresso sm:text-2xl">
        {kit.title}
      </h3>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {kit.theme ? (
          <span className="inline-flex items-center rounded-full bg-gold px-3 py-1 text-xs font-bold text-espresso">
            {kit.theme}
          </span>
        ) : null}
        {kit.series_name ? <span className={pillClass}>{kit.series_name}</span> : null}
        {kit.scripture_passages.map((passage) => (
          <span
            key={passage}
            className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-pill px-2.5 py-1 text-xs font-bold text-pill-ink"
          >
            <BookIcon className="h-3.5 w-3.5" />
            {passage}
          </span>
        ))}
      </div>
    </header>
  );
}