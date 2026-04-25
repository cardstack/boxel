import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';
import {
  assertValidBxlProfile,
  bxlToStorageExpression,
  compileBxl,
  parseBxlAst,
  storageToReadableBxlExpression,
  type BxlAstProgram,
  type BxlProfile,
  type ReadableSchema,
} from '../../src/index.js';

const schema: ReadableSchema = {
  fields: [
    { key: 'amount', label: 'Amount' },
    { key: 'description', label: 'Description' },
    {
      key: 'lineItems',
      label: 'Line Item',
      kind: 'array',
      item: {
        fields: [
          { key: 'taxable', label: 'Taxable' },
          { key: 'lineTotal', label: 'Line Total' },
        ],
      },
    },
  ],
};

const ast = compileBxl('Amount > 10', {
  target: 'ast',
  schema,
}) as BxlAstProgram;

strictEqual(ast.type, 'program');
strictEqual(ast.canonicalSource, '.amount > 10');
strictEqual(ast.body?.type, 'binary');
if (ast.body?.type === 'binary') {
  strictEqual(ast.body.left.type, 'path');
  if (ast.body.left.type === 'path') {
    deepStrictEqual(ast.body.left.parts, [{ type: 'field', key: 'amount' }]);
  }
}

const policyAst = parseBxlAst('SUM("Line Item"[* ."Taxable"]."Line Total") > 10', {
  schema,
  profile: 'policy',
});
strictEqual(
  policyAst.profileIssues.some((issue) => issue.code === 'policy-aggregate-banned'),
  true,
  'policy profile rejects aggregate calls',
);

const predicateAst = parseBxlAst('words(Description) > 10', {
  schema,
  profile: 'predicate',
});
strictEqual(
  predicateAst.profileIssues.some((issue) => issue.code === 'predicate-call-banned'),
  true,
  'predicate profile rejects unqueryable calls',
);
strictEqual(
  predicateAst.profileIssues.some((issue) =>
    issue.message.includes('query-time boolean predicate'),
  ),
  true,
  'predicate profile explains the query-time contract',
);

const deriveAst = parseBxlAst('SUM("Line Item"[* ."Taxable"]."Line Total")', {
  schema,
  profile: 'derive',
});
strictEqual(
  deriveAst.profileIssues.some((issue) => issue.code === 'derive-call-banned'),
  true,
  'derive profile rejects non-derivable calls',
);
strictEqual(
  deriveAst.profileIssues.some((issue) =>
    issue.message.includes('write/index-time derived facts'),
  ),
  true,
  'derive profile explains the index-time contract',
);

function expectProfileIssue(
  expression: string,
  profile: BxlProfile,
  code: string,
  options: { readableSyntax?: boolean; messageIncludes?: string } = {},
) {
  const program = parseBxlAst(expression, {
    schema,
    profile,
    readableSyntax: options.readableSyntax,
  });
  ok(
    program.profileIssues.some((issue) => issue.code === code),
    `${profile} emits ${code} for ${expression}`,
  );
  if (options.messageIncludes) {
    ok(
      program.profileIssues.some(
        (issue) =>
          issue.code === code &&
          issue.message.includes(options.messageIncludes!),
      ),
      `${profile} explains ${code} with ${options.messageIncludes}`,
    );
  }
  return program;
}

const boundedProfiles: BxlProfile[] = ['policy', 'predicate', 'derive'];
const boundedProfileCases = [
  {
    expression: 'def triple(x): x * 3; triple(2)',
    suffix: 'def-banned',
  },
  {
    expression: 'reduce .lineItems[] as $item (0; . + $item.lineTotal)',
    suffix: 'loop-banned',
    readableSyntax: false,
  },
  {
    expression: 'foreach .lineItems[] as $item (0; . + $item.lineTotal; .)',
    suffix: 'loop-banned',
    readableSyntax: false,
  },
  {
    expression: '..',
    suffix: 'recursive-descent-banned',
    readableSyntax: false,
  },
  {
    expression: '.amount = 10',
    suffix: 'assignment-banned',
    readableSyntax: false,
  },
  {
    expression: 'try .amount catch false',
    suffix: 'try-banned',
    readableSyntax: false,
  },
  {
    expression: 'label $out | break $out',
    suffix: 'control-flow-banned',
    readableSyntax: false,
  },
  {
    expression: '@csv',
    suffix: 'format-banned',
    readableSyntax: false,
  },
];

for (const profile of boundedProfiles) {
  for (const testCase of boundedProfileCases) {
    expectProfileIssue(
      testCase.expression,
      profile,
      `${profile}-${testCase.suffix}`,
      { readableSyntax: testCase.readableSyntax },
    );
  }
}

expectProfileIssue(
  'SUM("Line Item"[* ."Taxable"]."Line Total") > 10',
  'policy',
  'policy-aggregate-banned',
  { messageIncludes: 'request-time authorization decisions' },
);
expectProfileIssue('words(Description) > 10', 'predicate', 'predicate-call-banned', {
  messageIncludes: 'query-time boolean predicate',
});
strictEqual(
  parseBxlAst('Amount + 1 > 10', { schema, profile: 'predicate' }).profileIssues.length,
  0,
  'predicate profile allows portable SQL arithmetic value expressions',
);
expectProfileIssue('1 as $x | $x == 1', 'predicate', 'predicate-binding-banned', {
  readableSyntax: false,
  messageIncludes: 'query-time boolean predicate',
});
for (const expression of [
  '.lineItems[] == 1',
  '.lineItems[0:1] == []',
  '.lineItems[.amount] == 1',
]) {
  expectProfileIssue(expression, 'predicate', 'predicate-dynamic-path-banned', {
    readableSyntax: false,
    messageIncludes: 'query-time boolean predicate',
  });
}
expectProfileIssue(
  'SUM("Line Item"[* ."Taxable"]."Line Total")',
  'derive',
  'derive-call-banned',
  { messageIncludes: 'write/index-time derived facts' },
);
strictEqual(
  parseBxlAst('Amount + 1', { schema, profile: 'derive' }).profileIssues.length,
  0,
  'derive profile allows stable arithmetic fact shaping',
);
expectProfileIssue('1 as $x | $x', 'derive', 'derive-binding-banned', {
  readableSyntax: false,
  messageIncludes: 'write/index-time derived facts',
});
for (const expression of [
  '.lineItems[]',
  '.lineItems[0:1]',
  '.lineItems[.amount]',
]) {
  expectProfileIssue(expression, 'derive', 'derive-dynamic-path-banned', {
    readableSyntax: false,
    messageIncludes: 'write/index-time derived facts',
  });
}

const policyLetAst = parseBxlAst('LET(isLarge, Amount > 10, isLarge)', {
  schema,
  profile: 'policy',
});
strictEqual(
  policyLetAst.profileIssues.length,
  0,
  'policy allows LET/local binding for readable bounded checks',
);

for (const testCase of boundedProfileCases) {
  const computeAst = parseBxlAst(testCase.expression, {
    schema,
    profile: 'compute',
    readableSyntax: testCase.readableSyntax,
  });
  strictEqual(
    computeAst.profileIssues.length,
    0,
    `compute allows full BXL/jq power for ${testCase.expression}`,
  );
}

throws(
  () =>
    assertValidBxlProfile(
      parseBxlAst('words(Description) > 10', { schema }),
      { profile: 'predicate' },
    ),
  /predicate-call-banned/,
  'assertValidBxlProfile throws profile diagnostics',
);

const stored = bxlToStorageExpression(
  'SUM("Line Item"[* ."Taxable"]."Line Total")',
  { schema },
);
strictEqual(
  stored.source,
  'SUM([.lineItems[] | select(.taxable).lineTotal])',
  'storage source uses field keys, not display labels',
);

const readable = storageToReadableBxlExpression(stored.source, { schema });
strictEqual(
  readable.source.includes('"Line Item"'),
  true,
  'reverse projection restores readable labels for the editor',
);

console.log('BXL semantic AST/profile/storage projection: all checks passed');
