/**
 * Refero-style glassmorphism HUD tokens and formatters for the Mission Globe.
 *
 * Pure, framework-free helpers so the React overlay and any future consumer
 * share one source of truth for the top counter, the interaction hint, and the
 * bottom preview card. Mirrors the tokens in `docs/design/REFERO_MOTION_SPEC.md`.
 */

/** Glass panel base classes (dark obsidian, blur, white text). */
export const HUD_GLASS_PANEL =
  'backdrop-blur-xl bg-slate-900/65 border border-white/12 text-white shadow-[0_8px_32px_0_rgba(0,0,0,0.45)]';

/** Top-floating counter badge classes. */
export const HUD_COUNTER_BADGE =
  'inline-flex items-center gap-2 rounded-full border border-white/12 bg-slate-900/65 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-xl';

/** Interaction hint classes. */
export const HUD_HINT = 'text-xs font-medium text-slate-300/80';

/** Bottom preview card (dark glass sheet). */
export const HUD_PREVIEW_CARD = HUD_GLASS_PANEL;

export interface HudSummary {
  gatheringCount: number;
  cityCount: number;
  selectedId: string | null;
  selectedName: string;
  selectedCity: string;
}

/** Formats the top-bar gathering + city counter text. */
export function formatGatheringCounter(gatheringCount: number, cityCount: number): string {
  return `${gatheringCount} ${gatheringCount === 1 ? 'Gathering' : 'Gatherings'} · ${cityCount} ${cityCount === 1 ? 'City' : 'Cities'}`;
}

/** Formats the interaction hint. */
export const INTERACTION_HINT = 'Drag to spin \u00b7 Pinch to zoom';

/** Formats the bottom card ambassador label. */
export function formatAmbassadorName(firstName: string): string {
  return firstName || 'Ambassador';
}
