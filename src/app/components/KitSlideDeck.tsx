import type { PulpitKit } from '@/lib/types';

interface KitSlideDeckProps {
  kit: PulpitKit;
}

interface SlidePreview {
  label: string;
  title: string;
  body: string;
  footnote?: string;
}

/** Derives 3-4 deck slides from the kit content (theme, scripture, points, application). */
function buildSlides(kit: PulpitKit): SlidePreview[] {
  const slides: SlidePreview[] = [
    {
      label: 'Theme Slide',
      title: kit.title,
      body: kit.theme || kit.series_name || 'Sunday Gathering',
    },
  ];

  if (kit.scripture_passages.length > 0) {
    slides.push({
      label: 'Core Scripture',
      title: kit.scripture_passages[0],
      body: kit.key_quote ?? 'Read the passage together before the message.',
      footnote: kit.scripture_passages.slice(1).join('  ·  ') || undefined,
    });
  }

  // One point slide keeps the deck at 4 cards so the application slide always fits.
  kit.outline.slice(0, 1).forEach((point, index) => {
    slides.push({
      label: `Point ${index + 1}`,
      title: point.section,
      body: point.subtext || 'Walking through this movement of the text.',
    });
  });

  slides.push({
    label: 'Application Challenge',
    title: 'This Week',
    body:
      kit.call_to_action ??
      kit.talking_points[kit.talking_points.length - 1] ??
      'Invite the congregation to put the passage into practice.',
  });

  return slides.slice(0, 4);
}

export default function KitSlideDeck({ kit }: KitSlideDeckProps) {
  const slides = buildSlides(kit);

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {slides.map((slide, index) => (
        <figure
          key={slide.label}
          className="flex flex-col overflow-hidden rounded-2xl border border-sand bg-white shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-gold/40 hover:shadow-lift"
        >
          <div className="flex items-center justify-between gap-2 border-b border-sand bg-pill/60 px-4 py-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-pill-ink">
              {slide.label}
            </span>
            <span className="text-[10px] font-medium text-muted">Slide {index + 1}</span>
          </div>
          <figcaption className="flex flex-1 flex-col gap-2 p-5">
            <p className="text-lg font-bold leading-6 text-espresso">{slide.title}</p>
            <p className="text-sm leading-6 text-muted">{slide.body}</p>
            {slide.footnote ? (
              <p className="mt-auto pt-2 text-xs text-muted">{slide.footnote}</p>
            ) : null}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}