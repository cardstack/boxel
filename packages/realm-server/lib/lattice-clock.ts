import { bxlClock, bxlCalendarDate, type BxlClock } from '@cardstack/bxl';

// The realm time zone the native producer reports `today` in. The browser
// bridge defaults to the same zone; a deployment sets both from one setting.
export function latticeClockTimeZone(): string {
  return process.env.LATTICE_REALM_TIME_ZONE ?? 'America/New_York';
}

export function latticeClock(at = new Date()): BxlClock {
  return bxlClock(at, latticeClockTimeZone());
}

// A grain program yields either a calendar date (`YYYY-MM-DD`, the value
// changes at that day's midnight in the realm time zone) or an ISO instant.
// Convert to the instant stored in boxel_index.valid_until. Invalid values
// throw: a wrong validity must not publish as a permanent value.
export function latticeValidUntilInstant(
  value: unknown,
  zone = latticeClockTimeZone(),
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new Error('Lattice time grain must be a date, an instant or null');
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return zonedMidnight(value, zone).toISOString();
  }
  const instant = new Date(value);
  if (!/T/.test(value) || Number.isNaN(instant.getTime())) {
    throw new Error(`Invalid Lattice time grain: ${value}`);
  }
  return instant.toISOString();
}

// The instant of local midnight for a calendar date in a zone. Walks the
// candidate instants around UTC midnight until the zone reads that date at
// 00:00; zones are within ±14 h of UTC and offsets are multiples of 15 min.
function zonedMidnight(date: string, zone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = new Date(base + offset * 60_000);
    if (
      bxlCalendarDate(candidate, zone) === date &&
      time.format(candidate) === '00:00'
    ) {
      return candidate;
    }
  }
  // A zone that skips local midnight (a DST transition at 00:00): take the
  // first instant that reads the date at all.
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = new Date(base + offset * 60_000);
    if (bxlCalendarDate(candidate, zone) === date) return candidate;
  }
  throw new Error(`Cannot place ${date} in time zone ${zone}`);
}
