import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import {
  getBoxelValue,
  invalidateBoxelRuntimeAsyncCache,
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

const updatedDefinition: BoxelRuntimeDefinition = structuredClone(definition);
updatedDefinition.guide!.fieldGuides = updatedDefinition.guide!.fieldGuides.map(
  (fieldGuide) =>
    fieldGuide.fieldPath === '.totalAnnual'
      ? {
          ...fieldGuide,
          computedVia: 'IF(Recurring, "Donation Amount" * 24, "Donation Amount")',
        }
      : fieldGuide,
);

const prepared = await prepareBoxelRuntimeAsync(definition, {
  cacheKey: 'boxel-runtime-async-smoke',
  worker: false,
});
const preparedAgain = await prepareBoxelRuntimeAsync(structuredClone(definition), {
  cacheKey: 'boxel-runtime-async-smoke',
  worker: false,
});

strictEqual(
  prepared,
  preparedAgain,
  'async prepare should reuse the same prepared runtime for a stable cache key',
);
strictEqual(
  prepared.cacheNamespace,
  'boxel-runtime-async-smoke',
  'manual cache keys should act as cache namespaces',
);
ok(
  prepared.cacheKey.includes(prepared.contentHash),
  'resolved cache key should include the content hash',
);

const preparedUpdated = await prepareBoxelRuntimeAsync(updatedDefinition, {
  cacheKey: 'boxel-runtime-async-smoke',
  worker: false,
});

ok(
  preparedUpdated !== prepared,
  'same cache namespace with changed content should compile a new prepared plan',
);
strictEqual(
  preparedUpdated.cacheNamespace,
  prepared.cacheNamespace,
  'content changes should preserve cache namespace',
);
ok(
  preparedUpdated.cacheKey !== prepared.cacheKey,
  'content changes should produce a different resolved cache key',
);
ok(
  preparedUpdated.contentHash !== prepared.contentHash,
  'content changes should produce a different content hash',
);

const updatedEval = await preparedUpdated.evaluate({
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
});
strictEqual(
  getBoxelValue(updatedEval.state, '.totalAnnual'),
  12000,
  'new prepared plans should reflect updated compiled expressions',
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

const swapSession = prepared.createSession(initial);
await swapSession.ready;

const swapped = await swapSession.swapPlan(preparedUpdated);
strictEqual(
  getBoxelValue(swapped.state, '.totalAnnual'),
  12000,
  'plan swaps should preserve the current source and recompute against the new prepared plan',
);

const swappedSecond = await swapSession.applyPatch('.amount', 1200);
strictEqual(
  getBoxelValue(swappedSecond.state, '.totalAnnual'),
  28800,
  'session patching should continue to use the swapped prepared plan',
);

await swapSession.dispose();

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

const invalidatedSingle = await invalidateBoxelRuntimeAsyncCache(
  preparedUpdated.cacheKey,
);
strictEqual(
  invalidatedSingle,
  1,
  'invalidating an exact resolved cache key should remove one prepared plan',
);

const preparedUpdatedAgain = await prepareBoxelRuntimeAsync(updatedDefinition, {
  cacheKey: 'boxel-runtime-async-smoke',
  worker: false,
});
ok(
  preparedUpdatedAgain !== preparedUpdated,
  'invalidating the exact plan should force a fresh async prepare',
);

const invalidatedNamespace = await invalidateBoxelRuntimeAsyncCache(
  'boxel-runtime-async-smoke',
);
strictEqual(
  invalidatedNamespace,
  2,
  'invalidating a cache namespace should remove every revision under that namespace',
);

const preparedAfterNamespaceDrop = await prepareBoxelRuntimeAsync(definition, {
  cacheKey: 'boxel-runtime-async-smoke',
  worker: false,
});
ok(
  preparedAfterNamespaceDrop !== prepared,
  'namespace invalidation should evict the original prepared plan',
);

await invalidateBoxelRuntimeAsyncCache();

console.log('Boxel runtime async smoke passed');
