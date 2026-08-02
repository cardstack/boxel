import assert from 'node:assert/strict';
import test from 'node:test';

import { BxlAdapter } from '../src/bxl-adapter.js';

test('loads the shipped BXL runtime and evaluates jq syntax', async () => {
  let bxl = await BxlAdapter.create();
  let result = await bxl.evaluate(
    '.items | length',
    { items: [1, 2, 3, 4, 5] },
    { syntax: 'jq' },
  );

  assert.equal(result, 5);
});
