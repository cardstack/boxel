// A query's time zone: the IANA zone (`America/New_York`) whose calendar a
// query's dates are reckoned in. It decides calendar boundaries only — where
// "today", "this week" and a day bucket start and end — and never what a
// stored value means: a date-time with `Z` or an offset is that instant, one
// that names no zone is read as UTC, and a date (`yyyy-MM-dd`) is a calendar
// day, never shifted. The default, `UTC`, is what every query had before the
// member existed, and in it every function here gives what the UTC-only code
// gave.
//
// One module for the card engine and the log engine, so "today in New York"
// is one answer wherever it is asked:
//
// - `assertTimeZone` / `canonicalTimeZone`: is a name a zone, and its one
//   spelling (`america/new_york` → `America/New_York`, `Etc/UTC` → `UTC`).
// - `resolveRelativeDateInZone`: `now-1w/w` as an instant, rounded on the
//   zone's calendar (a day may be 23 or 25 hours).
// - `localDateInZone`, `wallClockMs`, `instantOfWallClock`: an instant's
//   calendar day and wall time in the zone, and back.
// - `pgLocalTimestamp`, `pgBucketLabel`: the SQL for a value's wall time and
//   its day/week/month/year bucket in the zone.
// - `toWallClock`: a record's date-times as the zone's wall time, for an
//   evaluator (BXL on a thread) that reckons dates as UTC civil time.
// - `clockInZone` / `zoneOfClock`: the query's one instant, carrying the zone
//   its calendar math uses, so every place that already receives the clock
//   reading (`queryNow`) reckons in the query's zone with no other plumbing.
import { InvalidQueryError } from './invalid-query-error.ts';

export const DEFAULT_TIME_ZONE = 'UTC';

// An IANA name: a letter first, so an offset (`+05:00`, which `Intl` also
// takes) is refused; a query names a place, whose offset changes with DST.
const ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/;

const formatters = new Map<string, Intl.DateTimeFormat>();
const canonical = new Map<string, string | undefined>();

// The zone's one spelling, or undefined when `name` is no IANA zone.
export function canonicalTimeZone(name: unknown): string | undefined {
  if (typeof name !== 'string' || !ZONE_NAME.test(name)) return undefined;
  if (canonical.has(name)) return canonical.get(name);
  let resolved: string | undefined;
  try {
    resolved = new Intl.DateTimeFormat('en-US', {
      timeZone: name,
    }).resolvedOptions().timeZone;
    // `Etc/UTC`, `Etc/GMT`, `GMT`, `UCT`, `Zulu`… are all UTC
    if (
      /^(Etc\/)?(UTC|UCT|GMT|Universal|Zulu|Greenwich)(0|\+0|-0)?$/i.test(
        resolved,
      )
    ) {
      resolved = DEFAULT_TIME_ZONE;
    }
  } catch {
    resolved = undefined;
  }
  if (canonical.size > 1000) canonical.clear();
  canonical.set(name, resolved);
  return resolved;
}

// `name` as a zone's one spelling, or `invalid-value` naming it.
export function assertTimeZone(name: unknown, member = 'timeZone'): string {
  let zone = canonicalTimeZone(name);
  if (!zone) {
    let shown: string;
    try {
      shown = JSON.stringify(
        typeof name === 'string' ? name.slice(0, 80) : name,
      );
    } catch {
      shown = 'that value';
    }
    throw new InvalidQueryError(
      `${member}: ${shown ?? String(name)} is not a time zone: name an IANA zone, such as "America/New_York" or "UTC"`,
      'invalid-value',
    );
  }
  return zone;
}

export function isUtcZone(zone: string | undefined): boolean {
  return zone === undefined || zone === DEFAULT_TIME_ZONE;
}

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      era: 'short',
    });
    formatters.set(zone, f);
  }
  return f;
}

// The instant's wall time in the zone, as epoch milliseconds read as UTC
// civil time: `new Date(wallClockMs(t, zone)).getUTCHours()` is the hour on
// a clock in that zone.
export function wallClockMs(instant: Date | number, zone: string): number {
  let t = typeof instant === 'number' ? instant : instant.getTime();
  if (isUtcZone(zone) || !Number.isFinite(t)) return t;
  let parts: Record<string, string> = {};
  for (let p of formatterFor(zone).formatToParts(new Date(t))) {
    parts[p.type] = p.value;
  }
  let year = Number(parts.year);
  if (parts.era === 'BC' || parts.era === 'B') year = 1 - year;
  let ms = ((t % 1000) + 1000) % 1000;
  let wall = new Date(0);
  wall.setUTCFullYear(year, Number(parts.month) - 1, Number(parts.day));
  wall.setUTCHours(
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
    ms,
  );
  return wall.getTime();
}

// The zone's offset from UTC at an instant, in milliseconds (New York in
// winter: -5 h).
export function zoneOffsetMs(instant: Date | number, zone: string): number {
  let t = typeof instant === 'number' ? instant : instant.getTime();
  return wallClockMs(t, zone) - t;
}

// The instant a wall time in the zone names. A wall time a DST change
// repeats (01:30 on the night clocks go back) is its earlier instant; one a
// change skips (02:30 on the night clocks go forward) is read as the instant
// that far past the change (03:30), as Temporal's `compatible` does.
export function instantOfWallClock(wallMs: number, zone: string): number {
  if (isUtcZone(zone) || !Number.isFinite(wallMs)) return wallMs;
  let before = zoneOffsetMs(wallMs - 86_400_000, zone);
  let after = zoneOffsetMs(wallMs + 86_400_000, zone);
  let valid = [wallMs - before, wallMs - after].filter(
    (t) => wallClockMs(t, zone) === wallMs,
  );
  if (valid.length) return Math.min(...valid);
  return wallMs - before;
}

// The instant's calendar day in the zone, `yyyy-MM-dd`.
export function localDateInZone(instant: Date | number, zone: string): string {
  return new Date(wallClockMs(instant, zone)).toISOString().slice(0, 10);
}

// The instant's wall time in the zone, as a zoneless `yyyy-MM-ddTHH:mm:ss.sss`.
export function localDateTimeInZone(
  instant: Date | number,
  zone: string,
): string {
  return new Date(wallClockMs(instant, zone)).toISOString().slice(0, 23);
}

// Whether the instant is a midnight on the zone's calendar.
export function isLocalMidnight(instant: Date | number, zone: string): boolean {
  return new Date(wallClockMs(instant, zone))
    .toISOString()
    .endsWith('T00:00:00.000Z');
}

// A relative date (`now`, `now-30d`, `now-1M/M`; see query.ts), as an ISO
// instant. Moves by `s`, `m` and `h` are elapsed time; moves by `d`, `w`, `M`
// and `y`, and every rounding, are on the zone's calendar, so `now/d` in New
// York is its midnight, and `now-1d/d` the midnight before even across a DST
// change. Weeks start on Monday. Undefined when `value` is no relative date.
// Throws `invalid-value` for a move past the last date a clock can name.
export const RELATIVE_DATE =
  /^now(?:([+-])(\d+)([smhdwMy]))?(?:\/([smhdwMy]))?$/;

export function resolveRelativeDateInZone(
  value: string,
  now: Date = new Date(),
  zone: string = DEFAULT_TIME_ZONE,
): string | undefined {
  let match = RELATIVE_DATE.exec(value);
  if (!match) return undefined;
  let [, sign, amount, unit, round] = match;
  let t = now.getTime();
  let n = sign ? Number(amount) * (sign === '-' ? -1 : 1) : 0;
  if (sign && (unit === 's' || unit === 'm' || unit === 'h')) {
    t += n * { s: 1000, m: 60_000, h: 3_600_000 }[unit];
  }
  // the zone's wall time, read as UTC civil time; every calendar step below
  // is on it
  let d = new Date(wallClockMs(t, zone));
  let calendar =
    Boolean(sign) && !(unit === 's' || unit === 'm' || unit === 'h');
  if (calendar) {
    switch (unit) {
      case 'd':
        d.setUTCDate(d.getUTCDate() + n);
        break;
      case 'w':
        d.setUTCDate(d.getUTCDate() + 7 * n);
        break;
      case 'M':
        d.setUTCMonth(d.getUTCMonth() + n);
        break;
      case 'y':
        d.setUTCFullYear(d.getUTCFullYear() + n);
        break;
    }
  }
  if (round) {
    let order = ['s', 'm', 'h', 'd', 'M', 'y'];
    let upTo = round === 'w' ? order.indexOf('d') : order.indexOf(round);
    if (upTo >= 0) d.setUTCMilliseconds(0);
    if (upTo >= 1) d.setUTCSeconds(0);
    if (upTo >= 2) d.setUTCMinutes(0);
    if (upTo >= 3) d.setUTCHours(0);
    if (round === 'w') {
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    }
    if (upTo >= 4) d.setUTCDate(1);
    if (upTo >= 5) d.setUTCMonth(0);
  }
  let instant = calendar || round ? instantOfWallClock(d.getTime(), zone) : t;
  let out = new Date(instant);
  if (Number.isNaN(out.getTime())) {
    throw new InvalidQueryError(
      `"${value}" moves past the last date there is (about 275,000 years from 1970 either way)`,
      'invalid-value',
    );
  }
  return out.toISOString();
}

// ── the query's clock ──────────────────────────────────────────────────

// The query's one clock reading carries the zone its calendar is reckoned
// in. The engine passes the reading (`queryNow`) to every filter, facet,
// expression and nested search already; a reading made by `clockInZone`
// says which zone, so all of them agree without another argument. A reading
// that carries none (a caller's own `new Date()`) is UTC.
const clockZones = new WeakMap<Date, string>();

// The instant `now`, as a clock reading in `zone`. The same object when it
// already reads in that zone; otherwise a new one (the instant is unchanged).
export function clockInZone(now: Date, zone: string): Date {
  if (zoneOfClock(now) === zone) return now;
  let clock = new Date(now.getTime());
  if (!isUtcZone(zone)) clockZones.set(clock, zone);
  return clock;
}

export function zoneOfClock(now: Date | undefined): string {
  return (now && clockZones.get(now)) ?? DEFAULT_TIME_ZONE;
}

// ── SQL ────────────────────────────────────────────────────────────────

// The zone as a SQL string literal. A zone has passed `assertTimeZone`, so
// it holds no quote; the doubling is for a caller that skipped it.
export function sqlZoneLiteral(zone: string): string {
  return `'${zone.replace(/'/g, "''")}'`;
}

// The wall time in the zone of `utcWall`, a SQL `timestamp` (without time
// zone) holding an instant's UTC wall time. In UTC it is `utcWall` itself.
export function pgLocalTimestamp(utcWall: string, zone: string): string {
  if (isUtcZone(zone)) return utcWall;
  return `((${utcWall}) AT TIME ZONE 'UTC' AT TIME ZONE ${sqlZoneLiteral(zone)})`;
}

// The first day of the day/week (from Monday)/month/year holding
// `localWall`, a SQL `timestamp` holding a wall time in the zone, as
// `yyyy-MM-dd`: the bucket's label, a date on the zone's calendar.
export function pgBucketLabel(
  unit: 'day' | 'week' | 'month' | 'year',
  localWall: string,
): string {
  return `to_char(date_trunc('${unit}', ${localWall}), 'YYYY-MM-DD')`;
}

// Whether Postgres's own zone table names the zone (`pg_timezone_names`):
// `Intl` and the database each carry a copy of the IANA database, and a
// zone one of them lacks would bucket or fail differently. Asked once per
// zone per process.
const pgKnown = new Map<string, boolean>();
export async function assertPostgresKnowsTimeZone(
  zone: string,
  ask: (sql: string, bind: unknown[]) => Promise<Record<string, unknown>[]>,
): Promise<void> {
  if (isUtcZone(zone)) return;
  let known = pgKnown.get(zone);
  if (known === undefined) {
    let rows = await ask(
      `SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE lower(name) = lower($1)) AS known`,
      [zone],
    );
    known = Boolean(rows[0]?.known);
    pgKnown.set(zone, known);
  }
  if (!known) {
    throw new InvalidQueryError(
      `timeZone: "${zone}" is not a time zone this database knows: name an IANA zone, such as "America/New_York" or "UTC"`,
      'invalid-value',
    );
  }
}

// ── evaluators that reckon dates as UTC civil time ─────────────────────

// A stored date-time with a time of day (`2026-11-10T03:30Z`, the
// serializer's zoneless `2026-11-10T03:30`, read as UTC). A date alone is a
// calendar day, and is left as written.
const DATE_TIME =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[T ]((?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?)(Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?$/;

// `value` with every stored date-time in it as the zone's wall time, zoneless
// (`2026-11-10T03:30Z` → `2026-11-09T22:30:00.000` in New York). An evaluator
// that reads a zoneless date-time as UTC civil time (BXL's spreadsheet
// functions: DAY, HOUR, WEEKDAY, DATEDIF…) then answers in the zone. Pair it
// with `wallClockMs(now, zone)` for NOW() and TODAY(). The same object in UTC.
export function toWallClock<T>(value: T, zone: string): T {
  if (isUtcZone(zone)) return value;
  let walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') {
      let m = DATE_TIME.exec(v);
      if (!m) return v;
      let [, y, mo, d, time, offset = 'Z'] = m;
      let t = Date.parse(`${y}-${mo}-${d}T${time}${offset}`);
      return Number.isNaN(t) ? v : localDateTimeInZone(t, zone);
    }
    if (depth > 32 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [
        k,
        walk(x, depth + 1),
      ]),
    );
  };
  return walk(value, 0) as T;
}

// ── the viewer's zone, by choice ───────────────────────────────────────

// The zone of the browser or process this runs in, when it names one.
// Never applied on its own: a query reckons in the viewer's zone only when
// its caller asks with `withViewerTimeZone`, for a personal view ("my day").
// Business facts (a school day, "late") use the realm's default zone.
export function viewerTimeZone(): string | undefined {
  try {
    return canonicalTimeZone(
      new Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  } catch {
    return undefined;
  }
}

// `query` reckoned in the viewer's zone, unless it names a zone of its own
// (or the viewer's zone cannot be read, when it is returned as it is).
export function withViewerTimeZone<Q extends object>(
  query: Q,
): Q & { timeZone?: string } {
  if ((query as { timeZone?: unknown }).timeZone !== undefined) return query;
  let zone = viewerTimeZone();
  return zone ? { ...query, timeZone: zone } : query;
}
