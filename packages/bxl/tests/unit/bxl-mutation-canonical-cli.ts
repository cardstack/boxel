// The mutation dialect's canonical printer. Lowering stores the canonical text
// of a card operation's transform program and the realm re-parses that text
// as solidified jq, so the printed form has to parse back to the program the
// author wrote. These checks hold the printer to that: printing is a fixed
// point, the reparsed tree is the original tree, and both evaluate alike.

import { createHash } from 'node:crypto';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { evaluateBxl } from '../../src/index.ts';
import { parseNativeJq } from '../../src/bxl/bridge/native.ts';
import { compileReadableSyntax } from '../../src/bxl/compiler/readable-syntax.ts';
import { prepareBxlMutation } from '../../src/mutation/index.ts';
import { printMutationAst } from '../../src/mutation/syntax.ts';
import type { ExpressionAst } from '../../src/jqtools/parser/AST.ts';
import type {
  BxlMutationJson,
  BxlMutationSchema,
} from '../../src/mutation/types.ts';

let checks = 0;

function parseExpr(source: string): ExpressionAst {
  const expr = parseNativeJq(source, { readableSyntax: false }).ast.expr;
  if (!expr) throw new Error(`empty program: ${source}`);
  return expr;
}

// `parenthesized` records that a binary came from explicit parentheses. The
// printer keeps it wherever it changes how the parser groups (an operand), and
// drops it where it cannot (a whole program, an array, a call argument), so
// the trees are compared without it. A grouping that mattered still shows up
// as a different tree shape.
function withoutGroupingFlags(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutGroupingFlags);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'parenthesized')
        .map(([key, entry]) => [key, withoutGroupingFlags(entry)]),
    );
  }
  return value;
}

function outputsOf(source: string, input: unknown): unknown {
  try {
    return {
      outputs: evaluateBxl(source, input, { readableSyntax: false }).outputs,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const input = {
  n: 1,
  at: true,
  a: null,
  b: 'B',
  c: false,
  k: 'dyn',
  id: 'id-1',
  xs: [1, 2, 3],
  items: [
    { n: 1, at: true, id: 'i1' },
    { n: 2, at: true, id: 'i2' },
    { n: 1, at: false, id: 'i3' },
  ],
  'a b': 'spaced',
  if: 'kw',
};

// [source, the canonical text it must print as]. The expected text is the
// minimal spelling the printer promises, written by hand.
const printerCases: [string, string][] = [
  // Keyword operators keep their spaces.
  [
    '.n as $n | .items | map(select(.n == $n and .at))',
    '.n as $n|.items|map(select(.n==$n and .at))',
  ],
  ['.a or .b and .c', '.a or .b and .c'],
  ['(.a or .b) and .c', '(.a or .b) and .c'],
  ['.at | not', '.at|not()'],
  ['(.c | not) or .a', '(.c|not()) or .a'],
  ['.a == null and (.b == "B" or .c)', '.a==null and (.b=="B" or .c)'],
  // Alternatives, including one that must stay grouped to the right.
  ['.a // .b // "x"', '.a//.b//"x"'],
  ['.a // (.c // "x")', '.a//(.c//"x")'],
  ['(.a // .b) | ascii_downcase', '(.a//.b)|ascii_downcase()'],
  ['.missing? // "d"', '.missing? //"d"'],
  // Arithmetic grouping: `1 - (2 - 3)` is 2, `1 - 2 - 3` is -4.
  ['1 - (2 - 3)', '1-(2-3)'],
  ['(1 - 2) - 3', '(1-2)-3'],
  ['1 - 2 - 3', '1-2-3'],
  ['2 * (3 + 4)', '2*(3+4)'],
  ['2 * 3 + 4', '2*3+4'],
  ['-(1 + 2)', '-(1+2)'],
  ['-(-1)', '-(-1)'],
  ['10 - -1', '10--1'],
  // `as` bindings: grouped wherever their body would otherwise swallow what
  // follows.
  ['(. as $c | .b) | ascii_downcase', '(. as $c|.b)|ascii_downcase()'],
  ['[. as $c | $c.b, 1]', '[. as $c|$c.b,1]'],
  ['{a: (. as $c | $c.b), z: 2}', '{a:(. as $c|$c.b),z:2}'],
  ['.n as $x | .xs as $y | $y[$x]', '.n as $x|.xs as $y|$y[$x]'],
  ['.xs | (.[0] as $h | $h) + 1', '.xs|(.[0] as $h|$h)+1'],
  // Comma and pipe.
  ['1, (2 | 3)', '1,(2|3)'],
  ['(1, 2) | . * 10', '(1,2)|.*10'],
  ['{a: (1, 2)}', '{a:(1,2)}'],
  // Object keys: quoted, computed, keyword, shorthand.
  [
    '{"a b": 1, id: .id, (.k): 2, "c": 3, if: 4}',
    '{"a b":1,id:.id,(.k):2,"c":3,if:4}',
  ],
  ['{id}', '{id}'],
  // Paths.
  ['."a b"', '.["a b"]'],
  ['.["a b"]', '.["a b"]'],
  ['.if', '.if'],
  ['.items[0].id', '.items[0].id'],
  ['.xs[1:]', '.xs[1:]'],
  ['.items[] | .id', '.items[]|.id'],
  ['(if .at then .xs else [] end)[0]', '(if .at then .xs else [] end)[0]'],
  ['("abc")[1:]', '("abc")[1:]'],
  // Control structures.
  [
    'if .a then 1 elif .at then 2 else 3 end',
    'if .a then 1 elif .at then 2 else 3 end',
  ],
  ['reduce .xs[] as $x (0; . + $x)', 'reduce .xs[] as $x(0;.+$x)'],
  [
    '[foreach .xs[] as $x (0; . + $x; [$x, .])]',
    '[foreach .xs[] as $x(0;.+$x;[$x,.])]',
  ],
  ['try error("x") catch .', 'try error("x") catch .'],
  ['(try error("x") catch .) | length', '(try error("x") catch .)|length()'],
  ['.b | @base64', '.b|@base64'],
  // The lottery key, and ordering by it.
  [
    '[.items[] | {id: .id, k: sha256("s42" + .id)}] | sort_by(.k) | map(.id)',
    '[.items[]|{id:.id,k:sha256("s42"+.id)}]|sort_by(.k)|map(.id)',
  ],
];

for (const [source, canonical] of printerCases) {
  const original = parseExpr(source);
  const printed = printMutationAst(original);
  strictEqual(printed, canonical, `prints ${source}`);
  const reparsed = parseExpr(printed);
  deepStrictEqual(
    withoutGroupingFlags(reparsed),
    withoutGroupingFlags(original),
    `${source}: canonical text re-parses to the same tree`,
  );
  strictEqual(
    printMutationAst(reparsed),
    printed,
    `${source}: printing is a fixed point`,
  );
  deepStrictEqual(
    outputsOf(printed, input),
    outputsOf(source, input),
    `${source}: canonical text evaluates the same`,
  );
  checks += 4;
}

// Two that matter for their values, spelled out so the evaluation check above
// is not comparing two equally wrong answers.
deepStrictEqual(outputsOf('1-(2-3)', null), { outputs: [2] });
deepStrictEqual(
  outputsOf('.n as $n|.items|map(select(.n==$n and .at))|map(.id)', input),
  { outputs: [['i1']] },
);
checks += 2;

// The readable compiler had the same `?` + `//` adjacency: `.a? // .b` came
// out as `.a?//.b`, which the tokenizer reads as the destructuring operator.
{
  const compiled = compileReadableSyntax('.missing? // "d"', {}).source;
  const expr = parseExpr(compiled);
  strictEqual(expr.type, 'binary');
  strictEqual(expr.type === 'binary' ? expr.operator : undefined, '//');
  deepStrictEqual(outputsOf(compiled, {}), { outputs: ['d'] });
  checks += 3;
}

// Whole mutation programs: lowering canonicalizes a program, the realm runs the
// canonical text as solidified jq, and canonicalizing that again changes
// nothing. Each program also plans the same output from both spellings.
const schema: BxlMutationSchema = {
  fields: [
    { key: 'n', label: 'N', kind: 'scalar' },
    { key: 'at', label: 'At', kind: 'scalar' },
    { key: 'seed', label: 'Seed', kind: 'scalar' },
    { key: 'note', label: 'Note', kind: 'scalar' },
    { key: 'total', label: 'Total', kind: 'scalar' },
    { key: 'order', label: 'Order', kind: 'array', fieldType: 'containsMany' },
    {
      key: 'picked',
      label: 'Picked',
      kind: 'array',
      fieldType: 'containsMany',
    },
    {
      key: 'items',
      label: 'Items',
      kind: 'array',
      fieldType: 'containsMany',
      item: {
        fields: [
          { key: 'n', label: 'N', kind: 'scalar' },
          { key: 'at', label: 'At', kind: 'scalar' },
          { key: 'id', label: 'Id', kind: 'scalar' },
        ],
      },
    },
  ],
};

const entrants = [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }];
const card: BxlMutationJson = {
  n: 1,
  at: true,
  seed: 's42',
  note: null,
  total: 2,
  order: [],
  picked: [],
  items: [
    { n: 1, at: true, id: 'i1' },
    { n: 2, at: true, id: 'i2' },
    { n: 1, at: false, id: 'i3' },
  ],
};
const context = {
  params: { entrants, bonus: 3, note: null },
  instance: { seed: 's42' },
};

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
const lotteryOrder = entrants
  .map((entrant) => entrant.id)
  .sort((left, right) =>
    sha256(`s42${left}`) < sha256(`s42${right}`) ? -1 : 1,
  );

const programs: {
  source: string;
  canonical: string;
  expect?: Partial<Record<string, unknown>>;
}[] = [
  {
    source:
      '.picked = (.n as $n | [.items[] | select(.n == $n and .at) | .id]);',
    canonical: '.picked=.n as $n|[.items[]|select(.n==$n and .at)|.id];',
    expect: { picked: ['i1'] },
  },
  {
    source: '.picked = [.items[] | select((.n == 2) or (.at | not)) | .id];',
    // Parentheses the author put around an operand are kept.
    canonical: '.picked=[.items[]|select((.n==2) or (.at|not()))|.id];',
    expect: { picked: ['i2', 'i3'] },
  },
  {
    source: '.picked = ((. as $c | $c.items) | map(.id));',
    canonical: '.picked=(. as $c|$c.items)|map(.id);',
    expect: { picked: ['i1', 'i2', 'i3'] },
  },
  {
    source: '.note = (params("note") // "fallback");',
    canonical: '.note=params("note")//"fallback";',
    expect: { note: 'fallback' },
  },
  {
    source: '.total = .total - (params("bonus") - 1);',
    canonical: '.total=.total-(params("bonus")-1);',
    expect: { total: 0 },
  },
  {
    source: '.total *= params("bonus") + 1;',
    canonical: '.total*=params("bonus")+1;',
    expect: { total: 8 },
  },
  // A compound assignment reads its right-hand side from the whole card, so
  // `.n` here is the card's `n` (1), not `.total.n`. Respelling it as
  // `.total |= . + .n` would index the number 2.
  {
    source: '.total += .n;',
    canonical: '.total+=.n;',
    expect: { total: 3 },
  },
  {
    source:
      '.order = [params("entrants")[] | { id: .id, k: sha256(instance("seed") + .id) }] | sort_by(.k) | map(.id);',
    canonical:
      '.order=[params("entrants")[]|{id:.id,k:sha256(instance("seed")+.id)}]|sort_by(.k)|map(.id);',
    expect: { order: lotteryOrder },
  },
  {
    source:
      '.order = params("entrants") | sort_by(sha256(instance("seed") + .id)) | map(.id);',
    canonical:
      '.order=params("entrants")|sort_by(sha256(instance("seed")+.id))|map(.id);',
    expect: { order: lotteryOrder },
  },
];

function plan(source: string, syntax: 'readable' | 'solidified') {
  const prepared = prepareBxlMutation(source, {
    schema,
    targetKind: 'card',
    syntax,
  });
  return {
    canonical: prepared.canonicalSource,
    output: prepared.plan(structuredClone(card), {
      programId: 'canonical-roundtrip',
      context,
    }).output,
  };
}

for (const program of programs) {
  for (const syntax of ['readable', 'solidified'] as const) {
    const first = plan(program.source, syntax);
    strictEqual(
      first.canonical,
      program.canonical,
      `${syntax}: canonicalizes ${program.source}`,
    );
    const second = plan(first.canonical, 'solidified');
    strictEqual(
      second.canonical,
      first.canonical,
      `${syntax}: canonical form is a fixed point for ${program.source}`,
    );
    deepStrictEqual(
      second.output,
      first.output,
      `${syntax}: canonical form plans the same output for ${program.source}`,
    );
    for (const [key, value] of Object.entries(program.expect ?? {})) {
      deepStrictEqual(
        (first.output as Record<string, unknown>)[key],
        value,
        `${syntax}: ${program.source} writes ${key}`,
      );
    }
    checks += 3 + Object.keys(program.expect ?? {}).length;
  }
}

console.log(`BXL mutation canonical printer: ${checks} checks passed`);
