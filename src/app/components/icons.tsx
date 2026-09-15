interface IconProps {
  className?: string;
}

const baseProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
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