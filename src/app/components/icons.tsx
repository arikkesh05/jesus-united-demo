interface IconProps {
  className?: string;
}

const baseProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function MapPinIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}

export function UserIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

export function ChatIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H9l-6 3 1.6-5A8.5 8.5 0 1 1 21 11.5Z" />
    </svg>
  );
}

export function MailIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 7.5 8.5 5.5 8.5-5.5" />
    </svg>
  );
}

export function DirectionsIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="m3 11 18-8-8 18-2-8-8-2Z" />
    </svg>
  );
}

export function BookIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5Z" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5Z" />
    </svg>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function ListIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

export function CopyIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

export function PrinterIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M7 9V4h10v5" />
      <rect x="4" y="9" width="16" height="7" rx="2" />
      <path d="M7 14h10v6H7z" />
    </svg>
  );
}

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="m5.5 9.5 6.5 6.5 6.5-6.5" />
    </svg>
  );
}

export function PlayIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" />
    </svg>
  );
}

export function PauseIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <rect x="7" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" />
      <rect
        x="13.5"
        y="5.5"
        width="3.5"
        height="13"
        rx="1"
        fill="currentColor"
      />
    </svg>
  );
}

/** Rewind-to-start transport glyph: a bar plus a left-pointing triangle. */
export function RestartIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path
        d="M12 5.5a6.5 6.5 0 1 0 6.32 8.06"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path d="M12 2.6 8.1 5.5 12 8.4V2.6Z" fill="currentColor" />
    </svg>
  );
}

export function VolumeIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" />
      <path d="M15.5 9.5a4 4 0 0 1 0 5" />
      <path d="M18 7a7.5 7.5 0 0 1 0 10" />
    </svg>
  );
}

export function VolumeOffIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" />
      <path d="m16 10 4 4M20 10l-4 4" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function UsersIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 5a3.5 3.5 0 0 1 0 6.5M17.5 14.5a6.5 6.5 0 0 1 4 5.5" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function GlobeIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.7 2.5 2.7 14.5 0 17M12 3.5c-2.7 2.5-2.7 14.5 0 17" />
    </svg>
  );
}

export function HeartIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M12 20.5S3.5 15.4 3.5 9.6A4.6 4.6 0 0 1 12 6.9a4.6 4.6 0 0 1 8.5 2.7c0 5.8-8.5 10.9-8.5 10.9Z" />
    </svg>
  );
}

export function HandHeartIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M12 8.5s-4-2.5-4-5.1a2.3 2.3 0 0 1 4-1.3 2.3 2.3 0 0 1 4 1.3c0 2.6-4 5.1-4 5.1Z" />
      <path d="M12 10.5v3.2a2.3 2.3 0 0 1-2.3 2.3H8" />
      <path d="M4 16.5l4.2-2.6a2.5 2.5 0 0 1 2.8.1l2.6 1.8a2 2 0 0 1-2.3 3.3l-2.6-1.6" />
      <path d="M11.5 20.8a2.6 2.6 0 0 0 2.9.2l4.3-2.6" />
    </svg>
  );
}

export function BellIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M18 9a6 6 0 1 0-12 0c0 5.5-2.5 7-2.5 7h17S18 14.5 18 9Z" />
      <path d="M10.3 20a2 2 0 0 0 3.4 0" />
    </svg>
  );
}

export function ShareIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M12 15.5V4.2" />
      <path d="M8.4 7.6 12 4l3.6 3.6" />
      <path d="M5.5 13.8v4.7a1.9 1.9 0 0 0 1.9 1.9h9.2a1.9 1.9 0 0 0 1.9-1.9v-4.7" />
    </svg>
  );
}

/** Morning consecration — the first-light rhythm of the formation compass. */
export function SunIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.6v2.2" />
      <path d="M12 19.2v2.2" />
      <path d="M2.6 12h2.2" />
      <path d="M19.2 12h2.2" />
      <path d="m5.4 5.4 1.6 1.6" />
      <path d="m17 17 1.6 1.6" />
      <path d="m18.6 5.4-1.6 1.6" />
      <path d="m7 17-1.6 1.6" />
    </svg>
  );
}

/** Midday breath — the silence-and-worship pause at the sixth hour. */
export function WindIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M3.5 8.5h8.2a2.6 2.6 0 1 0-2.6-2.6" />
      <path d="M3.5 12.5h12.9a2.6 2.6 0 1 1-2.6 2.6" />
      <path d="M3.5 16.5h6.4a2.2 2.2 0 1 1-2.2 2.2" />
    </svg>
  );
}

/** Grace Season / rest — counters pause, no streak is broken. */
export function MoonIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4a8.6 8.6 0 1 0 10.2 10.2Z" />
    </svg>
  );
}

/** The private journal — this device only, never the wall. */
export function LockIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <rect x="4.8" y="10.4" width="14.4" height="9.4" rx="2.2" />
      <path d="M8.4 10.4V7.8a3.6 3.6 0 0 1 7.2 0v2.6" />
      <path d="M12 14v2.2" />
    </svg>
  );
}

/** The rhythm count — a kept rhythm, never a punitive streak. */
export function FlameIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M12 3.4c2.4 2.6 4.2 4.5 4.2 7.2a4.2 4.2 0 0 1-8.4 0c0-1 .3-1.9.8-2.7.8.9 1.6 1.1 2.1.8.9-.4 1.1-1.6 1.3-5.3Z" />
      <path d="M12 20.4a2.6 2.6 0 0 0 2.6-2.6c0-1.5-1.2-2.3-2.6-3.9-1.4 1.6-2.6 2.4-2.6 3.9a2.6 2.6 0 0 0 2.6 2.6Z" />
    </svg>
  );
}
