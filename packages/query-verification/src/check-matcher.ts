// Holds the host's live-query matcher (`matchInstanceAgainstFilter`) and the
// lowering (`lowerQuery`) to the Lean model, over every case and card in the
// vectors. Runs in Node, with no database, in the process's time zone (run it
// with `TZ=` set to see the matcher as a browser in that zone does).
import { isDeepStrictEqual } from 'util';

import { lowerQuery } from '@cardstack/runtime-common/query-syntax';

import {
  readVectors,
  report,
  VECTOR_FILES,
  withTypeRefs,
  type Disagreement,
} from './conformance.ts';
import { knownFor } from './known.ts';
import { matcherFor, ref } from './matcher-cards.ts';

// The matcher reads the clock with `new Date()`; a file's cases hold it to
// the instant they were written against.
const RealDate = Date;
function setClock(now: string | undefined) {
  if (!now) {
    globalThis.Date = RealDate;
    return;
  }
  let fixed = new RealDate(now).getTime();
  class FixedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fixed);
      else super(...(args as [string | number]));
    }
    static now() {
      return fixed;
    }
  }
  globalThis.Date = FixedDate as DateConstructor;
}

let failed = false;
let knownLines: string[] = [];
console.log(`time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
for (let file of VECTOR_FILES) {
  let vectors = readVectors(file);
  setClock(vectors.now);
  let check = await matcherFor(vectors);
  let known = knownFor('matcher', file);
  let disagreements: Disagreement[] = [];
  let notEvaluable: string[] = [];
  let loweringDiffs: string[] = [];
  let checked = 0;
  let refused = 0;

  let run = (caseName: string, form: string, filter: any, expect: string) => {
    let found = check(caseName, form, filter, expect);
    if (!found) {
      notEvaluable.push(`${caseName} [${form}]`);
      return;
    }
    checked += vectors.cards.length;
    disagreements.push(...found.filter((d) => !known.answers(d)));
  };

  for (let c of vectors.cases) {
    let newer = withTypeRefs(c.newer, ref);
    let modelLowered = withTypeRefs(c.lowered, ref);
    let lowered: any;
    try {
      lowered = lowerQuery(newer as any).query.filter;
    } catch (e) {
      loweringDiffs.push(
        `${c.name}: lowerQuery refused: ${(e as Error).message}`,
      );
      continue;
    }
    if (!isDeepStrictEqual(lowered, modelLowered)) {
      loweringDiffs.push(
        `${c.name}: lowerQuery gave ${JSON.stringify(lowered)}, the model ${JSON.stringify(modelLowered)}`,
      );
    }
    if (!c.expect) {
      refused++;
      continue;
    }
    // the host leaves a search reckoned in another zone to the server
    if (c.timeZone) {
      notEvaluable.push(`${c.name} (in ${c.timeZone})`);
      continue;
    }
    run(c.name, 'newer, lowered by lowerQuery', lowered, c.expect);
    if (c.older) {
      run(c.name, 'older', withTypeRefs(c.older, ref), c.expect);
    }
  }

  console.log(
    `${file}: ${vectors.cases.length} cases, ${vectors.cards.length} cards: ${checked} matcher answers checked`,
  );
  if (refused) {
    console.log(
      `  ${refused} case(s) the server refuses: lowering checked, no answers to check`,
    );
  }
  if (notEvaluable.length) {
    console.log(
      `  left to the server (isClientEvaluable false): ${notEvaluable.join('; ')}`,
    );
  }
  if (loweringDiffs.length) {
    console.log(
      `\nlowering differs from the model in ${loweringDiffs.length} case(s):`,
    );
    console.log(loweringDiffs.slice(0, 20).join('\n'));
  }
  if (disagreements.length) {
    console.log(`\nthe matcher disagrees with the model:`);
    console.log(report(disagreements));
  }
  let { lines, stale } = known.summary();
  knownLines.push(...lines);
  failed ||= loweringDiffs.length > 0 || disagreements.length > 0 || stale;
}
console.log(knownLines.join('\n'));
process.exitCode = failed ? 1 : 0;
