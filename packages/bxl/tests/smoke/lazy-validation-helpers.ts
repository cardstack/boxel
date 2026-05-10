import { ok, strictEqual } from 'node:assert';
import {
  evaluateBxl,
  getBoxelValue,
  prepareBoxelRuntimeAsync,
  runNativeJqAsync,
  type BoxelRuntimeDefinition,
} from '../../src/index.js';

let syncFailed = false;
try {
  evaluateBxl('isEmail("owner@example.test")', {});
} catch (error) {
  syncFailed = String((error as Error).message).includes('isEmail/1');
}
ok(syncFailed, 'sync evaluation should not load the validation extension');

const direct = await runNativeJqAsync('isEmail("owner@example.test")', {});
strictEqual(direct.outputs[0], true);
strictEqual(direct.compiledSource, 'isEmail("owner@example.test")');

const canonical = await runNativeJqAsync('ISEMAIL("owner@example.test")', {});
strictEqual(canonical.outputs[0], true);
strictEqual(
  canonical.compiledSource,
  'isEmail("owner@example.test")',
  'readable syntax should canonicalize to validator.js function casing',
);

const explicitLibrary = await runNativeJqAsync('1 + 1', {}, {
  libraries: ['core', 'validation'],
});
strictEqual(explicitLibrary.outputs[0], 2);

const definition: BoxelRuntimeDefinition = {
  guide: {
    fieldGuides: [
      {
        fieldPath: '.emailValid',
        computedVia: 'isEmail(.email)',
      },
      {
        fieldPath: '.siteValid',
        computedVia: 'isURL(.website, {require_protocol: true})',
      },
    ],
  },
};

const prepared = await prepareBoxelRuntimeAsync(definition, {
  cacheKey: 'lazy-validation-helpers-smoke',
  worker: false,
});
const result = await prepared.evaluate({
  email: 'owner@example.test',
  website: 'https://example.com',
});

strictEqual(getBoxelValue(result.state, '.emailValid'), true);
strictEqual(getBoxelValue(result.state, '.siteValid'), true);

console.log('BXL lazy validator.js functions: async extension loaded on demand');
