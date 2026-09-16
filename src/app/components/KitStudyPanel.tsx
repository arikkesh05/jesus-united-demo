import { BookIcon } from '@/app/components/icons';
import type { PulpitKit } from '@/lib/types';

interface KitStudyPanelProps {
  kit: PulpitKit;
}

export default function KitStudyPanel({ kit }: KitStudyPanelProps) {
  return (
    <>
      <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-pill-ink">
        <BookIcon className="h-4 w-4" />
        Reflection and Accountability Questions
      </h4>

      {kit.discussion_questions.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-dashed border-sand bg-pill/50 p-4 text-sm text-muted">
          Discussion questions are not available for this kit yet.
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {kit.discussion_questions.map((question, index) => (
            <li
              key={question}
              className="flex items-start gap-3 rounded-2xl border border-sand bg-canvas p-4"
            >
              <span className="text-sm font-bold text-pill-ink">{index + 1}.</span>
              <p className="text-sm leading-6 text-espresso/80">{question}</p>
            </li>
          ))}
        </ol>
      )}

      {kit.key_quote ? (
        <blockquote className="mt-4 rounded-r-2xl border-l-4 border-gold bg-pill p-4 text-sm italic leading-6 text-espresso/90">
          &ldquo;{kit.key_quote}&rdquo;
        </blockquote>
      ) : null}

      {kit.call_to_action ? (
        <div className="mt-4 rounded-2xl border border-sand bg-pill p-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-pill-ink">
            Application Challenge
          </p>
          <p className="mt-1.5 text-sm leading-6 text-espresso/80">{kit.call_to_action}</p>
        </div>
      ) : null}
    </>
  );
}