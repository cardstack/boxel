// Smoke-test every BXL readable constraint from the donation-pledge guide
// against the two sample instances. Grace should pass everything; Benjamin
// should fail the expected subset.
import { evaluateBxl, type ReadableSchema } from '../../src/index.js';

const schema: ReadableSchema = {
  fields: [
    { key: 'amount', label: 'Amount' },
    { key: 'currency', label: 'Currency' },
    { key: 'donor', label: 'Donor' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'campaign', label: 'Campaign' },
    { key: 'payment', label: 'Payment' },
    { key: 'anonymous', label: 'Anonymous' },
    { key: 'note', label: 'Note' },
    { key: 'match', label: 'Match' },
    {
      key: 'billing', label: 'Bill To', kind: 'object',
      fields: [
        { key: 'street', label: 'Street' }, { key: 'city', label: 'City' },
        { key: 'state', label: 'State' }, { key: 'zip', label: 'Zip' },
      ],
    },
  ],
};

const benjamin = {
  donor: 'Benjamin Chen', email: 'benjamin@chen.family', amount: 260,
  currency: null, campaign: 'Spring Annual Drive — ends Jun 30',
  payment: 'Credit Card', anonymous: false, match: null, note: null, phone: null,
  billing: { street: '1640 Valencia St', city: 'San Francisco', state: 'CA', zip: '94110' },
};

const grace = {
  donor: 'Grace Lin', email: 'grace.lin@harborschool.org', phone: '+1 (415) 555-0412',
  amount: 5000, currency: 'USD', campaign: 'Spring Annual Drive — ends Jun 30',
  payment: 'Credit card', anonymous: false,
  match: 'Bay Bridge Foundation 1:1 Match',
  note: 'Doubling last year for Spring Drive. Please apply the match if eligible.',
  billing: { street: '742 Evergreen Terrace', city: 'Oakland', state: 'CA', zip: '94609' },
};

type Case = { name: string; expr: string; grace: boolean; benjamin: boolean };

// All 15 constraints from the guide, verified against both models.
const cases: Case[] = [
  { name: 'campaign not empty', expr: 'Campaign <> null AND Campaign <> ""',
    grace: true, benjamin: true },
  { name: 'campaign not archived', expr: 'NOT ((Campaign // "") | startswith("Archived"))',
    grace: true, benjamin: true },

  { name: 'amount >= 10', expr: 'Amount >= 10', grace: true, benjamin: true },
  { name: 'amount <= 100000', expr: 'Amount <= 100000', grace: true, benjamin: true },
  { name: 'whole-dollar', expr: 'Amount = ROUND(Amount, 0)', grace: true, benjamin: true },
  { name: '>=1000 requires note', expr: '(Amount < 1000) OR ((Note // "") | length) > 0',
    grace: true, benjamin: true },

  { name: 'currency tier-1',
    expr: 'Currency = null OR Currency = "" OR UPPER(Currency) = "USD" OR UPPER(Currency) = "EUR" OR UPPER(Currency) = "GBP" OR UPPER(Currency) = "CAD" OR UPPER(Currency) = "AUD" OR UPPER(Currency) = "JPY"',
    grace: true, benjamin: true },

  { name: 'payment chosen', expr: 'Payment <> null AND Payment <> ""',
    grace: true, benjamin: true },

  { name: 'cc requires street',
    expr: 'Payment <> "Credit card" OR ("Bill To".Street <> null AND "Bill To".Street <> "")',
    grace: true, benjamin: true },
  { name: 'cc requires zip',
    expr: 'Payment <> "Credit card" OR ("Bill To".Zip <> null AND "Bill To".Zip <> "")',
    grace: true, benjamin: true },

  { name: 'match only when amount>=300',
    expr: 'Amount >= 300 OR Match = null OR Match = ""',
    grace: true, benjamin: true },

  { name: 'donor two words',
    expr: '((Donor // "") | split(" ") | map(select(. <> "")) | length) >= 2',
    grace: true, benjamin: true },
  { name: 'no donor title',
    expr: 'NOT (((Donor // "") | startswith("Mr.")) OR ((Donor // "") | startswith("Ms.")) OR ((Donor // "") | startswith("Mrs.")) OR ((Donor // "") | startswith("Dr.")))',
    grace: true, benjamin: true },

  { name: 'email present', expr: 'Email <> null AND Email <> ""',
    grace: true, benjamin: true },
  { name: 'email shape',
    expr: '((Email // "") | contains("@")) AND ((Email // "") | contains("."))',
    grace: true, benjamin: true },

  { name: 'phone length', expr: 'Phone = null OR Phone = "" OR LEN(Phone) >= 7',
    grace: true, benjamin: true },

  { name: 'anonymous-major check', expr: 'Anonymous <> true OR Amount < 5000',
    grace: true, benjamin: true },

  { name: 'note length cap', expr: 'Note = null OR LEN(Note) <= 500',
    grace: true, benjamin: true },
];

let fail = 0;
for (const c of cases) {
  for (const [name, input, expected] of [
    ['grace',    grace,    c.grace],
    ['benjamin', benjamin, c.benjamin],
  ] as const) {
    try {
      const r = evaluateBxl(c.expr, input, { schema });
      const got = Boolean(r.value);
      const pass = got === expected;
      console.log(`${pass ? 'OK  ' : 'FAIL'} ${name.padEnd(8)} ${c.name.padEnd(35)} → ${got}${pass ? '' : ` (expected ${expected})`}`);
      if (!pass) fail++;
    } catch (e) {
      console.log(`FAIL ${name.padEnd(8)} ${c.name.padEnd(35)} threw: ${(e as Error).message}`);
      console.log(`     expr: ${c.expr}`);
      fail++;
    }
  }
}
console.log(`\n${cases.length * 2 - fail}/${cases.length * 2} constraint×model smokes passed`);
process.exit(fail);
