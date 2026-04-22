import { deepStrictEqual, strictEqual } from 'node:assert';
import { lintBxlExpression } from '../../src/index.js';
import { bxlExampleSchema } from '../../examples/bxl-150-examples.js';

function issueCodes(source: string): string[] {
  return lintBxlExpression(source, { schema: bxlExampleSchema }).issues.map(
    (issue) => issue.code,
  );
}

const clean = lintBxlExpression('"Line Item"[#4].Quantity', {
  schema: bxlExampleSchema,
});
strictEqual(clean.ok, true);
deepStrictEqual(clean.issues, []);

const safeAggregate = lintBxlExpression(
  '("Line Item"[all]."Line Total" | add) == Subtotal',
  { schema: bxlExampleSchema },
);
strictEqual(safeAggregate.ok, true);
strictEqual(
  safeAggregate.issues.some((issue) => issue.code === 'root-label-after-pipe'),
  false,
);

const missingQuotes = lintBxlExpression('Invoice Number', {
  schema: bxlExampleSchema,
});
strictEqual(missingQuotes.ok, true);
deepStrictEqual(issueCodes('Invoice Number').sort(), [
  'unquoted-label-phrase',
]);

const autoRootAfterPipe = lintBxlExpression(
  '"Line Item"[all]."Line Total" | add == Subtotal',
  { schema: bxlExampleSchema },
);
strictEqual(autoRootAfterPipe.ok, true);
strictEqual(
  autoRootAfterPipe.issues.some((issue) => issue.code === 'root-label-after-pipe'),
  false,
);

strictEqual(
  issueCodes('"Line Item"[row 4].SKU').includes('row-shortcut-deprecated'),
  true,
);
strictEqual(
  issueCodes('"Line Item"[0].SKU').includes('native-zero-based-index'),
  true,
);
strictEqual(
  issueCodes('"Line Item"[Category = "Service"].SKU').includes(
    'predicate-first-match',
  ),
  true,
);
// `=` at top level is now canonical BXL — no info code. `==` nudges.
strictEqual(issueCodes('Subtotal = 80').includes('prefer-excel-equality'), false);
strictEqual(issueCodes('Subtotal == 80').includes('prefer-excel-equality'), true);
strictEqual(
  issueCodes('"Line Item"[SKU IN ["COPY-03"]].SKU').includes(
    'in-predicate-needs-helper',
  ),
  true,
);
const oddPseudo = lintBxlExpression('"Line Item":odd.SKU', {
  schema: bxlExampleSchema,
});
// :odd / :even materialize-then-stride now — no deferral warning.
strictEqual(oddPseudo.ok, true);
strictEqual(
  oddPseudo.issues.some((issue) => issue.code === 'positional-stream-pseudo-deferred'),
  false,
);

const badRow = lintBxlExpression('"Line Item"[row 0].SKU', {
  schema: bxlExampleSchema,
});
strictEqual(badRow.ok, false);
strictEqual(badRow.issues.some((issue) => issue.code === 'human-row-zero'), true);

console.log('BXL linter: edge-case diagnostics passed');
