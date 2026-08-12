import { ok, strictEqual } from 'node:assert';
import {
  evaluateBxlSafe,
  prepareBxlSafe,
  prepareBoxelRuntimeAsyncSafe,
  prepareBoxelRuntimeSafe,
  type BoxelRuntimeDefinition,
  type ReadableSchema,
} from '../../src/index.js';

const schema: ReadableSchema = {
  fields: [{ key: 'recurring', label: 'Recurring' }],
};

const evalFailure = evaluateBxlSafe('MISSING(1)', {}, { schema });
strictEqual(evalFailure.ok, false, 'safe eval should return an error result');
if (!evalFailure.ok) {
  strictEqual(evalFailure.error.phase, 'evaluate');
  ok(
    evalFailure.error.message.includes('MISSING/1'),
    'safe eval should preserve the underlying message',
  );
}

const prepareFailure = prepareBxlSafe('when(Recurring, )', { schema });
strictEqual(
  prepareFailure.ok,
  false,
  'safe prepare should return an error result for invalid syntax',
);
if (!prepareFailure.ok) {
  ok(
    ['compile', 'parse', 'prepare'].includes(prepareFailure.error.phase),
    'safe prepare should classify prepare-time failures',
  );
}

const invalidDefinition: BoxelRuntimeDefinition = {
  schema,
  guide: {
    target: 'Gift',
    fieldGuides: [
      {
        fieldPath: '.recurring',
        visibleWhen: 'when(Recurring, )',
      },
    ],
  },
};

const runtimeFailure = prepareBoxelRuntimeSafe(invalidDefinition, { schema });
strictEqual(
  runtimeFailure.ok,
  false,
  'safe Boxel prepare should return an error result for invalid rules',
);
if (!runtimeFailure.ok) {
  ok(
    ['compile', 'parse', 'prepare'].includes(runtimeFailure.error.phase),
    'safe Boxel prepare should preserve a useful preparation-phase classification',
  );
}

const asyncRuntimeFailure = await prepareBoxelRuntimeAsyncSafe(invalidDefinition, {
  schema,
  cacheKey: 'error-handling-smoke',
  worker: false,
});
strictEqual(
  asyncRuntimeFailure.ok,
  false,
  'async safe Boxel prepare should return an error result for invalid rules',
);
if (!asyncRuntimeFailure.ok) {
  ok(
    ['compile', 'parse', 'prepare'].includes(asyncRuntimeFailure.error.phase),
    'async safe Boxel prepare should preserve a useful preparation-phase classification',
  );
}

console.log('BXL safe error handling smoke passed');
