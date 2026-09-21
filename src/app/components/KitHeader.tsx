'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BookIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  CopyIcon,
} from '@/app/components/icons';
import { estimateKitMinutes, formatKitDate } from '@/lib/pulpitKitMarkdown';
import type { PulpitKit } from '@/lib/types';

interface KitHeaderProps {
  kit: PulpitKit;
}

interface PassageReader {
  reference: string;
  translation: string;
  verses: string[];
  context: string;
}

/**
 * Curated scripture reader content. Verse text is included only for passages
 * whose public-domain (KJV) text can be rendered verbatim; every other passage
 * opens in reference-only mode instead of fabricating scripture text.
 */
const PASSAGE_LIBRARY: Record<string, Omit<PassageReader, 'reference'>> = {
  '1 corinthians 12:12-27': {
    translation: 'King James Version (public domain)',
    verses: [
      'For as the body is one, and hath many members, and all the members of that one body, being many, are one body: so also is Christ.',
      'For by one Spirit are we all baptized into one body, whether we be Jews or Gentiles, whether we be bond or free; and have been all made to drink into one Spirit.',
      'For the body is not one member, but many.',
      'If the foot shall say, Because I am not the hand, I am not of the body; is it therefore not of the body?',
      'And if the ear shall say, Because I am not the eye, I am not of the body; is it therefore not of the body?',
      'If the whole body were an eye, where were the hearing? If the whole were hearing, where were the smelling?',
      'But now hath God set the members every one of them in the body, as it hath pleased him.',
      'And if they were all one member, where were the body?',
      'But now are they many members, yet but one body.',
      'And the eye cannot say unto the hand, I have no need of thee: nor again the head to the feet, I have no need of you.',
      'Nay, much more those members of the body, which seem to be more feeble, are necessary:',
      'And those members of the body, which we think to be less honourable, upon these we bestow more abundant honour; and our uncomely parts have more abundant comeliness.',
      'For our comely parts have no need: but God hath tempered the body together, having given more abundant honour to that part which lacked.',
      'That there should be no schism in the body; but that the members should have the same care one for another.',
      'And whether one member suffer, all the members suffer with it; or one member be honoured, all the members rejoice with it.',
      'Now ye are the body of Christ, and members in particular.',
    ],
    context:
      'Paul writes to a divided Corinthian church, framing unity not as uniformity but as interdependence: every member is set in the body by God Himself, and the honouring of the weakest parts is Heaven\u2019s design.',
  },
  'romans 12:4-5': {
    translation: 'King James Version (public domain)',
    verses: [
      'For as we have many members in one body, and all members have not the same office:',
      'So we, being many, are one body in Christ, and every one members one of another.',
    ],
    context:
      'After eleven chapters of doctrine, Paul turns to application: because we are one body in Christ, gifts differ by design, and humility toward one another is the fitting response to God\u2019s mercy.',
  },
};

function normalizeReference(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function lookupPassage(reference: string): PassageReader | null {
  const entry = PASSAGE_LIBRARY[normalizeReference(reference)];
  return entry ? { reference, ...entry } : null;
}

const pillClass =
  'inline-flex items-center gap-1.5 rounded-full border border-sand bg-pill px-2.5 py-1 text-xs font-semibold text-muted';

export default function KitHeader({ kit }: KitHeaderProps) {
  const [openReference, setOpenReference] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const closeRef = useRef<HTMLButtonElement>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePassage = openReference ? lookupPassage(openReference) : null;

  useEffect(() => {
    if (!openReference) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenReference(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [openReference]);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const handleCopy = async () => {
    if (!activePassage) return;
    const text =
      activePassage.verses.length > 0
        ? `${activePassage.reference} — ${activePassage.translation}\n\n${activePassage.verses.join('\n')}`
        : `${activePassage.reference} — open this reference in your preferred Bible translation.`;
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard) {
        setCopyStatus('error');
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    } finally {
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopyStatus('idle'), 2400);
    }
  };

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
          <span className="inline-flex items-center rounded-full bg-gold px-3 py-1 text-xs font-bold text-canvas">
            {kit.theme}
          </span>
        ) : null}
        {kit.series_name ? <span className={pillClass}>{kit.series_name}</span> : null}
        {kit.scripture_passages.map((passage) => (
          <button
            key={passage}
            type="button"
            aria-haspopup="dialog"
            onClick={() => {
              setCopyStatus('idle');
              setOpenReference(passage);
            }}
            className="group inline-flex items-center gap-1.5 rounded-full border border-sand bg-pill px-2.5 py-1 text-xs font-bold text-pill-ink transition-all duration-200 hover:scale-105 hover:border-gold/60 hover:shadow-md active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            <BookIcon className="h-3.5 w-3.5" />
            {passage}
            <span
              aria-hidden="true"
              className="text-[10px] text-gold transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            >
              ↗
            </span>
          </button>
        ))}
      </div>

      <AnimatePresence>
        {activePassage && (
          <motion.div
            role="presentation"
            className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/45 p-4 backdrop-blur-sm sm:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOpenReference(null)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="scripture-dialog-title"
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-sand/80 bg-canvas/95 shadow-2xl backdrop-blur-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex shrink-0 items-start justify-between gap-4 border-b border-sand/60 p-6 pb-4 sm:px-8">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-pill-ink">
                    Scripture Reader
                  </p>
                  <h5
                    id="scripture-dialog-title"
                    className="mt-1 font-serif text-xl font-bold text-espresso"
                  >
                    {activePassage.reference}
                  </h5>
                  <p className="mt-0.5 text-xs font-medium text-muted">
                    {activePassage.translation}
                  </p>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={() => setOpenReference(null)}
                  aria-label="Close scripture reader"
                  className="rounded-full border border-sand bg-pill p-2 text-muted transition hover:border-gold/50 hover:text-espresso active:scale-95"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-6 pt-4 sm:px-8">
                {activePassage.verses.length > 0 ? (
                  <div className="space-y-3 rounded-2xl border border-sand/70 bg-pill/70 p-5 backdrop-blur-sm">
                    {activePassage.verses.map((verse, index) => (
                      <p key={index} className="font-serif text-[15px] leading-7 text-espresso/90">
                        <span className="mr-1.5 align-super text-[10px] font-bold text-gold">
                          {index + 1}
                        </span>
                        {verse}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl border border-dashed border-sand bg-pill/40 p-5 font-serif text-sm leading-7 text-muted">
                    Verse text for this reference is not stored in the kit — open{' '}
                    {activePassage.reference} in your preferred Bible translation.
                  </p>
                )}

                <div className="rounded-2xl border border-gold/30 bg-gold/10 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-gold">
                    Liturgical Context
                  </p>
                  <p className="mt-1.5 text-sm leading-6 text-espresso/85">
                    {activePassage.context}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center justify-end gap-3 border-t border-sand/60 bg-canvas/80 p-4 backdrop-blur-sm sm:px-8">
                <span aria-live="polite" className="mr-auto text-xs text-muted">
                  {copyStatus === 'error' ? 'Clipboard unavailable in this browser.' : ''}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-2 rounded-full bg-gold px-4 py-2 text-sm font-bold text-canvas transition-all duration-200 hover:bg-gold-deep hover:shadow-md active:scale-[0.98]"
                >
                  {copyStatus === 'copied' ? (
                    <CheckIcon className="h-4 w-4" />
                  ) : (
                    <CopyIcon className="h-4 w-4" />
                  )}
                  {copyStatus === 'copied' ? 'Copied to Clipboard' : 'Copy Passage'}
                </button>
                <button
                  type="button"
                  onClick={() => setOpenReference(null)}
                  className="inline-flex items-center gap-2 rounded-full border border-sand bg-pill px-4 py-2 text-sm font-bold text-espresso transition-all duration-200 hover:border-gold/50 hover:bg-pill active:scale-[0.98]"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}