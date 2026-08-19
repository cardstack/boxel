/**
 * The ISO 8601 week number of a date.
 *
 * Shared by `ISOWEEKNUM` and by `WEEKNUM`'s return type 21, which name the
 * same rule and must not drift apart. Those two live in different modules —
 * one eager, one lazily loaded — so the rule lives here rather than in either.
 */

const MS_PER_DAY = 86_400_000;

export function isoWeekNumber(date: Date): number {
  // A week belongs to the year holding its Thursday, which is what places an
  // early-January date in the previous year's 52nd or 53rd week.
  const isoDayOfWeek = date.getUTCDay() || 7; // Mon = 1 .. Sun = 7
  const thursday = new Date(date.getTime());
  thursday.setUTCDate(date.getUTCDate() + 4 - isoDayOfWeek);
  const isoYearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const daysIntoIsoYear = (thursday.getTime() - isoYearStart) / MS_PER_DAY;
  return Math.ceil((daysIntoIsoYear + 1) / 7);
}
