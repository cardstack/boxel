// Pure helpers shared by the Talent & Resource Tracker modules.

export interface StateColor {
  bg: string;
  fg: string;
  ring: string;
}

export const DEFAULT_STATE_COLOR: StateColor = {
  bg: '#f1f5f9',
  fg: '#334155',
  ring: '#94a3b8',
};

// Generic lookup helper — the color maps themselves live next to the card
// that owns the state (employee.gts, candidate.gts, meeting.gts), not here.
export function stateColorOf(
  map: Record<string, StateColor>,
  key?: string | null,
): StateColor {
  return (key && map[key]) || DEFAULT_STATE_COLOR;
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

export type DurationUnit = 'minutes' | 'hours' | 'days' | 'weeks' | 'months';

export const DURATION_UNITS: DurationUnit[] = [
  'minutes',
  'hours',
  'days',
  'weeks',
  'months',
];

const DAYS_PER_UNIT: Record<DurationUnit, number> = {
  minutes: 1 / (24 * 60),
  hours: 1 / 24,
  days: 1,
  weeks: 7,
  months: 30,
};

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
