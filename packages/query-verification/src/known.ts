// Where an evaluator is known to answer otherwise than the model, each with
// what it does. A check reports these instead of failing on them, and fails
// on one that no longer occurs, so that it is taken off this list once
// fixed.
import type { Disagreement } from './conformance.ts';

export type Evaluator = 'matcher' | 'postgres' | 'sqlite';

export interface Known {
  about: string;
  evaluators: Evaluator[];
  file: string | string[];
  // the cases it covers, by name; `not` of each is covered too
  cases: RegExp;
  // `answers`: the evaluator answers otherwise; `fails`: it throws
  kind: 'answers' | 'fails';
  card?: (doc: Record<string, unknown>) => boolean;
  // whether it can occur in this process
  when?: () => boolean;
}

const notUtc = () => new Date(2000, 0, 1).getTimezoneOffset() !== 0;

export const KNOWN: Known[] = [
  {
    about:
      'a relative `range` bound is compared as the full ISO instant (`2000-01-01T00:00:00.000Z`) with the stored text, not in the field\'s format: on a date field `gte: "now/d"` misses today and `lt: "now/d"` keeps it, and on a date-time field `gte: "now"` misses the current minute',
    evaluators: ['matcher'],
    file: 'dates',
    cases:
      /^(not )?range (dy (gte now\/d|lt now\/d|gte now-1d\/d( lt now\+1d\/d)?)|ts (gte now|lt now|gte now\/d)|tss gte now)$/,
    kind: 'answers',
  },
  {
    about:
      '`in` on a number or big-integer field fails with `invalid input syntax for type numeric` when a card of another type holds text under the field name: the extracted value is cast to numeric unguarded',
    evaluators: ['postgres'],
    file: 'values',
    cases: /^(not )?in [dg]( strings)?$/,
    kind: 'fails',
  },
  {
    about:
      'a number written as a string (`"2.00"`) does not equal the number on a number field, a number does not equal a big-integer field (stored as a string), and a string range bound on a big integer compares as text (`"10" > "9"` is false)',
    evaluators: ['matcher'],
    file: 'values',
    cases:
      /^(not )?(eq d "|in d strings$|eq g$|in g$|range g gt "9"$)|^not of a big integer and a list$/,
    kind: 'answers',
  },
  {
    about:
      'number and big-integer comparisons follow SQLite\'s type order, in which any text is greater than any number: a big integer is stored as text, so `range: { g: { gt: 9 } }` matches `-5` and `eq: { g: 10 }` misses `"10"`, and a number written as a string compares with a number field as text, so `range: { d: { gt: "0.50" } }` matches nothing and `eq: { d: "2.00" }` misses `2`',
    evaluators: ['sqlite'],
    file: 'values',
    cases:
      /^(not )?(eq d "|in d strings$|range d gt "|range d between strings$|range ds gt "|eq g$|in g$|range g gt 9$|range g gt "9"$)|^not of a big integer and a list$/,
    kind: 'answers',
  },
  {
    about:
      'a date-time bound with seconds, `Z` or an offset (`2000-01-01T00:00:00Z`, `…T05:30+05:30`), and a date-time bound on a date field, is compared as text with the stored `yyyy-MM-ddTHH:mm` instead of as the instant it names',
    evaluators: ['matcher', 'postgres', 'sqlite'],
    file: 'values',
    cases: /\(spelling [123]\)$|, as a date-time$|^a date and a date-time$/,
    kind: 'answers',
  },
  {
    about:
      'a number written as a string compares as text with a list of numbers (`eq: { ds: "0.50" }` misses `[0.5]`), where on a single number field Postgres compares it as a number',
    evaluators: ['matcher', 'postgres', 'sqlite'],
    file: 'values',
    cases: /^(not )?eq ds "0\.50"$/,
    kind: 'answers',
  },
  {
    about:
      "in a process whose time zone is not UTC, as most browsers' are, a date-time value is read in local wall time, so every date-time filter misses or matches by the zone's offset",
    evaluators: ['matcher'],
    file: ['values', 'dates'],
    cases: /\btss? |\bts\b|, as a date$/,
    kind: 'answers',
    when: notUtc,
  },
];

// Tracks which known divergences one evaluator hits over one vector file.
export function knownFor(evaluator: Evaluator, file: string) {
  let entries = KNOWN.filter(
    (k) =>
      k.evaluators.includes(evaluator) &&
      [k.file].flat().includes(file) &&
      (k.when?.() ?? true),
  ).map((k) => ({ k, seen: 0 }));
  let find = (
    kind: Known['kind'],
    caseName: string,
    doc?: Record<string, unknown>,
  ) => {
    let entry = entries.find(
      ({ k }) =>
        k.kind === kind &&
        k.cases.test(caseName) &&
        (!k.card || !doc || k.card(doc)),
    );
    if (entry) entry.seen++;
    return Boolean(entry);
  };
  return {
    answers: (d: Disagreement) => find('answers', d.case, d.card.doc),
    fails: (caseName: string) => find('fails', caseName),
    // one line per entry: what it is and how often it occurred, or that it
    // no longer does
    summary(): { lines: string[]; stale: boolean } {
      let lines = entries.map(({ k, seen }) =>
        seen
          ? `known divergence (${evaluator}), ${seen} time(s): ${k.about}`
          : `no longer diverges (${evaluator}), take it off the list: ${k.about}`,
      );
      return { lines, stale: entries.some(({ seen }) => seen === 0) };
    },
  };
}
