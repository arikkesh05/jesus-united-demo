'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from '@/app/components/icons';
import type { PulpitKit } from '@/lib/types';

interface KitSlideDeckProps {
  kit: PulpitKit;
}

interface SlidePreview {
  label: string;
  title: string;
  body: string;
  footnote?: string;
  notes: string;
}

/** Derives the deck slides from the kit content (theme, scripture, points, application). */
function buildSlides(kit: PulpitKit): SlidePreview[] {
  const slides: SlidePreview[] = [
    {
      label: 'Theme Slide',
      title: kit.title,
      body: kit.theme || kit.series_name || 'Sunday Gathering',
      notes: kit.key_quote
        ? `Anchor the room on the key quote before the message: \u201c${kit.key_quote}\u201d`
        : 'Open with the sermon title and the one-sentence theme while people settle.',
    },
  ];

  if (kit.scripture_passages.length > 0) {
    slides.push({
      label: 'Core Scripture',
      title: kit.scripture_passages[0],
      body: kit.key_quote ?? 'Read the passage together before the message.',
      footnote: kit.scripture_passages.slice(1).join('  ·  ') || undefined,
      notes: kit.key_quote
        ? 'Let the quote breathe on screen for ten seconds before teaching.'
        : 'Invite a volunteer to read the passage aloud while the congregation follows along.',
    });
  }

  kit.outline.forEach((point, index) => {
    slides.push({
      label: `Point ${index + 1}`,
      title: point.section,
      body: point.subtext || 'Walking through this movement of the text.',
      notes:
        kit.talking_points[index] ??
        'Walk the congregation through this movement slowly, anchoring each claim in the text.',
    });
  });

  slides.push({
    label: 'Application Challenge',
    title: 'This Week',
    body:
      kit.call_to_action ??
      kit.talking_points[kit.talking_points.length - 1] ??
      'Invite the congregation to put the passage into practice.',
    notes: 'Close with prayer and one concrete next step for the week ahead.',
  });

  return slides;
}

export default function KitSlideDeck({ kit }: KitSlideDeckProps) {
  const slides = buildSlides(kit);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const isOpen = activeIndex !== null;
  const activeSlide = activeIndex !== null ? slides[activeIndex] : null;

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveIndex(null);
      } else if (event.key === 'ArrowLeft') {
        setActiveIndex((prev) =>
          prev === null ? null : (prev - 1 + slides.length) % slides.length,
        );
      } else if (event.key === 'ArrowRight') {
        setActiveIndex((prev) => (prev === null ? null : (prev + 1) % slides.length));
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, slides.length]);

  return (
    <div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {slides.map((slide, index) => (
          <button
            key={slide.label}
            type="button"
            onClick={() => setActiveIndex(index)}
            aria-haspopup="dialog"
            aria-label={`Open presentation preview: ${slide.title}`}
            className="group flex flex-col overflow-hidden rounded-2xl border border-sand/70 bg-pill/60 text-left shadow-soft backdrop-blur-md transition-all duration-200 hover:-translate-y-1 hover:scale-[1.02] hover:border-gold/40 hover:bg-pill/90 hover:shadow-lift focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold active:scale-[0.99]"
          >
            <div className="flex items-center justify-between gap-2 border-b border-sand/60 bg-pill/60 px-4 py-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-pill-ink">
                {slide.label}
              </span>
              <span className="rounded-full bg-pill/80 px-2 py-0.5 text-[10px] font-bold text-muted">
                16:9
              </span>
            </div>
            <div className="flex aspect-video flex-1 flex-col justify-center gap-1.5 p-4">
              <p className="text-sm font-bold leading-5 text-espresso">{slide.title}</p>
              <p className="line-clamp-3 text-xs leading-5 text-muted">{slide.body}</p>
            </div>
            <div className="flex items-center justify-between border-t border-sand/50 px-4 py-2">
              <span className="text-[10px] font-medium text-muted">
                Slide {index + 1} of {slides.length}
              </span>
              <span className="rounded-full bg-pill px-2 py-0.5 text-[10px] font-bold text-gold opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                Present ↗
              </span>
            </div>
          </button>
        ))}
      </div>

      <AnimatePresence>
        {activeSlide && (
          <motion.div
            role="presentation"
            className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setActiveIndex(null)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={`Presentation preview: ${activeSlide.label}`}
              className="relative w-full max-w-3xl overflow-hidden rounded-3xl border border-white/10 bg-canvas/95 p-4 shadow-2xl backdrop-blur-2xl sm:p-6"
              initial={{ opacity: 0, scale: 0.94, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white">
                  {activeSlide.label}
                </span>
                <div className="flex items-center gap-3">
                  <span className="rounded-full border border-white/15 px-3 py-1 text-[11px] font-bold text-slate-300">
                    Slide {(activeIndex ?? 0) + 1} of {slides.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveIndex(null)}
                    aria-label="Close presentation preview"
                    className="rounded-full border border-white/15 bg-white/10 p-2 text-white transition hover:border-gold/50 hover:bg-white/20 hover:text-gold active:scale-95"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-4 flex aspect-video flex-col items-center justify-center gap-3 rounded-2xl bg-[#0b0906] p-6 text-center ring-1 ring-white/10 sm:p-10">
                <p className="font-serif text-xl font-bold leading-snug text-white sm:text-3xl">
                  {activeSlide.title}
                </p>
                <p className="max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
                  {activeSlide.body}
                </p>
                {activeSlide.footnote ? (
                  <p className="text-xs text-gold">{activeSlide.footnote}</p>
                ) : null}
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gold">
                  Presenter Notes
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-200">{activeSlide.notes}</p>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setActiveIndex((prev) =>
                      prev === null ? null : (prev - 1 + slides.length) % slides.length,
                    )
                  }
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold text-white transition-all duration-200 hover:border-gold/50 hover:bg-white/20 hover:text-gold active:scale-[0.98]"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                  Prev
                </button>
                <div className="flex items-center gap-1.5">
                  {slides.map((slide, index) => (
                    <button
                      key={slide.label}
                      type="button"
                      aria-label={`Go to slide ${index + 1}`}
                      aria-current={index === activeIndex}
                      onClick={() => setActiveIndex(index)}
                      className={`h-1.5 rounded-full transition-all duration-200 ${
                        index === activeIndex ? 'w-6 bg-gold' : 'w-1.5 bg-white/25 hover:bg-white/50'
                      }`}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setActiveIndex((prev) => (prev === null ? null : (prev + 1) % slides.length))
                  }
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold text-white transition-all duration-200 hover:border-gold/50 hover:bg-white/20 hover:text-gold active:scale-[0.98]"
                >
                  Next
                  <ChevronRightIcon className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}