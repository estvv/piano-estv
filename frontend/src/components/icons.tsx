// Stroke icons in the style of quizz-estv and music-estv (24px grid, 1.75
// stroke, round caps).
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

type IconProps = { className?: string };
const cls = (className?: string) => className ?? 'w-5 h-5';

export const LogoutIcon = ({ className }: IconProps) => (
  <svg {...base} className={cls(className)}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4" /></svg>
);
export const GearIcon = ({ className }: IconProps) => (
  <svg {...base} className={cls(className)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
);
export const UserIcon = ({ className }: IconProps) => (
  <svg {...base} className={cls(className)}><circle cx="12" cy="8" r="4" /><path d="M4 20.5a8 8 0 0 1 16 0" /></svg>
);
export const LockIcon = ({ className }: IconProps) => (
  <svg {...base} className={cls(className)}><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
);
export const ChevronDownIcon = ({ className }: IconProps) => (
  <svg {...base} className={cls(className)}><path d="m6 9 6 6 6-6" /></svg>
);
export const PencilIcon = ({ className }: IconProps) => (
  <svg {...base} className={cls(className)}><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>
);
export const PlusIcon = ({ className }: IconProps) => (
  <svg {...base} className={cls(className)}><path d="M12 5v14M5 12h14" /></svg>
);
export const EyeIcon = ({ className }: IconProps) => (
  <svg {...base} className={cls(className)}><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" /><circle cx="12" cy="12" r="3" /></svg>
);
export const RepeatIcon = ({ className }: IconProps) => (
  <svg {...base} className={cls(className)}><path d="M17 2.5 20.5 6 17 9.5" /><path d="M3.5 11V9a3 3 0 0 1 3-3h14" /><path d="M7 21.5 3.5 18 7 14.5" /><path d="M20.5 13v2a3 3 0 0 1-3 3h-14" /></svg>
);
export const ShuffleIcon = ({ className }: IconProps) => (
  <svg {...base} className={cls(className)}><path d="M3.5 7h3.2a4 4 0 0 1 3.3 1.8l4 6.4a4 4 0 0 0 3.3 1.8h3.2M17.5 13.5l3.5 3.5-3.5 3.5M3.5 17h3.2a4 4 0 0 0 3.3-1.8l4-6.4A4 4 0 0 1 17.3 7h3.2M17.5 3.5 21 7l-3.5 3.5" /></svg>
);
export const ArrowRightIcon = ({ className }: IconProps) => (
  <svg {...base} className={cls(className)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const PlayIcon = ({ className }: IconProps) => (
  <svg {...base} className={cls(className)}><path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.2 4.1a.8.8 0 0 0-1.2.7Z" /></svg>
);
export const CheckIcon = ({ className }: IconProps) => (
  <svg {...base} className={cls(className)}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
);
