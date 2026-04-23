import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import {
  getBoxelValue,
  prepareBoxelRuntimeAsync,
  type BoxelRuntimeDefinition,
  type ReadableSchema,
} from '../../src/index.js';

const schema: ReadableSchema = {
  fields: [
    { key: 'amount', label: 'Donation Amount' },
    { key: 'currency', label: 'Currency' },
    { key: 'recurring', label: 'Recurring' },
    { key: 'payment', label: 'Payment' },
    { key: 'matchingProgram', label: 'Matching Program' },
    { key: 'note', label: 'Note' },
    {
      key: 'billing',
      label: 'Billing',
      kind: 'object',
      fields: [
        { key: 'street', label: 'Street' },
        { key: 'zip', label: 'Zip' },
      ],
    },
  ],
};

const definition: BoxelRuntimeDefinition = {
  schema,
  guide: {
    target: 'DonationPledge',
    fieldGuides: [
      {
        fieldPath: '.amount',
        label: 'Donation Amount',
        required: true,
        constraints: [
          {
            expression: '"Donation Amount" > 0',
            message: 'Amount must be positive',
          },
        ],
      },
      {
        fieldPath: '.currency',
        label: 'Currency',
        suggestedValue: '"USD"',
        suggestedLabel: 'suggested',
      },
      {
        fieldPath: '.billing',
        label: 'Billing',
        visibleWhen: 'Payment = "Credit card"',
      },
      {
        fieldPath: '.note',
        label: 'Note',
        visibleWhen: '"Is Large Gift"',
        constraints: [
          {
            expression: 'NOT("Is Large Gift") OR (Note <> null AND Note <> "")',
            message: 'Note required for large gifts',
          },
        ],
      },
      {
        fieldPath: '.totalAnnual',
        label: 'Total Annual Gift',
        computedVia:
          'IF(Recurring, "Donation Amount" * 12, "Donation Amount")',
      },
    ],
    constraints: [
      {
        fieldPath: '.',
        expression:
          'Recurring = false OR (Payment <> null AND Payment <> "")',
        message: 'Recurring gifts require payment method',
      },
    ],
  },
  formulas: [
    {
      id: 'formula-is-large-gift',
      targetPath: '.isLargeGift',
      label: 'Is Large Gift',
      expression: '"Donation Amount" >= 1000',
    },
  ],
  annotations: [
    {
      id: 'suggest-match',
      kind: 'suggestion',
      targetPath: '.matchingProgram',
      targetCardType: 'DonationPledge',
      when:
        '"Donation Amount" >= 300 AND ("Matching Program" = null OR "Matching Program" = "")',
      summary: 'Ask about employer matching',
      details: 'Matching program is empty for a gift that qualifies.',
    },
  ],
};

const prepared = await prepareBoxelRuntimeAsync(definition, {
  cacheKey: 'boxel-runtime-async-smoke',
});
const preparedAgain = await prepareBoxelRuntimeAsync(structuredClone(definition), {
  cacheKey: 'boxel-runtime-async-smoke',
});

strictEqual(
  prepared,
  preparedAgain,
  'async prepare should reuse the same prepared runtime for a stable cache key',
);

ok(
  prepared.rules.some((rule) => rule.kind === 'formula' && rule.targetPath === '.isLargeGift'),
  'prepared runtime should expose explicit formula rules',
);
ok(
  prepared.rules.some((rule) => rule.kind === 'field-visible' && rule.fieldPath === '.note'),
  'prepared runtime should expose guide-driven visibility rules',
);

const initial = {
  amount: 500,
  currency: null,
  recurring: true,
  payment: null,
  matchingProgram: null,
  note: null,
  billing: {
    street: null,
    zip: null,
  },
};

const session = prepared.createSession(initial);
await session.ready;

const first = await session.evaluate();

strictEqual(
  getBoxelValue(first.state, '.totalAnnual'),
  6000,
  'guide-owned computed field should patch resolved state',
);
strictEqual(
  getBoxelValue(first.state, '.isLargeGift'),
  false,
  'explicit formula should augment schema and resolved state',
);
strictEqual(
  first.fieldState['.currency']?.suggested?.value,
  'USD',
  'suggested value should evaluate through the runtime',
);
strictEqual(
  first.fieldState['.billing']?.visible,
  false,
  'billing section should be hidden until payment method matches',
);
strictEqual(
  first.fieldState['.note']?.visible,
  false,
  'field visibility should be allowed to depend on computed formulas',
);
deepStrictEqual(
  first.violations.map((violation) => violation.message).sort(),
  ['Recurring gifts require payment method'],
  'root constraints should surface as violations',
);
strictEqual(
  first.annotationCards.length,
  1,
  'matching suggestion should emit an annotation draft',
);

const second = await session.applyPatch('.amount', 1200);
strictEqual(
  getBoxelValue(second.state, '.isLargeGift'),
  true,
  'incremental patching should recompute dependent formulas',
);
strictEqual(
  second.fieldState['.note']?.visible,
  true,
  'guide visibility should react to formula recomputation',
);
ok(
  second.violations.some((violation) => violation.message === 'Note required for large gifts'),
  'large gifts without a note should violate note guidance',
);
ok(
  second.delta.evaluatedRuleIds.length < prepared.rules.length,
  'incremental patching should evaluate only a subset of rules',
);

const third = await session.applyPatch('.payment', 'Credit card');
strictEqual(
  third.fieldState['.billing']?.visible,
  true,
  'payment change should reveal billing guide state',
);
ok(
  !third.violations.some((violation) => violation.message === 'Recurring gifts require payment method'),
  'root constraint should clear once payment is present',
);

const fourth = await session.applyPatch(
  '.note',
  'Discussed with donor services.',
);
ok(
  !fourth.violations.some((violation) => violation.message === 'Note required for large gifts'),
  'note constraint should clear once note content is present',
);

const fifth = await session.applyPatch('.amount', 100);
strictEqual(
  fifth.fieldState['.note']?.visible,
  false,
  'lower amount should collapse large-gift-only note guidance',
);
strictEqual(
  getBoxelValue(fifth.state, '.totalAnnual'),
  1200,
  'computed totals should continue to update after incremental patches',
);
strictEqual(
  fifth.annotationCards.length,
  0,
  'suggestion annotations should disappear when the qualifying condition no longer holds',
);

await session.dispose();

console.log('Boxel runtime async smoke passed');
