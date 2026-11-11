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

export const KNOWN: Known[] = [];

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
