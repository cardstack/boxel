// Shared TypeScript vocabulary for `<Popover>` — the kind/axis unions plus
// the kind→glyph / kind→label maps and the escalation-priority resolver.
// Pulled out of the component so hosts, the playground, and the popover
// state machine import ONE canonical source instead of reaching into the
// `.gts`. Pure types + data; no Glimmer, no DOM.

export type PopoverKind = 'details' | 'edit' | 'tools';

export type PopoverAnchoring = 'beside' | 'overlay' | 'center';

export type PopoverSize = 'compact' | 'comfortable' | 'spacious' | 'auto';

export type PopoverBackdrop = 'none' | 'tint' | 'blur' | 'dim';

export type PopoverElevation = 'flat' | 'raised' | 'elevated' | 'floating';

export type PopoverKeyboardModel = 'pick' | 'edit';

/** Glyph for each kind — the SINGLE source of truth. Hosts and
 *  playgrounds import this instead of hard-coding which icon means what:
 *  ✎ edit, ⓘ details, ⋯ tools. */
export const POPOVER_KIND_GLYPHS: Record<PopoverKind, string> = {
  details: 'ⓘ',
  edit: '✎',
  tools: '⋯',
};

/** Human label for each kind — paired with POPOVER_KIND_GLYPHS so the
 *  glyph and its name never drift apart. */
export const POPOVER_KIND_LABELS: Record<PopoverKind, string> = {
  details: 'Details',
  edit: 'Edit',
  tools: 'Tools',
};

/** Escalation ladder — the order the corner glyph prefers when a
 *  contract offers more than one target. Lifting a passive surface up
 *  to an EDITABLE one is the most common escalation, so 'edit' wins;
 *  'tools' is the heavier action surface; 'details' is the passive
 *  fallback. The single highest-priority available target drives the
 *  glyph, the aria-label, AND the click action — so the icon always
 *  tells the truth about where the click goes. */
export const POPOVER_ESCALATION_PRIORITY: readonly PopoverKind[] = [
  'edit',
  'tools',
  'details',
];

/** Resolve which kind a corner glyph escalates to, given the offered
 *  targets (already filtered of the current kind). Highest-priority
 *  wins; falls back to the first offered. Shared so the component and
 *  any host agree on the destination without re-implementing it. */
export function resolvePopoverEscalationTarget(
  targets: PopoverKind[],
): PopoverKind | undefined {
  return (
    POPOVER_ESCALATION_PRIORITY.find((k) => targets.includes(k)) ?? targets[0]
  );
}
