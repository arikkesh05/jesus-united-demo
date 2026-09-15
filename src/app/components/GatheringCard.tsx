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
  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100';

export default function GatheringCard({ gathering }: GatheringCardProps) {
  const emailHref = buildEmailHref(gathering);

  return (
    <article className="flex w-full flex-col rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-base font-semibold leading-6 text-slate-900">{gathering.name}</h3>

      <span className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700">
        <CalendarIcon className="h-3.5 w-3.5" />
        {gathering.meeting_time}
      </span>

      {gathering.description ? (
        <p className="mt-3 text-sm leading-6 text-slate-600">{gathering.description}</p>
      ) : null}

      <dl className="mt-3 space-y-1.5 text-sm text-slate-700">
        <div className="flex items-start gap-2">
          <dt className="sr-only">Address</dt>
          <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <dd className="leading-6">{gathering.address}</dd>
        </div>
        <div className="flex items-start gap-2">
          <dt className="sr-only">Hosted by</dt>
          <UserIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <dd className="leading-6">{gathering.leader_name}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-1 flex-col justify-end gap-2">
        <a
          href={buildWhatsAppHref(gathering)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800"
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