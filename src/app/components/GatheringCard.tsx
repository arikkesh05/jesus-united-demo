import {
  CalendarIcon,
  ChatIcon,
  DirectionsIcon,
  MailIcon,
  MapPinIcon,
  UserIcon,
} from '@/app/components/icons';
import type { Gathering } from '@/lib/types';

interface GatheringCardProps {
  gathering: Gathering;
}

function buildWhatsAppHref(gathering: Gathering): string {
  const greeting = `Hi ${gathering.leader_name}, I found ${gathering.name} on JesusUnited and would love to know more about joining your gathering.`;
  return `https://wa.me/?text=${encodeURIComponent(greeting)}`;
}

function buildMapsHref(gathering: Gathering): string {
  const { latitude, longitude, address } = gathering;

  if (latitude !== undefined && longitude !== undefined) {
    return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function buildEmailHref(gathering: Gathering): string | null {
  if (!gathering.contact_email) return null;
  const subject = encodeURIComponent(`Question about ${gathering.name}`);
  return `mailto:${gathering.contact_email}?subject=${subject}`;
}

const secondaryLinkClass =
  'inline-flex items-center justify-center gap-1.5 rounded-full border border-sand bg-white px-3 py-2 text-xs font-bold text-espresso transition hover:border-gold/50 hover:bg-pill';

/** Formats a PostGIS-computed `distance_meters` into a short imperial badge. */
function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '';
  return `${(meters / 1609.34).toFixed(1)} mi away`;
}

export default function GatheringCard({ gathering }: GatheringCardProps) {
  const emailHref = buildEmailHref(gathering);
  const distanceLabel =
    gathering.distance_meters !== undefined ? formatDistance(gathering.distance_meters) : '';

  return (
    <article className="flex w-full flex-col rounded-3xl border border-sand bg-white p-5 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-gold/40 hover:shadow-lift">
      <h3 className="text-base font-bold leading-6 text-espresso">{gathering.name}</h3>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-sand bg-pill px-2.5 py-1 text-xs font-bold text-pill-ink">
          <CalendarIcon className="h-3.5 w-3.5" />
          {gathering.meeting_time}
        </span>
        {distanceLabel ? (
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-sand bg-pill px-2.5 py-1 text-xs font-bold text-pill-ink">
            <MapPinIcon className="h-3.5 w-3.5" />
            {distanceLabel}
          </span>
        ) : null}
      </div>

      {gathering.description ? (
        <p className="mt-3 text-sm leading-6 text-muted">{gathering.description}</p>
      ) : null}

      <dl className="mt-3 space-y-1.5 text-sm text-espresso/80">
        <div className="flex items-start gap-2">
          <dt className="sr-only">Address</dt>
          <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
          <dd className="leading-6">{gathering.address}</dd>
        </div>
        <div className="flex items-start gap-2">
          <dt className="sr-only">Hosted by</dt>
          <UserIcon className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
          <dd className="leading-6">{gathering.leader_name}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-1 flex-col justify-end gap-2">
        <a
          href={buildWhatsAppHref(gathering)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-gold px-4 py-2.5 text-sm font-bold text-espresso transition hover:bg-gold-deep hover:shadow-md"
        >
          <ChatIcon className="h-4 w-4" />
          Connect via WhatsApp
        </a>

        <div className="grid grid-cols-2 gap-2">
          {emailHref ? (
            <a href={emailHref} className={secondaryLinkClass}>
              <MailIcon className="h-4 w-4" />
              Email
            </a>
          ) : null}
          <a
            href={buildMapsHref(gathering)}
            target="_blank"
            rel="noopener noreferrer"
            className={secondaryLinkClass}
          >
            <DirectionsIcon className="h-4 w-4" />
            Google Maps
          </a>
        </div>
      </div>
    </article>
  );
}