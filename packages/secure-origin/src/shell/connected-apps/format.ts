// How the Connected apps page words its connections: which app each belongs
// to, what it may do, and its dates. Every function takes the current time as
// an argument, so the page reads the clock in one place and tests pin it.
import type { AppName } from '../../security/oauth-provider.ts';
import type { Connection } from '../../security/oauth-provider-connections.ts';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const ACCESS = new Intl.ListFormat('en', { type: 'conjunction' });
const DAY_MONTH = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
});
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

// What a connection may do at a resource, from the registry's short labels:
// "Read", or "Read and change".
export function accessLine(labels: string[]): string {
  return ACCESS.format(
    labels.map((label, i) => (i === 0 ? label : label.toLowerCase())),
  );
}

// The calendar days from `then` to `now` in the browser's time zone: 0 for
// the same day, 1 for the day before.
function daysBetween(then: Date, now: Date): number {
  let start = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((start(now) - start(then)) / (24 * HOUR));
}

// A day as the page writes it, "28 Oct", with its year when it isn't this
// one's.
export function dayLabel(iso: string, now: Date): string {
  let date = new Date(iso);
  return date.getFullYear() === now.getFullYear()
    ? DAY_MONTH.format(date)
    : DAY_MONTH_YEAR.format(date);
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

// "Last used …": how long ago within the week, the day before that, or
// "Never used".
export function lastUsedLine(iso: string | null, now: Date): string {
  if (iso === null) {
    return 'Never used';
  }
  let then = new Date(iso);
  let ago = Math.max(0, now.getTime() - then.getTime());
  if (ago < MINUTE) {
    return 'Last used just now';
  }
  if (ago < HOUR) {
    return `Last used ${plural(Math.floor(ago / MINUTE), 'minute')} ago`;
  }
  let days = daysBetween(then, now);
  if (days <= 0) {
    return `Last used ${plural(Math.floor(ago / HOUR), 'hour')} ago`;
  }
  if (days === 1) {
    return 'Last used yesterday';
  }
  if (days < 7) {
    return `Last used ${days} days ago`;
  }
  return `Last used ${dayLabel(iso, now)}`;
}

// "Connected today", "Connected yesterday" or "Connected 28 Oct".
export function connectedLine(iso: string, now: Date): string {
  let days = daysBetween(new Date(iso), now);
  if (days <= 0) {
    return 'Connected today';
  }
  if (days === 1) {
    return 'Connected yesterday';
  }
  return `Connected ${dayLabel(iso, now)}`;
}

// "Ends in 45 min" within the hour, as a connection that isn't kept does
// from the start; then "Ends today", "Ends tomorrow" or "Ends 27 Nov".
export function endsLine(iso: string, now: Date): string {
  let left = new Date(iso).getTime() - now.getTime();
  if (left < HOUR) {
    return `Ends in ${Math.max(1, Math.ceil(left / MINUTE))} min`;
  }
  let days = -daysBetween(new Date(iso), now);
  if (days <= 0) {
    return 'Ends today';
  }
  if (days === 1) {
    return 'Ends tomorrow';
  }
  return `Ends ${dayLabel(iso, now)}`;
}

// Whether a connection has ended by `now`, though the list still has it.
export function hasEnded(connection: Connection, now: Date): boolean {
  return Date.parse(connection.endsAt) <= now.getTime();
}

// The app's connections, under the name it's shown by.
export interface AppGroup {
  key: string;
  app: AppName;
  connections: Connection[];
}

// The key a connection's app is grouped by: everything the page shows of the
// app, so two connections in one group always look the same.
function appKey(app: AppName): string {
  return JSON.stringify([app.kind, app.shown, app.claimedName ?? '']);
}

function newestFirst(a: Connection, b: Connection): number {
  return Date.parse(b.connectedAt) - Date.parse(a.connectedAt);
}

// The connections grouped by app, the app with the newest connection first,
// and each app's connections newest first.
export function groupByApp(connections: Connection[]): AppGroup[] {
  let groups = new Map<string, AppGroup>();
  for (let connection of [...connections].sort(newestFirst)) {
    let key = appKey(connection.app);
    let group = groups.get(key);
    if (group) {
      group.connections.push(connection);
    } else {
      groups.set(key, {
        key,
        app: connection.app,
        connections: [connection],
      });
    }
  }
  return [...groups.values()];
}
