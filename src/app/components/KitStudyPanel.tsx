import { BookIcon } from '@/app/components/icons';
import type { PulpitKit } from '@/lib/types';

interface KitStudyPanelProps {
  kit: PulpitKit;
}

export default function KitStudyPanel({ kit }: KitStudyPanelProps) {
  return (
    <>
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
        <BookIcon className="h-4 w-4" />
        Reflection and Accountability Questions
      </h4>

      {kit.discussion_questions.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          Discussion questions are not available for this kit yet.
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {kit.discussion_questions.map((question, index) => (
            <li
              key={question}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
            >
              <span className="text-sm font-bold text-teal-700">{index + 1}.</span>
              <p className="text-sm leading-6 text-slate-700">{question}</p>
            </li>
          ))}
        </ol>
      )}

      {kit.key_quote ? (
        <blockquote className="mt-4 rounded-xl border-l-4 border-teal-600 bg-teal-50 p-4 text-sm italic leading-6 text-slate-700">
          &ldquo;{kit.key_quote}&rdquo;
        </blockquote>
      ) : null}

      {kit.call_to_action ? (
        <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-700">
            Application Challenge
          </p>
          <p className="mt-1.5 text-sm leading-6 text-slate-700">{kit.call_to_action}</p>
        </div>
      ) : null}
    </>
  );
}