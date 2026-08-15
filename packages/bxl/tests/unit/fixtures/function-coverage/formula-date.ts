import { ok, strictEqual } from 'node:assert';
import { dateCases, type CoverageCase } from './case.ts';

// Every case here runs under each of `TIMEZONES` and has to give the same
// answer in all of them: a serial names a calendar day, not an instant, and
// indexing evaluates these in UTC while the author's browser does not.
export const formulaDateCases: CoverageCase[] = dateCases([
  // Serial 1 is 1900-01-01, and Excel's deliberate 1900 leap-year bug slips a
  // phantom 1900-02-29 in, so every later date sits one above a true day
  // count from the epoch. 2026-04-30 is the anchor the rest of the table
  // measures against.
  { covers: 'DATE/3', source: 'DATE(2026, 4, 30)', expected: 46142 },
  // A month past 12 carries into the following year.
  {
    covers: 'DATE/3',
    source: 'DATE(2026, 13, 1) == DATE(2027, 1, 1)',
    expected: true,
  },
  // YEAR, MONTH and DAY read back the three components DATE packed in.
  { covers: 'YEAR/1', source: 'YEAR(DATE(2026, 4, 30))', expected: 2026 },
  { covers: 'MONTH/1', source: 'MONTH(DATE(2026, 4, 30))', expected: 4 },
  { covers: 'DAY/1', source: 'DAY(DATE(2026, 4, 30))', expected: 30 },
  // DAYS takes the end date first and the start date second.
  {
    covers: 'DAYS/2',
    source: 'DAYS(DATE(2026, 4, 30), DATE(2026, 4, 22))',
    expected: 8,
  },
  // DATEVALUE reads a date out of text. The ISO form is unambiguous; a
  // zoneless human form denotes a calendar day too, so re-reading it against
  // the host zone must not move the serial.
  { covers: 'DATEVALUE/1', source: 'DATEVALUE("2026-04-30")', expected: 46142 },
  {
    covers: 'DATEVALUE/1',
    source: 'DATEVALUE("April 30, 2026")',
    expected: 46142,
  },
  // A trailing four-digit year must not read as a `-hhmm` UTC offset, which
  // would skip the re-anchoring that makes a zoneless date a calendar day and
  // leave the answer a day earlier east of UTC.
  {
    covers: 'DATEVALUE/1',
    source: 'DATEVALUE("30-Apr-2026")',
    expected: 46142,
  },
  // A string that does name an offset keeps meaning the instant it names, so
  // half an hour before midnight in -07:00 is already the next UTC day.
  {
    covers: 'DATEVALUE/1',
    source: 'DATEVALUE("2026-04-30T23:30:00-07:00")',
    expected: 46143,
  },
  // Month arithmetic. EDATE clamps the day of month to the target month's
  // last day rather than letting it overflow, so one month past January 31
  // is February 28, not March 3.
  {
    covers: 'EDATE/2',
    source: 'EDATE(DATE(2026, 1, 31), 1) == DATE(2026, 2, 28)',
    expected: true,
  },
  {
    covers: 'EOMONTH/2',
    source: 'EOMONTH(DATE(2026, 2, 5), 1) == DATE(2026, 3, 31)',
    expected: true,
  },
  // The unit decides what the difference counts. "YM" is the month remainder
  // after whole years, so both the 2 years and the trailing 26 days drop out.
  {
    covers: 'DATEDIF/3',
    source: 'DATEDIF(DATE(2024, 3, 15), DATE(2026, 8, 10), "YM")',
    expected: 4,
  },
  // 30/360 conventions. The US and European methods part company on a
  // month-end end date whose start day falls before the 30th: the US method
  // leaves the 31st where it is, Europe pulls it back to the 30th.
  {
    covers: 'DAYS360/2',
    source: 'DAYS360(DATE(2026, 1, 15), DATE(2026, 3, 31))',
    expected: 76,
  },
  {
    covers: 'DAYS360/3',
    source: 'DAYS360(DATE(2026, 1, 15), DATE(2026, 3, 31), true)',
    expected: 75,
  },
  // Basis 0, the default, is 30/360, which makes January 1 to July 1 exactly
  // half a year. Basis 1 is actual/actual: 181 days over a 365-day 2026.
  {
    covers: 'YEARFRAC/2',
    source: 'YEARFRAC(DATE(2026, 1, 1), DATE(2026, 7, 1))',
    expected: 0.5,
  },
  {
    covers: 'YEARFRAC/3',
    source: 'YEARFRAC(DATE(2026, 1, 1), DATE(2026, 7, 1), 1)',
    expected: 0.4958904109589,
    tolerance: 1e-12,
  },
  // Week fields. 2026-04-30 is a Thursday: return type 1, the default,
  // numbers from Sunday = 1, type 2 from Monday = 1.
  { covers: 'WEEKDAY/1', source: 'WEEKDAY(DATE(2026, 4, 30))', expected: 5 },
  { covers: 'WEEKDAY/2', source: 'WEEKDAY(DATE(2026, 4, 30), 2)', expected: 4 },
  // Type 11 is the same Monday = 1 numbering as type 2.
  {
    covers: 'WEEKDAY/2',
    source: 'WEEKDAY(DATE(2026, 4, 30), 11)',
    expected: 4,
    knownDefect:
      'only return types 1, 2 and 3 are branched on, so 11 through 17 fall ' +
      'through to the Sunday = 1 default',
  },
  // 2026-04-26 is a Sunday, which is exactly where the two start-of-week
  // conventions disagree: it opens week 18 counting weeks from Sunday and
  // closes week 17 counting them from Monday.
  { covers: 'WEEKNUM/1', source: 'WEEKNUM(DATE(2026, 4, 26))', expected: 18 },
  {
    covers: 'WEEKNUM/2',
    source: 'WEEKNUM(DATE(2026, 4, 26), 2)',
    expected: 17,
  },
  // Return type 21 is the ISO-8601 week, the one ISOWEEKNUM reports.
  {
    covers: 'WEEKNUM/2',
    source: 'WEEKNUM(DATE(2026, 4, 26), 21)',
    expected: 17,
    knownDefect:
      'return type 2 is the only one branched on, so 11 through 17 and the ' +
      'ISO 21 all fall through to the Sunday-start week',
  },
  // 2026-06-15 is the Monday that opens ISO week 25 of 2026.
  {
    covers: 'ISOWEEKNUM/1',
    source: 'ISOWEEKNUM(DATE(2026, 6, 15))',
    expected: 25,
  },
  // 2027-01-01 is a Friday, so it belongs to the ISO week that opened on
  // 2026-12-28 — the 53rd and last week of ISO year 2026.
  {
    covers: 'ISOWEEKNUM/1',
    source: 'ISOWEEKNUM(DATE(2027, 1, 1))',
    expected: 53,
    knownDefect:
      'the week arithmetic has no year-boundary branch, so an early-January ' +
      'date belonging to the previous ISO year reports week 0 instead of that ' +
      "year's 52nd or 53rd week",
  },
  // Working days. April 2026 runs Wednesday the 1st to Thursday the 30th and
  // holds eight weekend days, leaving 22 of its 30 days.
  {
    covers: 'NETWORKDAYS/2',
    source: 'NETWORKDAYS(DATE(2026, 4, 1), DATE(2026, 4, 30))',
    expected: 22,
  },
  // Friday the 3rd counts as a working day until the holiday list takes it.
  {
    covers: 'NETWORKDAYS/3',
    source:
      'NETWORKDAYS(DATE(2026, 4, 1), DATE(2026, 4, 30), [DATE(2026, 4, 3)])',
    expected: 21,
  },
  {
    covers: 'NETWORKDAYS_INTL/2',
    source: 'NETWORKDAYS_INTL(DATE(2026, 4, 1), DATE(2026, 4, 30))',
    expected: 22,
  },
  // Weekend code 11 is Sunday alone, which hands April's four Saturdays back
  // to the working week.
  {
    covers: 'NETWORKDAYS_INTL/3',
    source: 'NETWORKDAYS_INTL(DATE(2026, 4, 1), DATE(2026, 4, 30), 11)',
    expected: 26,
  },
  // Saturday the 11th only costs a day because code 11 makes Saturdays
  // working days; under the default weekend that same holiday changes nothing.
  {
    covers: 'NETWORKDAYS_INTL/4',
    source:
      'NETWORKDAYS_INTL(DATE(2026, 4, 1), DATE(2026, 4, 30), 11, [DATE(2026, 4, 11)])',
    expected: 25,
  },
  // WORKDAY answers with a serial, so each case reads it back as the calendar
  // distance from its start date. Two working days past Thursday the 30th is
  // Monday May 4 — four days out, because the weekend does not count.
  {
    covers: 'WORKDAY/2',
    source: 'DAYS(WORKDAY(DATE(2026, 4, 30), 2), DATE(2026, 4, 30))',
    expected: 4,
  },
  // Friday May 1 as a holiday pushes the second working day out to Tuesday.
  {
    covers: 'WORKDAY/3',
    source:
      'DAYS(WORKDAY(DATE(2026, 4, 30), 2, [DATE(2026, 5, 1)]), DATE(2026, 4, 30))',
    expected: 5,
  },
  {
    covers: 'WORKDAY_INTL/2',
    source: 'DAYS(WORKDAY_INTL(DATE(2026, 4, 30), 2), DATE(2026, 4, 30))',
    expected: 4,
  },
  // With Sunday the only weekend day, Friday and Saturday both count.
  {
    covers: 'WORKDAY_INTL/3',
    source: 'DAYS(WORKDAY_INTL(DATE(2026, 4, 30), 2, 11), DATE(2026, 4, 30))',
    expected: 2,
  },
  // Taking that Saturday out as a holiday carries the second working day on
  // to Monday.
  {
    covers: 'WORKDAY_INTL/4',
    source:
      'DAYS(WORKDAY_INTL(DATE(2026, 4, 30), 2, 11, [DATE(2026, 5, 2)]), DATE(2026, 4, 30))',
    expected: 4,
  },
  // Times of day are a fraction of a day in [0, 1); HOUR, MINUTE and SECOND
  // read the three components back out of one.
  { covers: 'TIME/3', source: 'TIME(6, 0, 0)', expected: 0.25 },
  { covers: 'HOUR/1', source: 'HOUR(TIME(14, 30, 45))', expected: 14 },
  { covers: 'MINUTE/1', source: 'MINUTE(TIME(14, 30, 45))', expected: 30 },
  { covers: 'SECOND/1', source: 'SECOND(TIME(14, 30, 45))', expected: 45 },
  { covers: 'TIMEVALUE/1', source: 'TIMEVALUE("18:00")', expected: 0.75 },
  // A 12-hour clock reading is one of the forms TIMEVALUE accepts, and 2:24
  // PM is 14:24 — 0.6 of a day.
  {
    covers: 'TIMEVALUE/1',
    source: 'TIMEVALUE("2:24 PM")',
    expected: 0.6,
    knownDefect:
      'the parse reads only the digit groups of `h:mm:ss` and drops the AM/PM ' +
      'suffix, so every afternoon time comes back twelve hours early',
  },
  // The clock functions have no fixed answer, so they assert what holds
  // whenever they run. TODAY is a whole serial at or after 2026-01-01; NOW
  // carries the same day plus a time fraction, so flooring it lands on TODAY.
  {
    covers: 'TODAY/0',
    source: 'TODAY()',
    check: (outputs) => {
      strictEqual(outputs.length, 1);
      const [today] = outputs as number[];
      ok(Number.isInteger(today), `expected a whole serial, got ${today}`);
      ok(
        today >= 46023,
        `expected a serial at or after 2026-01-01, got ${today}`,
      );
    },
  },
  {
    covers: 'NOW/0',
    source: '[NOW(), TODAY(), FLOOR(NOW())]',
    check: (outputs) => {
      const [[now, today, floored]] = outputs as number[][];
      ok(
        now >= today && now - today < 1,
        `expected NOW inside the day TODAY names, got ${now} against ${today}`,
      );
      strictEqual(floored, today, 'flooring NOW must land on TODAY');
    },
  },
]);
