// Scoring a `rerank` formula over the rows of its window. Kept free of the
// engine's own imports so a worker thread can load it on its own (see
// rerank-pool.ts); the engine runs it in-thread where no pool is registered,
// as in the browser.

import type { PreparedSpreadsheetFormula } from '@cardstack/bxl';

// The wall-clock budget a rerank's scoring gets, from when it starts waiting
// for a scorer to its last row. Past it the rows keep the query's order and
// the result carries a `rerank-timeout` warning, rather than a page where the
// rows scored in time are ranked against ones that were never scored.
export const RERANK_TIME_BUDGET_MS = 1000;

export interface RerankScores {
  // One per doc, null where the formula gave no number. Empty when timed out.
  values: (number | null)[];
  timedOut: boolean;
}

// A rerank formula that does not compile: the caller's error, not a timeout.
export class RerankFormulaError extends Error {}

// Scores `docs` with `expr`, giving up once `deadline` (epoch ms) passes.
// A spreadsheet formula runs with Excel's rules for blanks and errors, the
// same rules a formula placed in SQL follows; any function beyond the
// interpreter's own (the lazily loaded statistical, financial and
// engineering ones too) runs in BXL's sandbox. Any other BXL is compiled once
// with the docs' own field names as its labels, so `rating` reads `.rating`.
let formulaExtensions: Promise<void> | undefined;
export async function scoreRerankFormula(
  expr: string,
  docs: Record<string, unknown>[],
  deadline: number,
): Promise<RerankScores> {
  let bxl = await import('@cardstack/bxl');
  formulaExtensions ??= bxl.loadAllFormulaExtensions().catch(() => undefined);
  await formulaExtensions;
  // The engine's synthetic keys (`_title`, `_cardType`) are left out of the
  // labels, as is any name that reads the same as one already taken once case
  // and punctuation are ignored, so no label is ambiguous.
  let keys = new Set<string>();
  let taken = new Set<string>();
  for (let doc of docs) {
    for (let key of Object.keys(doc)) {
      if (!/^[A-Za-z$][\w$]*$/.test(key) || keys.has(key)) continue;
      let folded = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (taken.has(folded)) continue;
      taken.add(folded);
      keys.add(key);
    }
  }
  let limits = { maxMillis: 20, maxSteps: 100_000, maxOutputs: 4 };
  let spreadsheet: PreparedSpreadsheetFormula | undefined;
  try {
    spreadsheet = bxl.prepareSpreadsheetFormula(expr, {
      callFunction(name, arity) {
        let fields = Array.from({ length: arity }, (_, i) => `a${i}`);
        let call;
        try {
          call = bxl.prepareBxl(`${name}(${fields.join(', ')})`, {
            schema: { fields: fields.map((key) => ({ key, label: key })) },
          });
        } catch {
          return undefined;
        }
        return (args) =>
          call.evaluate(
            Object.fromEntries(args.map((a, i) => [fields[i], a])),
            { runtimeLimits: limits },
          ).value;
      },
    });
  } catch (e) {
    if (!(e instanceof bxl.SpreadsheetFormulaUnsupported)) throw e;
  }
  let score: (doc: Record<string, unknown>) => number | null;
  if (spreadsheet) {
    let now = new Date();
    score = (doc) => spreadsheet!.evaluate(doc, { now });
  } else {
    let prepared: ReturnType<typeof bxl.prepareBxl>;
    try {
      prepared = bxl.prepareBxl(expr, {
        schema: { fields: [...keys].map((key) => ({ key, label: key })) },
      });
    } catch (e) {
      throw new RerankFormulaError(
        `rerank: the formula does not compile: ${(e as Error).message}`,
      );
    }
    score = (doc) => {
      try {
        let value = prepared.evaluate(doc, { runtimeLimits: limits }).value;
        if (typeof value === 'boolean') return value ? 1 : 0;
        let n =
          typeof value === 'number'
            ? value
            : typeof value === 'string' && value.trim() !== ''
              ? Number(value)
              : NaN;
        return Number.isFinite(n) ? n : null;
      } catch {
        return null;
      }
    };
  }
  let values: (number | null)[] = [];
  for (let doc of docs) {
    if (Date.now() >= deadline) {
      return { values: [], timedOut: true };
    }
    values.push(score(doc));
  }
  return { values, timedOut: false };
}

// What scores a rerank: in-thread by default; the realm server registers a
// worker pool (rerank-pool.ts) so a formula never runs on its event loop.
export type RerankScorer = (
  expr: string,
  docs: Record<string, unknown>[],
  deadline: number,
) => Promise<RerankScores>;

let scorer: RerankScorer = scoreRerankFormula;
let budgetMs = RERANK_TIME_BUDGET_MS;

export function setRerankScorer(next: RerankScorer | undefined): void {
  scorer = next ?? scoreRerankFormula;
}

export function rerankScorer(): RerankScorer {
  return scorer;
}

export function rerankTimeBudgetMs(): number {
  return budgetMs;
}

// For tests: a budget small enough to trip, without a slow formula.
export function setRerankTimeBudgetForTests(ms: number | undefined): void {
  budgetMs = ms ?? RERANK_TIME_BUDGET_MS;
}

// Only the top-level fields a formula names, so a window's rows cross to a
// worker (or to Postgres) without the vectors and text they carry and the
// formula never reads. A name counts when it appears as a word in the
// formula, ignoring case and punctuation, as BXL labels do.
export function fieldsTheFormulaReads(
  expr: string,
  docs: Record<string, unknown>[],
): Record<string, unknown>[] {
  let fold = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  let words = new Set(
    [...expr.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => fold(m[0])),
  );
  let wanted = new Map<string, boolean>();
  return docs.map((doc) => {
    let picked: Record<string, unknown> = {};
    for (let [key, value] of Object.entries(doc)) {
      let keep = wanted.get(key);
      if (keep === undefined) {
        keep = words.has(fold(key));
        wanted.set(key, keep);
      }
      if (keep) picked[key] = value;
    }
    return picked;
  });
}
