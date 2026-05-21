import { evaluateBxl } from '../../src/index.js';

const cases: Array<{ name: string; src: string; input: unknown; expected: unknown }> = [
  {
    name: 'single-arg lowercase helper',
    src: `def double(x): x * 2; double(.n)`,
    input: { n: 7 },
    expected: 14,
  },
  {
    name: 'lowercase helper next to Excel SUM',
    src: `def band(n): if n >= 90 then "high" elif n >= 70 then "medium" else "low" end;
def triple(x): x * 3;
{ band: band(.score), tripled: triple(.score), total: SUM([.items[].price]) }`,
    input: { score: 84, items: [{ price: 3 }, { price: 5 }] },
    expected: { band: 'medium', tripled: 252, total: 8 },
  },
  {
    name: 'zero-arg pipeline helper',
    src: `def squared: . * .; .n | squared`,
    input: { n: 9 },
    expected: 81,
  },
  {
    name: 'local helper shadows builtin',
    src: `def length: 42; .items | length`,
    input: { items: ['a', 'b', 'c'] },
    expected: 42,
  },
  {
    name: 'recursion — factorial',
    src: `def fact: if . <= 1 then 1 else . * (. - 1 | fact) end; .n | fact`,
    input: { n: 6 },
    expected: 720,
  },
  {
    name: 'multi-arg helper (semicolon-separated, jq-style)',
    src: `def clamp(lo; hi; x): (x | if . < lo then lo elif . > hi then hi else . end); clamp(0; 100; .score)`,
    input: { score: 150 },
    expected: 100,
  },
  {
    name: 'helper composed with implicit iteration',
    src: `def gross(x): x * 1.0825; [.items[] | gross(.price)]`,
    input: { items: [{ price: 10 }, { price: 20 }] },
    expected: [10.825, 21.65],
  },
];

let fail = 0;
for (const c of cases) {
  try {
    const r = evaluateBxl(c.src, c.input);
    const pass = JSON.stringify(r.value) === JSON.stringify(c.expected);
    if (pass) {
      console.log(`OK   ${c.name}`);
    } else {
      console.log(`FAIL ${c.name}`);
      console.log(`     expected ${JSON.stringify(c.expected)}`);
      console.log(`     got      ${JSON.stringify(r.value)}`);
      fail++;
    }
  } catch (e) {
    console.log(`FAIL ${c.name}: ${(e as Error).message}`);
    fail++;
  }
}
console.log(`BXL user-defined helpers: ${cases.length - fail}/${cases.length} passed`);
process.exit(fail);
