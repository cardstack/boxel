import { module, test } from 'qunit';

import {
  canonicalizeFilterRefs,
  rri,
  type ResolvedCodeRef,
  type Filter,
} from '@cardstack/runtime-common';

const CANONICAL_FILE_DEF: ResolvedCodeRef = {
  module: rri('https://cardstack.com/base/card-api'),
  name: 'FileDef',
};
const REEXPORT_FILE_DEF: ResolvedCodeRef = {
  module: rri('https://cardstack.com/base/file-api'),
  name: 'FileDef',
};
const PERSON: ResolvedCodeRef = {
  module: rri('http://example.com/person'),
  name: 'Person',
};

// Resolves the file-api re-export spelling to the canonical card-api ref,
// echoes already-canonical refs, and fails everything else.
async function resolve(
  ref: ResolvedCodeRef,
): Promise<ResolvedCodeRef | undefined> {
  if (
    ref.module === REEXPORT_FILE_DEF.module &&
    ref.name === REEXPORT_FILE_DEF.name
  ) {
    return CANONICAL_FILE_DEF;
  }
  if (
    (ref.module === CANONICAL_FILE_DEF.module &&
      ref.name === CANONICAL_FILE_DEF.name) ||
    (ref.module === PERSON.module && ref.name === PERSON.name)
  ) {
    return ref;
  }
  return undefined;
}

module('Unit | query-canonicalization', function () {
  test('rewrites a top-level `type` ref to its canonical form', async function (assert) {
    let { filter, incomplete } = await canonicalizeFilterRefs(
      { type: REEXPORT_FILE_DEF },
      resolve,
    );
    assert.deepEqual(filter, { type: CANONICAL_FILE_DEF });
    assert.false(incomplete);
  });

  test('rewrites `on` refs nested through any/every/not', async function (assert) {
    let input: Filter = {
      any: [
        { on: PERSON, eq: { name: 'x' } },
        {
          every: [
            { not: { on: REEXPORT_FILE_DEF, eq: { name: 'y' } } },
            { type: REEXPORT_FILE_DEF },
          ],
        },
      ],
    };
    let { filter, incomplete } = await canonicalizeFilterRefs(input, resolve);
    assert.deepEqual(filter, {
      any: [
        { on: PERSON, eq: { name: 'x' } },
        {
          every: [
            { not: { on: CANONICAL_FILE_DEF, eq: { name: 'y' } } },
            { type: CANONICAL_FILE_DEF },
          ],
        },
      ],
    });
    assert.false(incomplete);
    // the input filter is not mutated
    assert.deepEqual(
      (input.any![1] as { every: Filter[] }).every[1],
      { type: REEXPORT_FILE_DEF },
      'input tree is left untouched',
    );
  });

  test('an unresolvable ref stays as-given and marks the result incomplete', async function (assert) {
    let bogus: ResolvedCodeRef = {
      module: rri('http://example.com/nope'),
      name: 'Nope',
    };
    let { filter, incomplete } = await canonicalizeFilterRefs(
      { every: [{ type: bogus }, { on: PERSON, eq: { name: 'x' } }] },
      resolve,
    );
    assert.deepEqual(filter, {
      every: [{ type: bogus }, { on: PERSON, eq: { name: 'x' } }],
    });
    assert.true(incomplete);
  });

  test('duplicate refs resolve once', async function (assert) {
    let calls = 0;
    await canonicalizeFilterRefs(
      {
        any: [{ type: REEXPORT_FILE_DEF }, { type: REEXPORT_FILE_DEF }],
      },
      async (ref) => {
        calls++;
        return resolve(ref);
      },
    );
    assert.strictEqual(calls, 1);
  });
});
