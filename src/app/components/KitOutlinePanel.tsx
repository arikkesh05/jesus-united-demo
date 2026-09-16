import { BookIcon, ListIcon } from '@/app/components/icons';
import type { PulpitKit } from '@/lib/types';

interface KitOutlinePanelProps {
  kit: PulpitKit;
}

export default function KitOutlinePanel({ kit }: KitOutlinePanelProps) {
  if (kit.outline.length === 0) {
    return (
      <p className="mt-3 rounded-2xl border border-dashed border-sand bg-pill/50 p-4 text-sm text-muted">
        No outline has been published for this kit yet.
      </p>
    );
  }

  return (
    <>
      <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-pill-ink">
        <ListIcon className="h-4 w-4" />
        Homiletical Progression
      </h4>

      <ol className="mt-4 space-y-4">
        {kit.outline.map((point, index) => {
          const crossReference =
            kit.scripture_passages.length > 0
              ? kit.scripture_passages[index % kit.scripture_passages.length]
              : null;
          const hook = kit.talking_points[index] ?? null;

          return (
            <li key={point.section} className="rounded-2xl border border-sand bg-canvas p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold text-xs font-bold text-espresso">
                  {index + 1}
                </span>
                <div>
                  <p className="text-base font-bold text-espresso">{point.section}</p>
                  {point.subtext ? (
                    <p className="mt-1 text-sm leading-6 text-muted">{point.subtext}</p>
                  ) : null}
                  {crossReference ? (
                    <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-sand bg-pill px-2.5 py-1 text-xs font-bold text-pill-ink">
                      <BookIcon className="h-3.5 w-3.5" />
                      {crossReference}
                    </p>
                  ) : null}
                  {hook ? (
                    <p className="mt-2 text-sm italic leading-6 text-muted">Hook: {hook}</p>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}