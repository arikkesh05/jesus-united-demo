'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookIcon, ListIcon } from '@/app/components/icons';
import type { PulpitKit } from '@/lib/types';

interface KitOutlinePanelProps {
  kit: PulpitKit;
}

const PREACHING_CUES = [
  { time: '10 min', cue: 'Expository cadence • Build the foundational tension', tag: 'Textual Context' },
  { time: '14 min', cue: 'Intimate, personal delivery • Lower tone for reflection', tag: 'Pastoral Heart' },
  { time: '12 min', cue: 'Urgent call to action • Project energy toward congregational response', tag: 'Living Application' },
];

export default function KitOutlinePanel({ kit }: KitOutlinePanelProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  if (kit.outline.length === 0) {
    return (
      <p className="mt-3 rounded-2xl border border-dashed border-sand bg-pill/40 p-5 text-sm text-muted">
        No outline has been published for this kit yet.
      </p>
    );
  }

  const togglePoint = (index: number) => {
    setOpenIndex((prev) => (prev === index ? null : index));
  };

  return (
    <div>
      <div className="flex items-center justify-between pb-1">
        <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-pill-ink">
          <ListIcon className="h-4 w-4 text-gold"/>
          Homiletical Progression
        </h4>
        <span className="text-xs font-medium text-muted">Click to expand pastoral exegesis</span>
      </div>

      <ol className="mt-4 space-y-3.5">
        {kit.outline.map((point, index) => {
          const isOpen = openIndex === index;
          const crossReference =
            kit.scripture_passages.length > 0
              ? kit.scripture_passages[index % kit.scripture_passages.length]
              : null;
          const hook = kit.talking_points[index] ?? null;
          const cue = PREACHING_CUES[index % PREACHING_CUES.length];

          return (
            <motion.li
              key={point.section}
              layout
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              className={`group overflow-hidden rounded-2xl border transition-all duration-300 ${
                isOpen
                  ? 'border-gold/50 bg-pill/90 shadow-[0_12px_30px_-10px_rgba(245,158,11,0.2)] ring-1 ring-gold/25'
                  : 'border-sand/70 bg-pill/50 backdrop-blur-md hover:border-gold/40 hover:bg-pill/80 hover:shadow-sm'
              }`}
            >
              <button
                type="button"
                onClick={() => togglePoint(index)}
                aria-expanded={isOpen}
                aria-controls={`outline-body-${index}`}
                className="flex w-full items-start justify-between gap-4 p-4 text-left transition-colors sm:p-5"
              >
                <div className="flex items-start gap-4">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl font-serif text-sm font-bold transition-all duration-200 ${
                      isOpen
                        ? 'bg-gold text-canvas shadow-sm'
                        : 'border border-sand/80 bg-pill/80 text-pill-ink group-hover:border-gold/40'
                    }`}
                  >
                    {['I', 'II', 'III', 'IV', 'V'][index] || index + 1}
                  </span>

                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-bold tracking-tight text-espresso sm:text-lg">
                        {point.section}
                      </p>
                      <span className="rounded-full border border-sand/80 bg-pill/60 px-2.5 py-0.5 text-[11px] font-semibold text-muted backdrop-blur-xs">
                        ⏱ {cue.time}
                      </span>
                    </div>

                    {point.subtext && (
                      <p className="mt-1 text-sm leading-relaxed text-muted">
                        {point.subtext}
                      </p>
                    )}
                  </div>
                </div>

                <div
                  className={`mt-1 shrink-0 rounded-full p-1 text-muted transition-transform duration-300 ${
                    isOpen ? 'rotate-180 text-gold' : 'group-hover:text-espresso'
                  }`}
                  aria-hidden="true"
                >
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    id={`outline-body-${index}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                    className="overflow-hidden border-t border-sand/50 bg-pill/20"
                  >
                    <div className="p-5 pt-4">
                      <div className="grid gap-3.5 sm:grid-cols-2">
                        <div className="rounded-xl border border-sand/70 bg-pill/80 p-4 shadow-sm backdrop-blur-sm">
                          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gold">
                            <BookIcon className="h-3.5 w-3.5"/>
                            Anchor Scripture & Focus
                          </div>
                          <p className="mt-1.5 font-serif text-sm font-semibold text-espresso">
                            {crossReference || '1 Corinthians 12'}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-muted">
                            Examine the organic unity of the body. Differences are not deficiencies—they are the divine architecture of interdependence.
                          </p>
                        </div>

                        <div className="rounded-xl border border-sand/70 bg-pill/80 p-4 shadow-sm backdrop-blur-sm">
                          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-pill-ink">
                            <span>🎙️</span>
                            Pastoral Delivery Cue
                          </div>
                          <p className="mt-1.5 text-xs font-semibold text-espresso">
                            {cue.cue}
                          </p>
                          <span className="mt-2.5 inline-block rounded-md bg-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold">
                            {cue.tag}
                          </span>
                        </div>
                      </div>

                      {hook && (
                        <div className="mt-3.5 rounded-xl border border-gold/30 bg-gold/10 p-4 backdrop-blur-xs">
                          <p className="text-xs font-bold uppercase tracking-wider text-gold">
                            Illustration Hook
                          </p>
                          <p className="mt-1 text-xs italic leading-relaxed text-espresso">
                            &quot;{hook}&quot;
                          </p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}