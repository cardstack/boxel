import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';
import {
  assertValidBxlProfile,
  categoryForBxlFunction,
  bxlToStorageExpression,
  classifyBxlProfileFunction,
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
  deriveAst.profileIssues.length,
  0,
  'derive profile allows record-local aggregate computedVia expressions',
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

// reduce / foreach are banned in `policy` and `predicate` only — `derive`
// allows them as ergonomic fold primitives for record-local aggregation.
const loopBoundedProfiles: BxlProfile[] = ['policy', 'predicate'];
const loopCases = [
  'reduce .lineItems[] as $item (0; . + $item.lineTotal)',
  'foreach .lineItems[] as $item (0; . + $item.lineTotal; .)',
];
for (const profile of loopBoundedProfiles) {
  for (const expression of loopCases) {
    expectProfileIssue(
      expression,
      profile,
      `${profile}-loop-banned`,
      { readableSyntax: false },
    );
  }
}

expectProfileIssue(
  'SUM("Line Item"[* ."Taxable"]."Line Total") > 10',
  'policy',
  'policy-aggregate-banned',
  { messageIncludes: 'request-time authorization decisions' },
);
expectProfileIssue('NPV(0.1, [100, 200]) > 0', 'policy', 'policy-aggregate-banned', {
  messageIncludes: 'aggregate calls',
});
expectProfileIssue(
  'T_TEST([1, 2, 3], [2, 3, 4]) < 0.05',
  'policy',
  'policy-aggregate-banned',
  { messageIncludes: 'aggregate calls' },
);
expectProfileIssue('IMSUM(["1+i", "2+i"]) = "3+2i"', 'policy', 'policy-aggregate-banned', {
  messageIncludes: 'aggregate calls',
});
expectProfileIssue('IFERROR(Amount, 0) > 10', 'policy', 'policy-call-banned', {
  messageIncludes: 'error-masking calls',
});
expectProfileIssue('RAND() > 0.5', 'policy', 'policy-call-banned', {
  messageIncludes: 'volatile calls',
});
expectProfileIssue('debug', 'policy', 'policy-call-banned', {
  readableSyntax: false,
  messageIncludes: 'control/side-effect calls',
});
expectProfileIssue('words(Description) > 10', 'predicate', 'predicate-call-banned', {
  messageIncludes: 'query-time boolean predicate',
});
expectProfileIssue('PMT(0.08 / 12, 60, 25000, 0, 0) < 0', 'predicate', 'predicate-call-banned', {
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
strictEqual(
  parseBxlAst('Amount + 1', { schema, profile: 'derive' }).profileIssues.length,
  0,
  'derive profile allows stable arithmetic fact shaping',
);
strictEqual(
  parseBxlAst('LET(total, SUM("Line Item"."Line Total"), total > 10)', {
    schema,
    profile: 'derive',
  }).profileIssues.length,
  0,
  'derive profile allows LET and aggregation for headless computedVia work',
);
strictEqual(
  parseBxlAst('IFERROR(Amount, 0)', { schema, profile: 'derive' }).profileIssues.length,
  0,
  'derive profile allows deterministic Excel error fallback helpers',
);
strictEqual(
  parseBxlAst('NPV(0.1, [100, 200])', { schema, profile: 'derive' }).profileIssues.length,
  0,
  'derive profile allows deterministic lazy aggregate formula helpers',
);
strictEqual(
  parseBxlAst(
    'reduce .lineItems[] as $item (0; . + $item.lineTotal)',
    { schema, profile: 'derive', readableSyntax: false },
  ).profileIssues.length,
  0,
  'derive profile allows reduce — record-local fold for aggregation',
);
strictEqual(
  parseBxlAst(
    'foreach .lineItems[] as $item (0; . + $item.lineTotal; .)',
    { schema, profile: 'derive', readableSyntax: false },
  ).profileIssues.length,
  0,
  'derive profile allows foreach — record-local fold with intermediate state',
);
strictEqual(
  parseBxlAst(
    '[.policies[] | .coverageFlags // 0] | reduce .[] as $x (0; BITOR(.; $x))',
    { schema: { fields: [{ key: 'policies', label: 'Policies', kind: 'array' }] }, profile: 'derive', readableSyntax: false },
  ).profileIssues.length,
  0,
  'derive profile allows BITOR-fold for portfolio coverage bitmasks',
);
strictEqual(
  parseBxlAst('[.medications[]?]', {
    profile: 'derive',
    readableSyntax: false,
  }).profileIssues.length,
  0,
  'derive profile allows optional stream projection for record-local arrays',
);
expectProfileIssue('RAND() > 0.5', 'derive', 'derive-call-banned', {
  messageIncludes: 'volatile calls',
});
expectProfileIssue('debug', 'derive', 'derive-call-banned', {
  readableSyntax: false,
  messageIncludes: 'control/side-effect calls',
});
expectProfileIssue('try .x catch 0', 'derive', 'derive-try-banned', {
  readableSyntax: false,
  messageIncludes: 'try/catch',
});
expectProfileIssue('@User.ID', 'derive', 'derive-context-banned', {
  messageIncludes: 'deterministic write/index-time computation',
});
expectProfileIssue('$new.Amount', 'derive', 'derive-context-banned', {
  messageIncludes: 'deterministic write/index-time computation',
});

const policyLetAst = parseBxlAst('LET(isLarge, Amount > 10, isLarge)', {
  schema,
  profile: 'policy',
});
strictEqual(
  policyLetAst.profileIssues.length,
  0,
  'policy allows LET/local binding for readable bounded checks',
);
strictEqual(
  categoryForBxlFunction('SUM'),
  'aggregate',
  'function safety registry classifies aggregate calls in one source module',
);
strictEqual(
  categoryForBxlFunction('NPV'),
  'aggregate',
  'function safety registry classifies lazy financial collection calls as aggregate',
);
strictEqual(
  categoryForBxlFunction('T_TEST'),
  'aggregate',
  'function safety registry classifies lazy statistical tests as aggregate',
);
strictEqual(
  categoryForBxlFunction('PMT'),
  'boundedScalar',
  'function safety registry classifies scalar financial calls as bounded',
);
strictEqual(
  categoryForBxlFunction('NORM_DIST'),
  'boundedScalar',
  'function safety registry classifies scalar statistical distributions as bounded',
);
strictEqual(
  categoryForBxlFunction('BESSELI'),
  'boundedScalar',
  'function safety registry classifies scalar Bessel calls as bounded',
);
deepStrictEqual(
  classifyBxlProfileFunction('predicate', 'like'),
  {
    safety: 'allow',
    normalizedName: 'LIKE',
    category: 'predicateLowerable',
  },
  'function safety registry exposes predicate lowerable calls',
);
deepStrictEqual(
  classifyBxlProfileFunction('policy', 'PMT'),
  {
    safety: 'allow',
    normalizedName: 'PMT',
    category: 'boundedScalar',
  },
  'function safety registry allows bounded scalar lazy calls in policy',
);
deepStrictEqual(
  classifyBxlProfileFunction('policy', 'NPV'),
  {
    safety: 'deny',
    normalizedName: 'NPV',
    category: 'aggregate',
    message: 'aggregate calls can pull work across collections',
  },
  'function safety registry denies collection-scanning lazy calls in policy',
);
deepStrictEqual(
  classifyBxlProfileFunction('derive', 'RAND'),
  {
    safety: 'deny',
    normalizedName: 'RAND',
    category: 'volatile',
    message: 'volatile calls are not stable write-time derivations',
  },
  'function safety registry exposes derive denied calls',
);
deepStrictEqual(
  classifyBxlProfileFunction('derive', 'empty'),
  {
    safety: 'allow',
    normalizedName: 'EMPTY',
    category: 'controlOrSideEffect',
  },
  'function safety registry allows deterministic empty stream control in derive',
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
