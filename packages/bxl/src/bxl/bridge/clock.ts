/**
 * The clock a BXL derivation may read. Programs never call `now`/`TODAY`
 * (the derive profile bans volatile calls); instead they read `.__clock`,
 * which the engine supplies as data: `today`, the calendar date in the
 * realm's time zone, and `now`, the current instant truncated to the
 * minute. A field that reads the clock declares a `validUntil` grain
 * program (see `BxlOptions.validUntil`) so the engine re-derives it only
 * when that boundary passes.
 *
 * Both the browser card runtime (via the card facade) and the native worker
 * present the same shape, so a program derives the same value in either.
 */
export interface BxlClock {
  /** `YYYY-MM-DD` in the configured time zone. */
  today: string;
  /** ISO 8601 instant (UTC), truncated to the minute. */
  now: string;
}

let timeZone = 'America/New_York';

/** Configure the realm time zone the clock reports `today` in. */
export function setBxlClockTimeZone(zone: string): void {
  // Throws for an unknown zone, before any program can read it.
  new Intl.DateTimeFormat('en-CA', { timeZone: zone });
  timeZone = zone;
}

export function bxlClockTimeZone(): string {
  return timeZone;
}

export function bxlClock(at: Date = new Date(), zone = timeZone): BxlClock {
  return {
    today: calendarDate(at, zone),
    now: new Date(Math.floor(at.getTime() / 60_000) * 60_000).toISOString(),
  };
}

/** The calendar date of an instant in a time zone, as `YYYY-MM-DD`. */
export function calendarDate(at: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
