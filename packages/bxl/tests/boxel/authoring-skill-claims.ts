// Drift guard for the card-authoring skill.
//
// The `bxl-authoring` agent skill
// (packages/boxel-cli/plugin/skills/bxl-authoring/SKILL.md) teaches card
// authors a set of concrete behaviors — which tag preserves `\(…)`, what the
// derive profile refuses, how an aggregate reads a collection, what a blank
// input produces. It ships to authors who cannot run the engine to check, so
// each claim is pinned here twice:
//
//   1. The snippet the skill shows must still appear in the skill text, so a
//      rewrite that changes an example has to come through this file.
//   2. The behavior that snippet claims must still hold against the engine.
//
// Claims that need a live card runtime — query-backed inverse staleness, the
// `{ id }` clip across a cycle, the memoized-then-written paint — are pinned by
// the host integration suites the skill names; the last case here asserts those
// pointers still resolve.

import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { join } from 'node:path';
import { evaluateBxl, expression, fx, jq } from '../../src/index.ts';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const SKILL_PATH = join(
  REPO_ROOT,
  'packages/boxel-cli/plugin/skills/bxl-authoring/SKILL.md',
);

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    pass++;
  } catch (error) {
    fail++;
    failures.push(`  ${name}\n    ${(error as Error).message.split('\n')[0]}`);
  }
}

if (!existsSync(SKILL_PATH)) {
  console.log(`FAIL: the authoring skill is not at ${SKILL_PATH}`);
  process.exit(1);
}
const skill = readFileSync(SKILL_PATH, 'utf8');
// Runs of whitespace collapse, so rewrapping a paragraph or realigning a table
// column is not a failure — only changing what an example says is.
const flatten = (text: string) => text.replace(/\s+/g, ' ');
const skillFlat = flatten(skill);

/** Asserts the skill still shows this snippet. */
function shows(snippet: string) {
  ok(
    skillFlat.includes(flatten(snippet)),
    `the skill no longer shows \`${snippet}\` — update this case with it`,
  );
}

// ------------------------------------------------- tag dispatch

check('a plain string drops the backslash before `(`', () => {
  shows('expression(\'"\\(.bpSystolic)/\\(.bpDiastolic)"\')');
  // The escape is the subject of the case, so the source is spelled the way an
  // author spells it and the assertion below shows what JS hands on.
  // eslint-disable-next-line no-useless-escape -- the useless escape IS the trap
  const asAuthorTyped = '"\(.bpSystolic)/\(.bpDiastolic)"';
  strictEqual(
    asAuthorTyped,
    '"(.bpSystolic)/(.bpDiastolic)"',
    'a JS string literal drops the backslash before `(`',
  );
  strictEqual(
    evaluateBxl(asAuthorTyped, { bpSystolic: 120, bpDiastolic: 80 }).value,
    '(.bpSystolic)/(.bpDiastolic)',
    'so the interpolation is inert, and nothing throws to say so',
  );
});

check('the jq tag preserves the interpolation', () => {
  shows('expression(jq`"\\(.bpSystolic)/\\(.bpDiastolic)"`)');
  strictEqual(
    expression(jq`"\(.bpSystolic)/\(.bpDiastolic)"`).call({
      bpSystolic: 120,
      bpDiastolic: 80,
    }),
    '120/80',
  );
});

check('fx resolves a bare PascalCase label to a camelCase path', () => {
  shows('The compiler resolves them to `.paidAmount`');
  strictEqual(expression(fx`PaidAmount`).bxl.compiledSource, '.paidAmount');
});

check('IF is the Excel function, if/then/end is the jq construct', () => {
  shows(
    '`IF(cond, t, f)` is the Excel function, `if cond then … end` is the jq',
  );
  strictEqual(
    expression(fx`IF(.status == "Open", 1, 0)`).call({ status: 'Open' }),
    1,
  );
  strictEqual(
    expression(fx`if Status == "Open" then 1 else 0 end`).call({
      status: 'Open',
    }),
    1,
  );
});

// ------------------------------------------------- the derive profile

/** The diagnostic code `expression()` throws for a rejected source. */
function rejectionCode(make: () => unknown): string {
  try {
    make();
  } catch (error) {
    const match = /derive-[a-z-]+/.exec((error as Error).message);
    if (match) return match[0];
    return `no derive code in: ${(error as Error).message.split('\n')[0]}`;
  }
  return 'accepted';
}

check('the diagnostic the skill quotes is the one the factory throws', () => {
  shows(
    'derive-call-banned: Profile.derive is for deterministic write/index-time',
  );
  shows('cannot use call TODAY: volatile calls are not stable write-time');
  let message = '';
  try {
    expression(fx`TODAY()`);
  } catch (error) {
    message = (error as Error).message;
  }
  ok(
    message.startsWith('computeVia expression violates the derive profile:'),
    `unexpected preamble: ${message.split('\n')[0]}`,
  );
  ok(
    message.includes(
      'derive-call-banned: Profile.derive is for deterministic write/index-time computation and cannot use call TODAY: volatile calls are not stable write-time derivations.',
    ),
    'the quoted diagnostic no longer matches',
  );
});

check('every call the skill lists as refused is refused', () => {
  shows(
    'Refused: volatile calls (`TODAY`, `NOW`, `RAND`, `RANDBETWEEN`) · request,',
  );
  const refused: Array<[string, () => unknown, string]> = [
    ['TODAY()', () => expression(fx`TODAY()`), 'derive-call-banned'],
    ['NOW()', () => expression(fx`NOW()`), 'derive-call-banned'],
    ['RAND()', () => expression(fx`RAND()`), 'derive-call-banned'],
    [
      'RANDBETWEEN(1, 6)',
      () => expression(fx`RANDBETWEEN(1, 6)`),
      'derive-call-banned',
    ],
    ['@User.id', () => expression(fx`@User.id`), 'derive-context-banned'],
    ['$new.total', () => expression(fx`$new.total`), 'derive-context-banned'],
    ['def', () => expression(jq`def f: . + 1; f`), 'derive-def-banned'],
    ['try/catch', () => expression(jq`try .a catch "x"`), 'derive-try-banned'],
    ['error', () => expression(jq`error("boom")`), 'derive-call-banned'],
    [
      'label/break',
      () => expression(jq`label $out | .a, break $out`),
      'derive-control-flow-banned',
    ],
    [
      'assignment =',
      () => expression(jq`.total = 5`),
      'derive-assignment-banned',
    ],
    [
      'assignment |=',
      () => expression(jq`.total |= . + 1`),
      'derive-assignment-banned',
    ],
    [
      'recursive descent',
      () => expression(jq`.. | numbers`),
      'derive-recursive-descent-banned',
    ],
    ['@csv', () => expression(jq`[.a, .b] | @csv`), 'derive-format-banned'],
    ['debug', () => expression(jq`debug`), 'derive-call-banned'],
    ['env', () => expression(jq`env`), 'derive-call-banned'],
    ['input', () => expression(jq`input`), 'derive-call-banned'],
    ['builtins', () => expression(jq`builtins | length`), 'derive-call-banned'],
  ];
  for (const [label, make, code] of refused) {
    strictEqual(rejectionCode(make), code, `${label} should be ${code}`);
  }
});

check('every form the skill lists as allowed constructs', () => {
  shows('Allowed and useful: `IFERROR` / `IFNA` · optional access (`.a?`)');
  const allowed: Array<[string, () => unknown]> = [
    ['IFERROR', () => expression(fx`IFERROR(Amount, 0)`)],
    ['IFNA', () => expression(fx`IFNA(Amount, 0)`)],
    ['optional access', () => expression(jq`.a?`)],
    ['SUM', () => expression(fx`SUM([Claims[].Paid])`)],
    ['AVERAGE', () => expression(fx`AVERAGE([Claims[].Paid])`)],
    ['COUNT', () => expression(fx`COUNT([Claims[].Paid])`)],
    ['NPV', () => expression(fx`NPV(0.1, CashFlows)`)],
    ['isEmail', () => expression(fx`isEmail(Email)`)],
    ['LET', () => expression(fx`LET(t, SUM([Claims[].Paid]), t > 100)`)],
    ['binding', () => expression(jq`. as $x | $x.a`)],
    ['reduce', () => expression(jq`reduce .items[] as $i (0; . + $i)`)],
    ['keys', () => expression(jq`keys`)],
    ['to_entries', () => expression(jq`to_entries | map(.key)`)],
    ['group_by', () => expression(jq`group_by(.status) | length`)],
    ['unique', () => expression(jq`[.claims[]] | unique | length`)],
    ['tojson', () => expression(jq`tojson | length`)],
  ];
  for (const [label, make] of allowed) {
    strictEqual(rejectionCode(make), 'accepted', `${label} should construct`);
  }
});

// ------------------------------------------------- aggregates over collections

const twoClaims = { claims: [{ paid: 10 }, { paid: 5 }] };

check('an aggregate over a stream runs per element', () => {
  shows(
    '// WRONG — compiles to SUM(.claims[].paid); with two claims the field gets [10, 5]',
  );
  const compute = expression(fx`SUM(Claims[].Paid)`);
  strictEqual(compute.bxl.compiledSource, 'SUM(.claims[].paid)');
  deepStrictEqual(compute.call(twoClaims), [10, 5]);
});

check('collecting first aggregates once', () => {
  shows('computeVia: expression(fx`SUM([Claims[].Paid])`);');
  const compute = expression(fx`SUM([Claims[].Paid])`);
  strictEqual(compute.bxl.compiledSource, 'SUM([.claims[].paid])');
  strictEqual(compute.call(twoClaims), 15);
});

check('the jq spelling with an empty-case fallback', () => {
  shows('computeVia: expression(jq`[.claims[] | .paidAmount] | add // 0`);');
  const compute = expression(jq`[.claims[] | .paidAmount] | add // 0`);
  strictEqual(compute.call({ claims: [] }), 0);
  strictEqual(
    compute.call({ claims: [{ paidAmount: 10 }, { paidAmount: 5 }] }),
    15,
  );
});

check('a schema makes implicit iteration collect on its own', () => {
  shows('`SUM("Line Item"."Line Total")` compiles to');
  shows('`SUM([.lineItems[].lineTotal])`');
  const schema = {
    fields: [
      {
        key: 'lineItems',
        label: 'Line Item',
        kind: 'array' as const,
        item: { fields: [{ key: 'lineTotal', label: 'Line Total' }] },
      },
    ],
  };
  const run = evaluateBxl(
    'SUM("Line Item"."Line Total")',
    { lineItems: [{ lineTotal: 10 }, { lineTotal: 5 }] },
    { schema },
  );
  strictEqual(run.compiledSource, 'SUM([.lineItems[].lineTotal])');
  strictEqual(run.value, 15);
});

check('a quoted label with no schema fails loudly', () => {
  shows('loudly (`Cannot index string with string`)');
  let message = '';
  try {
    evaluateBxl('SUM("Line Item"."Line Total")', { lineItems: [] });
  } catch (error) {
    message = (error as Error).message;
  }
  ok(
    message.includes('Cannot index string with string'),
    `unexpected message: ${message.split('\n')[0]}`,
  );
});

check('the factory exposes the compiled jq and the dependency list', () => {
  shows(
    "// { source, compiledSource: 'SUM([.claims[].paid])', warnings, deps, memoize }",
  );
  const meta = expression(fx`SUM([Claims[].Paid])`).bxl;
  strictEqual(meta.source, 'SUM([Claims[].Paid])');
  strictEqual(meta.compiledSource, 'SUM([.claims[].paid])');
  deepStrictEqual([...meta.deps], ['claims']);
  strictEqual(meta.memoize, 'microtask');
});

// ------------------------------------------------- blank inputs

const noAmounts = {};

check('the blank-input table still reads true', () => {
  const rows: Array<[string, () => unknown, unknown]> = [
    [
      '| `` fx`Paid + Reserve` ``              | `null`  |',
      () => expression(fx`Paid + Reserve`).call(noAmounts),
      null,
    ],
    [
      '| `` fx`Paid + 5` ``                    | `5`     |',
      () => expression(fx`Paid + 5`).call(noAmounts),
      5,
    ],
    [
      '| `` fx`SUM(Paid, Reserve)` ``          | `0`     |',
      () => expression(fx`SUM(Paid, Reserve)`).call(noAmounts),
      0,
    ],
    [
      '| `` fx`ROUND(Paid + Reserve)` ``       | `0`     |',
      () => expression(fx`ROUND(Paid + Reserve)`).call(noAmounts),
      0,
    ],
    [
      '| `` fx`Premium / 0` ``                 | `null`  |',
      () => expression(fx`Premium / 0`).call({ premium: 100 }),
      null,
    ],
    [
      '| `` jq`[.claims[] \\| .paid] \\| add` `` | `null`  |',
      () => expression(jq`[.claims[] | .paid] | add`).call({ claims: [] }),
      null,
    ],
    [
      '| `` jq`.name \\| startswith("a")` ``    | `false` |',
      () => expression(jq`.name | startswith("a")`).call(noAmounts),
      false,
    ],
  ];
  for (const [row, run, expected] of rows) {
    shows(row);
    strictEqual(run(), expected, `row changed: ${row}`);
  }
});

check('`//` guards a blank operand', () => {
  shows('`(Paid // 0) + (Reserve // 0)`');
  strictEqual(expression(fx`(Paid // 0) + (Reserve // 0)`).call(noAmounts), 0);
});

check('IFERROR does not rescue a division by zero', () => {
  shows('`IFERROR` does **not** rescue it — guard the divisor instead');
  strictEqual(
    expression(fx`IFERROR(Premium / 0, 0)`).call({ premium: 100 }),
    null,
  );
});

check('`&` renders a blank operand as the text null', () => {
  shows('yields `Acme (null)`');
  strictEqual(
    expression(fx`Name & " (" & Tier & ")"`).call({ name: 'Acme' }),
    'Acme (null)',
  );
  shows('fx`Name & " (" & (Tier // "") & ")"`');
  strictEqual(
    expression(fx`Name & " (" & (Tier // "") & ")"`).call({ name: 'Acme' }),
    'Acme ()',
  );
  shows('use `CONCAT` / `TEXTJOIN`, which');
  strictEqual(
    expression(fx`CONCAT(Name, "-", Tier)`).call({ name: 'Acme' }),
    'Acme-',
  );
  strictEqual(
    expression(fx`TEXTJOIN("-", TRUE, Name, Tier)`).call({ name: 'Acme' }),
    'Acme',
  );
});

// ------------------------------------------------- Excel error sentinels

check('an uncaught sentinel lands as null, not a throw', () => {
  shows('caught at the factory boundary, which returns\n`null`');
  strictEqual(expression(fx`NA()`).call(noAmounts), null);
});

check('the catch-it-deliberately examples still work', () => {
  shows('fx`IFERROR(VLOOKUP(Sku, Rows, 2, FALSE), "unlisted")`');
  strictEqual(
    expression(fx`IFERROR(VLOOKUP(Sku, Rows, 2, FALSE), "unlisted")`).call({
      sku: 'x',
      rows: [],
    }),
    'unlisted',
  );
  shows('fx`IFNA(NA(), "none")`');
  strictEqual(expression(fx`IFNA(NA(), "none")`).call(noAmounts), 'none');
  shows('An `AVERAGE` over an empty collection raises');
  strictEqual(
    expression(fx`AVERAGE([Claims[].Paid])`).call({ claims: [] }),
    null,
  );
});

// ------------------------------------------------- dates

check('the date functions the skill calls safe agree across host zones', () => {
  shows('`DATE`, `EDATE`, `EOMONTH`, `WEEKDAY`, `DATEVALUE`, `YEARFRAC`,');
  shows('`DAYS`, `NETWORKDAYS` and friends give one answer across host zones');
  const sources = [
    'DATE(2026, 2, 5)',
    'EDATE(DATE(2026, 2, 5), 1)',
    'EOMONTH(DATE(2026, 2, 5), 1)',
    'WEEKDAY(DATE(2026, 4, 30))',
    'DATEVALUE("April 30, 2026 23:30")',
    'YEARFRAC(DATE(2026, 1, 31), DATE(2026, 3, 31), 0)',
    'DAYS(DATE(2026, 4, 30), DATE(2026, 4, 22))',
    'NETWORKDAYS(DATE(2026, 4, 1), DATE(2026, 4, 30))',
  ];
  // The whole-suite sweep in tests/unit/fixtures/function-coverage runs every
  // registry case under six zones; these two are the pair that moved a
  // calendar day apart when the anchoring was wrong.
  const zones = ['UTC', 'Pacific/Kiritimati'];
  const original = process.env.TZ;
  try {
    const perZone = zones.map((zone) => {
      process.env.TZ = zone;
      return sources.map((source) => evaluateBxl(source, null).value);
    });
    deepStrictEqual(
      perZone[0],
      perZone[1],
      `a date function answers differently under ${zones[1]}`,
    );
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

check('TODAY and NOW are unavailable in a computed', () => {
  shows('`TODAY` and `NOW` are not available in a computed at all');
  strictEqual(
    rejectionCode(() => expression(fx`TODAY()`)),
    'derive-call-banned',
  );
  strictEqual(
    rejectionCode(() => expression(fx`NOW()`)),
    'derive-call-banned',
  );
});

// ------------------------------------------------- memoization

check('memoize: false re-runs on every read', () => {
  shows('memoize: false,');
  const card = { status: 'Open' };
  const memoized = expression(jq`{ label: .status }`);
  strictEqual(
    memoized.call(card),
    memoized.call(card),
    'the default caches within the microtask',
  );
  const fresh = expression(jq`{ label: .status }`, { memoize: false });
  ok(
    fresh.call(card) !== fresh.call(card),
    'memoize: false should hand back a new value each read',
  );
});

// ------------------------------------------------- { as: FieldDef }

check(
  '{ as: … } materializes objects and array elements, passes scalars',
  () => {
    shows('Scalars and null pass through untouched');
    class RiskBand {
      label?: string;
      score?: number;
    }
    const single = expression(jq`{ label: "High", score: 8 }`, {
      as: RiskBand,
    });
    const band = single.call({}) as RiskBand;
    ok(band instanceof RiskBand, 'an object output becomes an instance');
    strictEqual(band.label, 'High');

    const many = expression(jq`[{ label: "a" }, { label: "b" }]`, {
      as: RiskBand,
    });
    const bands = many.call({}) as RiskBand[];
    strictEqual(bands.length, 2);
    ok(
      bands.every((entry) => entry instanceof RiskBand),
      'every element is materialized',
    );

    strictEqual(
      expression(jq`.subtotal`, { as: RiskBand }).call({ subtotal: 3 }),
      3,
      'a scalar passes through',
    );
    strictEqual(
      expression(jq`.missing`, { as: RiskBand }).call({}),
      null,
      'null passes through',
    );
  },
);

// ------------------------------------------------- self-referential compute

check(
  'a compute that enumerates its own record reads that field as blank',
  () => {
    shows('That in-flight read is blank —');
    const selfJson = expression(jq`tojson`);
    const record = {
      a: 1,
      get serialized() {
        return selfJson.call(this);
      },
    };
    strictEqual(
      record.serialized,
      '{"a":1,"serialized":null}',
      'the in-flight field serializes as null instead of recursing',
    );
  },
);

// ------------------------------------------------- the skill's own pointers

check('every repo path the skill cites exists', () => {
  const cited = [
    ...new Set(
      Array.from(
        skill.matchAll(/`(packages\/[A-Za-z0-9._/-]+)`/g),
        (match) => match[1],
      ),
    ),
  ];
  ok(
    cited.length >= 6,
    `expected the pinned-rules list, found ${cited.length}`,
  );
  for (const path of cited) {
    ok(existsSync(join(REPO_ROOT, path)), `the skill cites a missing ${path}`);
  }
});

// ----------------------------------------------------------------

console.log(`BXL authoring-skill claims: ${pass}/${pass + fail} cases passed`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
