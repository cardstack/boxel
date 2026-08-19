// Drift guard for the card-authoring skill.
//
// The `bxl-authoring` agent skill
// (packages/boxel-cli/plugin/skills/bxl-authoring/SKILL.md) teaches card
// authors a set of concrete behaviors — which tag preserves `\(…)`, what the
// derive profile refuses, how an aggregate reads a collection, what a blank
// input produces. It ships to authors who cannot run the engine to check, so
// each behavioral claim is pinned here twice:
//
//   1. The snippet the skill shows must still appear in the skill text, so a
//      rewrite that changes an example has to come through this file.
//   2. The behavior that snippet claims must still hold against the engine.
//
// What that does and does not cover is worth stating plainly, because a guard
// trusted past its reach is worse than none. It covers the engine behaviors
// reachable from plain Node: tag dispatch, every derive refusal and every
// allowed form, the aggregate-collect rules, the blank-input table, sentinel
// versus non-sentinel failure, the date-function zone sweep, memoization modes,
// `{ as: … }` shapes, and self-enumeration. Two things it cannot check:
//
//   - Prose. A `shows()` snippet proves the example is still on the page, not
//     that the sentence around it still says the right thing. The reason
//     columns, the guidance paragraphs, and §7/§10's architectural claims are
//     read by people, not by this file.
//   - Anything needing a live card runtime. Query-backed inverse staleness and
//     the `{ id }` clip across a cycle are pinned by the host integration
//     suites the skill names, and the last case here asserts those pointers
//     resolve. §10's stale-paint interaction with Glimmer's render flush is NOT
//     pinned anywhere — it follows from runloop ordering, and the mitigation
//     the skill gives (`memoize: false`) is what is pinned.

import { existsSync, readFileSync } from 'node:fs';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { join } from 'node:path';
import {
  evaluateBxl,
  expression,
  fx,
  jq,
  loadAllFormulaExtensions,
} from '../../src/index.ts';

// The host folds every lazy formula family into the default library set before
// serving `@cardstack/bxl` to card code, so a card reaches `NPV` and `isEmail`
// as readily as `ROUND`. Do the same here or those cases would assert against a
// narrower library than the skill's audience has.
await loadAllFormulaExtensions();

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

/**
 * The bullet paragraph introduced by `lead`, up to the blank line that ends it.
 * Used to pin which list a name is in — a name that moves between the refused
 * and allowed lists has to move in this file too.
 */
function paragraph(lead: string): string {
  const start = skill.indexOf(lead);
  ok(start !== -1, `the skill no longer has a "${lead}" paragraph`);
  const end = skill.indexOf('\n\n', start);
  return flatten(skill.slice(start, end === -1 ? undefined : end));
}

/** Asserts `name` is listed in `lead`'s paragraph and not in `otherLead`'s. */
function listedUnder(name: string, lead: string, otherLead: string) {
  const mine = paragraph(lead);
  const theirs = paragraph(otherLead);
  ok(mine.includes(name), `"${name}" is no longer listed under "${lead}"`);
  ok(
    !theirs.includes(name),
    `"${name}" has moved into "${otherLead}" — this case says otherwise`,
  );
}

const REFUSED_LEAD = 'Refused: volatile calls';
const ALLOWED_LEAD = 'Allowed and useful:';

// ------------------------------------------------- tag dispatch

check('a plain string drops the backslash before `(`', () => {
  shows('expression(\'"\\(.bpSystolic)/\\(.bpDiastolic)"\')');
  // The escape is the subject of the case, so the source is spelled the way an
  // author spells it and the assertion below shows what JS hands on.
  // eslint-disable-next-line no-useless-escape -- the useless escape IS the trap
  const asAuthorTyped = '"\(.bpSystolic)/\(.bpDiastolic)"';
  strictEqual(
    evaluateBxl(asAuthorTyped, { bpSystolic: 120, bpDiastolic: 80 }).value,
    '(.bpSystolic)/(.bpDiastolic)',
    'the interpolation is inert, and nothing throws to say so',
  );
});

check('either tag preserves the interpolation', () => {
  shows('expression(jq`"\\(.bpSystolic)/\\(.bpDiastolic)"`)');
  shows('Either tag preserves it — both read the raw strings');
  const bp = { bpSystolic: 120, bpDiastolic: 80 };
  strictEqual(
    expression(jq`"\(.bpSystolic)/\(.bpDiastolic)"`).call(bp),
    '120/80',
  );
  strictEqual(
    expression(fx`"\(.bpSystolic)/\(.bpDiastolic)"`).call(bp),
    '120/80',
    'fx reads String.raw too, so the checklist must say tagged, not jq-tagged',
  );
});

check('a PascalCase label inside an interpolation is not resolved', () => {
  shows("throws `'PaidAmount/0' is not defined` the first");
  shows('Write the path — `` fx`"\\(.paidAmount) paid"` ``');
  const card = { paidAmount: 10 };
  // Construction is fine either way; the failure waits for the first read.
  const unresolved = expression(fx`"\(PaidAmount) paid"`);
  let message = '';
  try {
    unresolved.call(card);
  } catch (error) {
    message = (error as Error).message;
  }
  ok(
    message.includes(`'PaidAmount/0' is not defined`),
    `expected an undefined-function throw, got: ${message.split('\n')[0]}`,
  );
  strictEqual(
    expression(fx`"\(.paidAmount) paid"`).call(card),
    '10 paid',
    'the path spelling is what works',
  );
});

check('the tag table rows still read true', () => {
  // The "Why" column is the reason an author picks a tag, so it is pinned with
  // the row rather than left to prose.
  shows(
    '| `\\(…)` jq interpolation                     | `` jq`…` ``     | A plain string drops the backslash — see trap 4        |',
  );
  shows(
    '| Bare PascalCase field labels (`PaidAmount`) | `` fx`…` ``     | The compiler resolves them to `.paidAmount`            |',
  );
  shows(
    '| Quoted multi-word labels (`"Line Item"`)    | `fx` + `schema` | Label resolution needs the schema — see trap 3         |',
  );
  strictEqual(expression(fx`PaidAmount`).bxl.compiledSource, '.paidAmount');
  strictEqual(
    expression('PaidAmount').bxl.compiledSource,
    '.paidAmount',
    'a plain string compiles like fx, which the row below the table states',
  );
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
  for (const name of [
    'TODAY',
    'NOW',
    'RAND',
    'RANDBETWEEN',
    '@User',
    '$new',
    'def',
    'try',
    'catch',
    'error',
    'label',
    'break',
    '|=',
    '..',
    '@csv',
    'debug',
    'env',
    'input',
    'builtins',
  ]) {
    listedUnder(name, REFUSED_LEAD, ALLOWED_LEAD);
  }
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

check(
  'every form the skill lists as allowed runs and produces its value',
  () => {
    shows('Allowed and useful: `IFERROR` / `IFNA` · optional access (`.a?`)');
    for (const name of [
      'IFERROR',
      'IFNA',
      '.a?',
      'SUM',
      'AVERAGE',
      'COUNT',
      'NPV',
      'isEmail',
      'LET',
      'reduce',
      'foreach',
      'keys',
      'to_entries',
      'group_by',
      'unique',
      'tojson',
    ]) {
      listedUnder(name, ALLOWED_LEAD, REFUSED_LEAD);
    }

    // Constructing proves nothing on its own: the derive profile only screens the
    // names it bans, so a name the registry has never heard of constructs too.
    // Each of these therefore evaluates, and an unknown name is the control.
    const card = {
      amount: 4,
      claims: [{ paid: 10 }, { paid: 5 }],
      cashFlows: [-100, 60, 60],
      email: 'ops@example.com',
      items: [1, 2, 3],
      status: 'Open',
      a: 7,
    };
    const allowed: Array<[string, () => unknown, unknown]> = [
      ['IFERROR', () => expression(fx`IFERROR(Amount, 0)`).call(card), 4],
      ['IFNA', () => expression(fx`IFNA(Amount, 0)`).call(card), 4],
      ['optional access', () => expression(jq`.a?`).call(card), 7],
      ['SUM', () => expression(fx`SUM([Claims[].Paid])`).call(card), 15],
      [
        'AVERAGE',
        () => expression(fx`AVERAGE([Claims[].Paid])`).call(card),
        7.5,
      ],
      ['COUNT', () => expression(fx`COUNT([Claims[].Paid])`).call(card), 2],
      [
        'NPV',
        () => expression(fx`ROUND(NPV(0.1, CashFlows), 4)`).call(card),
        3.7566,
      ],
      ['isEmail', () => expression(fx`isEmail(Email)`).call(card), true],
      [
        'LET',
        () => expression(fx`LET(t, SUM([Claims[].Paid]), t > 100)`).call(card),
        false,
      ],
      ['binding', () => expression(jq`. as $x | $x.a`).call(card), 7],
      [
        'reduce',
        () => expression(jq`reduce .items[] as $i (0; . + $i)`).call(card),
        6,
      ],
      [
        'foreach',
        () =>
          expression(jq`[foreach .items[] as $i (0; . + $i)] | last`).call(
            card,
          ),
        6,
      ],
      [
        'group_by',
        () => expression(jq`[.claims[]] | group_by(.paid) | length`).call(card),
        2,
      ],
      [
        'unique',
        () => expression(jq`[.claims[] | .paid] | unique | length`).call(card),
        2,
      ],
      ['to_entries', () => expression(jq`to_entries | length`).call(card), 7],
      ['keys', () => expression(jq`keys | length`).call(card), 7],
      ['tojson', () => expression(jq`tojson | length > 0`).call(card), true],
    ];
    for (const [label, run, expected] of allowed) {
      strictEqual(
        rejectionCode(() => run()),
        'accepted',
        `${label} threw`,
      );
      strictEqual(run(), expected, `${label} produced the wrong value`);
    }

    const unknown = expression(fx`TOTALLYFAKE(1)`);
    let controlMessage = '';
    try {
      unknown.call(card);
    } catch (error) {
      controlMessage = (error as Error).message;
    }
    ok(
      controlMessage.includes('is not defined'),
      'control: an unknown function name must fail on read, or the cases above prove nothing',
    );
  },
);

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

check('the WRONG example is the uncollected one', () => {
  // Pinning the two code lines against their comments, not just the sources:
  // swapping them would otherwise leave both snippets on the page and teach the
  // exact inverse of the trap.
  shows(
    '// WRONG — compiles to SUM(.claims[].paid); with two claims the field gets [10, 5]\ncomputeVia: expression(fx`SUM(Claims[].Paid)`);',
  );
  shows(
    '// RIGHT — collect first, then aggregate: 15\ncomputeVia: expression(fx`SUM([Claims[].Paid])`);',
  );
  shows(
    '// RIGHT — the jq spelling, with a fallback for the empty case\ncomputeVia: expression(jq`[.claims[] | .paidAmount] | add // 0`);',
  );
  const compute = expression(jq`[.claims[] | .paidAmount] | add // 0`);
  strictEqual(compute.call({ claims: [] }), 0);
  strictEqual(
    compute.call({ claims: [{ paidAmount: 10 }, { paidAmount: 5 }] }),
    15,
  );
});

check('the collect rule is only for the argument that iterates', () => {
  shows('Collect **the argument that iterates**, and only that one');
  shows(
    '`SUM(Amounts)` over a `containsMany(NumberField)` is correct as it stands',
  );
  strictEqual(
    expression(fx`SUM(Amounts)`).call({ amounts: [10, 5] }),
    15,
    'an array-valued field is one value already',
  );

  shows('`SUM(Paid, Reserve)` compiles to');
  shows('`SUM([.paid, .reserve])`, and even `SUM(Claims[].Paid, 0)` becomes');
  shows('`SUM([.claims[].paid, 0])`');
  strictEqual(
    expression(fx`SUM(Paid, Reserve)`).bxl.compiledSource,
    'SUM([.paid, .reserve])',
  );
  const multiArg = expression(fx`SUM(Claims[].Paid, 0)`);
  strictEqual(multiArg.bxl.compiledSource, 'SUM([.claims[].paid, 0])');
  strictEqual(
    multiArg.call(twoClaims),
    15,
    'a comma list collects, so the multi-argument spelling never showed the trap',
  );

  shows('**Never wrap a scalar parameter.** `ROUND([1.234], 2)` and');
  shows(
    '`NPV([0.1], CashFlows)` hand an array to a function that wants a number',
  );
  strictEqual(
    expression(fx`ROUND([1.234], 2)`).call({}),
    null,
    'a wrapped scalar blanks the field',
  );
  strictEqual(
    expression(fx`NPV([0.1], CashFlows)`).call({ cashFlows: [-100, 60, 60] }),
    null,
  );
  strictEqual(
    expression(fx`ROUND(NPV(0.1, CashFlows), 4)`).call({
      cashFlows: [-100, 60, 60],
    }),
    3.7566,
    'unwrapped, the same call works',
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
  // Whole rows, reason column included: the stated mechanism is as much a claim
  // as the value, and a wrong mechanism is what sends an author down a wrong fix.
  const rows: Array<[string, () => unknown, unknown]> = [
    [
      '| `` fx`Paid + Reserve` ``              | `null`  | null propagates through arithmetic          |',
      () => expression(fx`Paid + Reserve`).call(noAmounts),
      null,
    ],
    [
      '| `` fx`Paid + 5` ``                    | `5`     | a null addend contributes nothing           |',
      () => expression(fx`Paid + 5`).call(noAmounts),
      5,
    ],
    [
      '| `` fx`SUM(Paid, Reserve)` ``          | `0`     | aggregates skip blanks, Excel-style         |',
      () => expression(fx`SUM(Paid, Reserve)`).call(noAmounts),
      0,
    ],
    [
      '| `` fx`ROUND(Paid + Reserve)` ``       | `0`     | `ROUND` absorbs a null operand              |',
      () => expression(fx`ROUND(Paid + Reserve)`).call(noAmounts),
      0,
    ],
    [
      '| `` fx`Premium / 0` ``                 | `null`  | division by zero yields null, not `#DIV/0!` |',
      () => expression(fx`Premium / 0`).call({ premium: 100 }),
      null,
    ],
    [
      '| `` jq`[.claims[] \\| .paid] \\| add` `` | `null`  | `add` over an empty array is null           |',
      () => expression(jq`[.claims[] | .paid] | add`).call({ claims: [] }),
      null,
    ],
    [
      '| `` jq`.name \\| startswith("a")` ``    | `false` | string predicates on null are false         |',
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
  shows('caught at the factory boundary, which returns `null`');
  shows('`` fx`INDEX(Rows, 99)` `` leaves one blank field');
  strictEqual(expression(fx`NA()`).call(noAmounts), null);
  strictEqual(expression(fx`INDEX(Rows, 99)`).call({ rows: [1, 2, 3] }), null);
  // Every sentinel the skill names has to be one this engine actually raises,
  // or an author waits for an error that never comes. #NAME? is deliberately
  // absent from that list: nothing throws it, and the failure it stands for in
  // a spreadsheet — an unknown function — is the non-sentinel case below.
  for (const sentinel of ['#N/A', '#DIV/0!', '#VALUE!', '#REF!', '#NUM!']) {
    shows(sentinel);
  }
  ok(
    !skillFlat.includes('#NAME?'),
    'the skill lists #NAME?, which this engine never raises',
  );
});

check('a sentinel blanks the whole expression, not just its own call', () => {
  shows('`` fx`ROUND(NA()) + 5` `` is null, not 5');
  shows('even though `ROUND` absorbs a null operand');
  strictEqual(
    expression(fx`ROUND(Paid) + 5`).call(noAmounts),
    5,
    'a null operand is absorbed by ROUND, so the addition still runs',
  );
  strictEqual(
    expression(fx`ROUND(NA()) + 5`).call(noAmounts),
    null,
    'a sentinel propagates out of ROUND and blanks the field',
  );
});

check(
  'a non-sentinel failure fails the card instead of blanking a field',
  () => {
    shows("gives `'SUMM/1' is not defined`");
    shows('surface as an indexing error on the instance, not as a blank field');
    // A misspelled name passes the profile check — nothing validates that a name
    // exists — and throws on first read, which is what reaches the indexer.
    const misspelled = expression(fx`SUMM([Amounts])`);
    let message = '';
    try {
      misspelled.call({ amounts: [1, 2] });
    } catch (error) {
      message = (error as Error).message;
    }
    ok(
      message.includes(`'SUMM/1' is not defined`),
      `expected an undefined-function throw, got: ${message.split('\n')[0] || '(no throw)'}`,
    );

    shows('(`` jq`unique` `` over an object rather than an array)');
    let structuralMessage = '';
    try {
      expression(jq`unique`).call({ a: 1 });
    } catch (error) {
      structuralMessage = (error as Error).message;
    }
    ok(
      structuralMessage.length > 0,
      'a structural op on the wrong shape must throw rather than blank the field',
    );
  },
);

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

/**
 * Installs `source` as a computed getter on a record and reads it, counting how
 * many times the getter is entered — one entry is the read itself, a second is
 * the program re-entering the field it is producing.
 */
function selfRead(source: unknown) {
  const compute = expression(source as never);
  let entries = 0;
  const record: Record<string, unknown> = {
    a: 1,
    get derived() {
      entries += 1;
      return compute.call(this);
    },
  };
  try {
    return { value: record.derived, entries, threw: false };
  } catch (error) {
    return { value: (error as Error).message, entries, threw: true };
  }
}

check(
  'reading a record’s own values re-enters and reads the field blank',
  () => {
    shows('`` jq`tojson` `` on a card yields `{"a":1,"derived":null}`');
    const serialized = selfRead(jq`tojson`);
    strictEqual(serialized.threw, false);
    strictEqual(serialized.value, '{"a":1,"derived":null}');
    strictEqual(serialized.entries, 2, 'the program re-entered the field');
  },
);

check('`keys` reads field names, so nothing re-enters', () => {
  shows('it reads the field names, never their values, so nothing re-enters');
  const named = selfRead(jq`keys`);
  strictEqual(named.threw, false);
  deepStrictEqual(named.value, ['a', 'derived']);
  strictEqual(named.entries, 1, 'no re-entry — the values were never read');
});

check('`unique` over a record throws rather than reading blank', () => {
  shows('is not a self-reference problem at all — it throws, because `unique`');
  const deduped = selfRead(jq`unique`);
  strictEqual(deduped.threw, true, 'unique over an object must throw');
});

// ------------------------------------------------- the skill's own pointers

check('every repo path the skill cites exists', () => {
  const cited = new Set(
    Array.from(
      skill.matchAll(/`(packages\/[A-Za-z0-9._/-]+)`/g),
      (match) => match[1],
    ),
  );
  // A floor on the count would let a citation be dropped silently, so the
  // pointers the skill's pinned-rules list is built on are named here.
  for (const required of [
    'packages/bxl/tests/boxel/authoring-skill-claims.ts',
    'packages/host/tests/helpers/cards/bxl-tracking.ts',
    'packages/host/tests/integration/bxl-expression-test.gts',
    'packages/host/tests/integration/bxl-platform-module-test.gts',
    'packages/host/tests/integration/bxl-cyclic-graph-test.gts',
    'packages/bxl/tests/boxel/',
    'packages/bxl/docs/',
  ]) {
    ok(cited.has(required), `the skill no longer cites ${required}`);
  }
  for (const path of cited) {
    ok(existsSync(join(REPO_ROOT, path)), `the skill cites a missing ${path}`);
  }
  // The docs are cited by bare filename, relative to the `packages/bxl/docs/`
  // entry above, so a rename there would otherwise slip through.
  for (const doc of Array.from(
    skill.matchAll(/`([a-z-]+\.md)`/g),
    (match) => match[1],
  )) {
    ok(
      existsSync(join(REPO_ROOT, 'packages/bxl/docs', doc)),
      `the skill cites a missing packages/bxl/docs/${doc}`,
    );
  }
});

// ----------------------------------------------------------------

console.log(`BXL authoring-skill claims: ${pass}/${pass + fail} cases passed`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
