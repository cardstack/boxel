// Holds the host's live-query matcher (`matchInstanceAgainstFilter`) and the
// lowering (`lowerQuery`) to the Lean model, over every case and card in the
// filter and path vectors. Runs in Node, with no database.
import { isDeepStrictEqual } from 'util';

import { lowerQuery } from '@cardstack/runtime-common/query-syntax';

import {
  readVectors,
  report,
  VECTOR_FILES,
  withTypeRefs,
  type Disagreement,
} from './conformance.ts';
import { matcherFor, ref } from './matcher-cards.ts';

// Where the matcher is known to answer otherwise than the model and the
// Postgres engine, each with what it does. Reported, not failed; one that no
// longer occurs fails, so that it is taken off this list.
const KNOWN: {
  about: string;
  applies: (d: Disagreement) => boolean;
  seen: number;
}[] = [];

let failed = false;
for (let file of VECTOR_FILES) {
  let vectors = readVectors(file);
  let check = matcherFor(vectors);
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
    for (let d of found) {
      let known = KNOWN.find((k) => k.applies(d));
      if (known) {
        known.seen++;
      } else {
        disagreements.push(d);
      }
    }
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
  failed ||= loweringDiffs.length > 0 || disagreements.length > 0;
}
for (let k of KNOWN) {
  if (k.seen) {
    console.log(`known divergence, ${k.seen} answer(s): ${k.about}`);
  } else {
    console.log(`no longer diverges, take it off the list: ${k.about}`);
    failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
