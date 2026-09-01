// Pure helpers shared by the Talent & Resource Tracker modules.

export interface StateColor {
  bg: string;
  fg: string;
  ring: string;
}

// A status hue has no semantic theme token — the shadcn set ships only
// --destructive — so these come from boxel's design tokens instead of literals.
// Boxel ships no orange and no plain blue, so those two are mixed from the
// tokens it does ship: that keeps every hue inside the design system, where a
// single definition can correct it globally.
const HUE = {
  green: 'var(--boxel-success)',
  red: 'var(--boxel-danger)',
  amber: 'var(--boxel-warning)',
  orange: 'color-mix(in oklch, var(--boxel-warning) 62%, var(--boxel-danger))',
  teal: 'var(--boxel-dark-teal)',
  purple: 'var(--boxel-purple)',
  blue: 'color-mix(in oklch, var(--boxel-purple) 55%, var(--boxel-highlight))',
  pink: 'color-mix(in oklch, var(--boxel-danger) 60%, var(--boxel-purple))',
  slate: 'var(--muted-foreground, var(--boxel-450))',
} as const;

export type Hue = keyof typeof HUE;

// One hue in, a checked pair out. The fill and the text derive from the SAME
// hue and from the card's own pair, so they move together: a linked theme flips
// --card/--card-foreground and both sides follow, and no combination can come
// apart the way two separately-stored colours can.
//
// 14% / 38% are not arbitrary. Percentages were computed against every hue
// above, and 38% is the highest that still clears 4.5:1 for the palest of them
// (boxel's mint at 45% gives only 4.19:1 — the number quoted for body text
// elsewhere is unsafe here). Raising the hue share LOWERS contrast, because it
// is the card foreground in the mix that supplies the darkness.
export function stateColor(hue: Hue): StateColor {
  let h = HUE[hue];
  // `in oklab`, NOT `in oklch`: oklch interpolates the HUE ANGLE, and Chrome
  // resolves an achromatic endpoint's hue as 0 (red) — so on a light theme
  // where --card is pure white, `green 14% + white 86%` lands at hue ~21 and
  // every "green" chip renders PINK (measured live, 2026-08-31). oklab is
  // rectangular, has no hue coordinate to rotate, and mixes these correctly.
  return {
    bg: `color-mix(in oklab, ${h} 14%, var(--card, var(--boxel-light)))`,
    fg: `color-mix(in oklab, ${h} 38%, var(--card-foreground, var(--boxel-dark)))`,
    ring: h,
  };
}

export const DEFAULT_STATE_COLOR: StateColor = stateColor('slate');

// Generic lookup helper — the color maps themselves live next to the card
// that owns the state (employee.gts, candidate.gts, meeting.gts), not here.
export function stateColorOf(
  map: Record<string, StateColor>,
  key?: string | null,
): StateColor {
  return (key && map[key]) || DEFAULT_STATE_COLOR;
}

// Compact mode only kicks in above $1,000 — below that, Math.round(n/1000)
// collapses an hourly rate like $45 down to "$0k", which is worse than the
// full number. Compact and full formatting always share this one function
// so the same dollar amount never renders two different ways across cards.
export function formatMoney(
  n?: number | null,
  opts?: { compact?: boolean },
): string | undefined {
  if (n == null) {
    return undefined;
  }
  if (opts?.compact && Math.abs(n) >= 1000) {
    return `$${Math.round(n / 1000)}k`;
  }
  return `$${n.toLocaleString()}`;
}

export function initialsOf(name?: string | null): string {
  if (!name) {
    return '?';
  }
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export type DurationUnit =
  | 'minutes'
  | 'hours'
  | 'days'
  | 'weeks'
  | 'months'
  | 'years';

export const DURATION_UNITS: DurationUnit[] = [
  'minutes',
  'hours',
  'days',
  'weeks',
  'months',
  'years',
];

const DAYS_PER_UNIT: Record<DurationUnit, number> = {
  minutes: 1 / (24 * 60),
  hours: 1 / 24,
  days: 1,
  weeks: 7,
  months: 30,
  years: 365,
};

// Pick the unit that reads naturally for a span measured in days. A tenure of
// 1303 days is technically correct and useless — nobody thinks in four-digit
// day counts. Short spans stay in days because that IS how recruiters talk
// about them ("31 days to hire").
export function normalizedDuration(days?: number | null):
  | {
      value: number;
      unit: DurationUnit;
    }
  | undefined {
  if (days == null || !Number.isFinite(days)) {
    return undefined;
  }
  if (days >= 365) {
    return { value: Math.round((days / 365) * 10) / 10, unit: 'years' };
  }
  if (days >= 60) {
    return { value: Math.round((days / 30) * 10) / 10, unit: 'months' };
  }
  return { value: Math.round(days), unit: 'days' };
}

export function durationInDays(
  value?: number | null,
  unit?: string | null,
): number {
  if (value == null || !Number.isFinite(value)) {
    return 0;
  }
  let perUnit = DAYS_PER_UNIT[(unit ?? 'days') as DurationUnit] ?? 1;
  return value * perUnit;
}

export function durationLabel(
  value?: number | null,
  unit?: string | null,
): string {
  if (value == null || !Number.isFinite(value)) {
    return '—';
  }
  let u = (unit ?? 'days') as DurationUnit;
  let rounded = Math.round(value * 10) / 10;
  let singular: Record<DurationUnit, string> = {
    minutes: 'min',
    hours: rounded === 1 ? 'hour' : 'hours',
    days: rounded === 1 ? 'day' : 'days',
    weeks: rounded === 1 ? 'week' : 'weeks',
    months: rounded === 1 ? 'month' : 'months',
    years: rounded === 1 ? 'year' : 'years',
  };
  return `${rounded} ${singular[u]}`;
}

export function durationAtomLabel(
  value?: number | null,
  unit?: string | null,
): string {
  if (value == null || !Number.isFinite(value)) {
    return '—';
  }
  let abbrev: Record<DurationUnit, string> = {
    minutes: 'm',
    hours: 'h',
    days: 'd',
    weeks: 'w',
    months: 'mo',
    years: 'y',
  };
  let rounded = Math.round(value * 10) / 10;
  return `${rounded}${abbrev[(unit ?? 'days') as DurationUnit] ?? 'd'}`;
}

export function daysBetween(
  from?: Date | string | null,
  to?: Date | string | null,
): number | undefined {
  if (!from) {
    return undefined;
  }
  let start = new Date(from);
  let end = to ? new Date(to) : new Date();
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return undefined;
  }
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
}

export function sameDay(a?: Date | null, b?: Date | null): boolean {
  if (!a || !b) {
    return false;
  }
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export interface CalendarDay {
  date: Date;
  dayNumber: number;
  inMonth: boolean;
  isToday: boolean;
}

// 6 rows x 7 columns of days covering the cursor's month, weeks starting Sunday.
export function monthGrid(cursor: Date): CalendarDay[][] {
  let first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  let start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  let today = new Date();
  let weeks: CalendarDay[][] = [];
  let day = new Date(start);
  for (let w = 0; w < 6; w++) {
    let week: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({
        date: new Date(day),
        dayNumber: day.getDate(),
        inMonth: day.getMonth() === cursor.getMonth(),
        isToday: sameDay(day, today),
      });
      day.setDate(day.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export function monthTitle(cursor: Date): string {
  return cursor.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

export interface OrgNode<T> {
  item: T;
  children: OrgNode<T>[];
}

// Builds a forest from a flat list using a manager edge; cycle-safe.
export function buildOrgTree<T extends { id?: string }>(
  items: T[],
  managerIdOf: (item: T) => string | undefined,
): OrgNode<T>[] {
  let nodes = new Map<string, OrgNode<T>>();
  let list = items.filter((item) => item?.id);
  for (let item of list) {
    nodes.set(item.id!, { item, children: [] });
  }
  let roots: OrgNode<T>[] = [];
  for (let item of list) {
    let node = nodes.get(item.id!)!;
    let managerId = managerIdOf(item);
    let parent = managerId ? nodes.get(managerId) : undefined;
    if (parent && parent !== node && !isDescendant(node, parent)) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function isDescendant<T>(
  candidateAncestor: OrgNode<T>,
  node: OrgNode<T>,
): boolean {
  for (let child of candidateAncestor.children) {
    if (child === node || isDescendant(child, node)) {
      return true;
    }
  }
  return false;
}

// Count only the links whose target still exists. Deleting a card does not
// rewrite the cards linking to it, so a linksToMany keeps the dead reference:
// the slot stays in the array (length is unchanged) but reads as `undefined`.
// Counting raw `length` therefore reports members/skills/interviewers that are
// no longer there — a number the user can see is wrong.
export function liveCount(links: unknown[] | null | undefined): number {
  return (links ?? []).filter(Boolean).length;
}
