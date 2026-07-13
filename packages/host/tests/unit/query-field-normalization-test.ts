import { module, test } from 'qunit';

import type { LooseCardResource } from '@cardstack/runtime-common';
import { codeRefWithAbsoluteIdentifier, rri } from '@cardstack/runtime-common';
import {
  getValueForResourcePath,
  normalizeQueryDefinition,
} from '@cardstack/runtime-common/query-field-utils';

module('normalizeQueryDefinition', function () {
  let fieldDefinition = {
    type: 'containsMany',
    isPrimitive: false,
    isComputed: false,
    fieldOrCard: {
      module: rri('https://example.com/test'),
      name: 'Test',
    },
  } as const;

  test('resolves serialized resources with base paths and dot paths', function (assert) {
    let realmURL = new URL('https://realm.example/');
    let resource: LooseCardResource = {
      id: 'https://realm.example/cards/1',
      meta: {
        adoptsFrom: {
          module: rri('https://example.com/base'),
          name: 'BaseCard',
        },
      },
      attributes: {
        profile: { city: 'NYC', realmVal: 'https://other.realm/' },
      },
    };

    let normalized = normalizeQueryDefinition({
      fieldDefinition,
      queryDefinition: {
        filter: { eq: { city: '$this.city' } },
        realm: '$this.realmVal',
      },
      realmURL,
      fieldName: 'profile.queryField',
      fieldPath: 'profile',
      resource,
      resolvePathValue: (path) => getValueForResourcePath(resource, path),
    });

    assert.ok(normalized, 'normalization succeeded');
    let targetRef = codeRefWithAbsoluteIdentifier(
      fieldDefinition.fieldOrCard,
      new URL(resource.id!),
      undefined,
    );
    assert.deepEqual(normalized?.query.filter, {
      eq: { city: 'NYC' },
      on: targetRef,
    });
    assert.strictEqual(normalized?.realm, 'https://other.realm/');
  });

  test('resolves relative code refs in RRI space', function (assert) {
    let realmURL = new URL('https://realm.example/');
    let resource: LooseCardResource = {
      // A prefix-mapped realm's canonical instance id.
      id: '@scope/realm/cards/1',
      meta: {
        adoptsFrom: {
          module: rri('@scope/realm/base'),
          name: 'BaseCard',
        },
      },
      attributes: {},
    };

    let normalized = normalizeQueryDefinition({
      fieldDefinition: {
        ...fieldDefinition,
        fieldOrCard: {
          // Relative module: must resolve against the prefix-form id.
          module: rri('../test-defs'),
          name: 'Test',
        },
      },
      queryDefinition: {},
      realmURL,
      fieldName: 'queryField',
      resource,
      resolvePathValue: () => undefined,
    });

    assert.ok(normalized, 'normalization succeeded');
    assert.deepEqual(
      normalized?.query.filter,
      {
        type: { module: rri('@scope/realm/test-defs'), name: 'Test' },
      },
      'relative module resolved against the prefix-form id, staying in RRI space',
    );

    // An already-absolute prefix module passes through unchanged.
    let absolute = normalizeQueryDefinition({
      fieldDefinition: {
        ...fieldDefinition,
        fieldOrCard: {
          module: rri('@other/realm/defs'),
          name: 'Test',
        },
      },
      queryDefinition: {},
      realmURL,
      fieldName: 'queryField',
      resource,
      resolvePathValue: () => undefined,
    });
    assert.deepEqual(absolute?.query.filter, {
      type: { module: rri('@other/realm/defs'), name: 'Test' },
    });
  });

  test('injects on into leaf filter inside not', function (assert) {
    let realmURL = new URL('https://realm.example/');
    let relativeTo = new URL('https://realm.example/cards/1');
    let targetRef = codeRefWithAbsoluteIdentifier(
      fieldDefinition.fieldOrCard,
      relativeTo,
      undefined,
    );

    let normalized = normalizeQueryDefinition({
      fieldDefinition,
      queryDefinition: {
        filter: { not: { eq: { name: 'foo' } } },
      },
      realmURL,
      fieldName: 'testField',
      resolvePathValue: () => undefined,
      relativeTo,
    });

    assert.ok(normalized, 'normalization succeeded');
    assert.deepEqual(normalized?.query.filter, {
      not: { eq: { name: 'foo' }, on: targetRef },
    });
  });

  test('injects on into each leaf filter inside any', function (assert) {
    let realmURL = new URL('https://realm.example/');
    let relativeTo = new URL('https://realm.example/cards/1');
    let targetRef = codeRefWithAbsoluteIdentifier(
      fieldDefinition.fieldOrCard,
      relativeTo,
      undefined,
    );

    let normalized = normalizeQueryDefinition({
      fieldDefinition,
      queryDefinition: {
        filter: {
          any: [{ eq: { name: 'foo' } }, { contains: { title: 'bar' } }],
        },
      },
      realmURL,
      fieldName: 'testField',
      resolvePathValue: () => undefined,
      relativeTo,
    });

    assert.ok(normalized, 'normalization succeeded');
    assert.deepEqual(normalized?.query.filter, {
      any: [
        { eq: { name: 'foo' }, on: targetRef },
        { contains: { title: 'bar' }, on: targetRef },
      ],
    });
  });

  test('injects on into each leaf filter inside every', function (assert) {
    let realmURL = new URL('https://realm.example/');
    let relativeTo = new URL('https://realm.example/cards/1');
    let targetRef = codeRefWithAbsoluteIdentifier(
      fieldDefinition.fieldOrCard,
      relativeTo,
      undefined,
    );

    let normalized = normalizeQueryDefinition({
      fieldDefinition,
      queryDefinition: {
        filter: {
          every: [{ eq: { name: 'foo' } }, { range: { age: { gte: 18 } } }],
        },
      },
      realmURL,
      fieldName: 'testField',
      resolvePathValue: () => undefined,
      relativeTo,
    });

    assert.ok(normalized, 'normalization succeeded');
    assert.deepEqual(normalized?.query.filter, {
      every: [
        { eq: { name: 'foo' }, on: targetRef },
        { range: { age: { gte: 18 } }, on: targetRef },
      ],
    });
  });

  test('injects on into deeply nested combinator filters', function (assert) {
    let realmURL = new URL('https://realm.example/');
    let relativeTo = new URL('https://realm.example/cards/1');
    let targetRef = codeRefWithAbsoluteIdentifier(
      fieldDefinition.fieldOrCard,
      relativeTo,
      undefined,
    );

    let normalized = normalizeQueryDefinition({
      fieldDefinition,
      queryDefinition: {
        filter: {
          every: [
            {
              any: [{ eq: { name: 'foo' } }, { eq: { name: 'bar' } }],
            },
            { not: { contains: { title: 'baz' } } },
          ],
        },
      },
      realmURL,
      fieldName: 'testField',
      resolvePathValue: () => undefined,
      relativeTo,
    });

    assert.ok(normalized, 'normalization succeeded');
    assert.deepEqual(normalized?.query.filter, {
      every: [
        {
          any: [
            { eq: { name: 'foo' }, on: targetRef },
            { eq: { name: 'bar' }, on: targetRef },
          ],
        },
        { not: { contains: { title: 'baz' }, on: targetRef } },
      ],
    });
  });

  test('skips type filters inside combinators', function (assert) {
    let realmURL = new URL('https://realm.example/');
    let relativeTo = new URL('https://realm.example/cards/1');
    let targetRef = codeRefWithAbsoluteIdentifier(
      fieldDefinition.fieldOrCard,
      relativeTo,
      undefined,
    );
    let typeRef = {
      module: rri('https://example.com/other'),
      name: 'Other',
    };

    let normalized = normalizeQueryDefinition({
      fieldDefinition,
      queryDefinition: {
        filter: {
          any: [{ eq: { name: 'foo' } }, { type: typeRef }],
        },
      },
      realmURL,
      fieldName: 'testField',
      resolvePathValue: () => undefined,
      relativeTo,
    });

    assert.ok(normalized, 'normalization succeeded');
    assert.deepEqual(normalized?.query.filter, {
      any: [{ eq: { name: 'foo' }, on: targetRef }, { type: typeRef }],
    });
  });

  test('does not overwrite existing on in leaf filters', function (assert) {
    let realmURL = new URL('https://realm.example/');
    let relativeTo = new URL('https://realm.example/cards/1');
    let existingOn = {
      module: rri('https://example.com/custom'),
      name: 'Custom',
    };

    let normalized = normalizeQueryDefinition({
      fieldDefinition,
      queryDefinition: {
        filter: {
          any: [
            { eq: { name: 'foo' }, on: existingOn },
            { eq: { name: 'bar' } },
          ],
        },
      },
      realmURL,
      fieldName: 'testField',
      resolvePathValue: () => undefined,
      relativeTo,
    });

    assert.ok(normalized, 'normalization succeeded');
    let targetRef = codeRefWithAbsoluteIdentifier(
      fieldDefinition.fieldOrCard,
      relativeTo,
      undefined,
    );
    assert.deepEqual(normalized?.query.filter, {
      any: [
        { eq: { name: 'foo' }, on: existingOn },
        { eq: { name: 'bar' }, on: targetRef },
      ],
    });
  });

  test('resolves in filter with array interpolation from containsMany field', function (assert) {
    let realmURL = new URL('https://realm.example/');
    let instance = { tags: ['red', 'blue', 'green'] };
    let relativeTo = new URL('https://realm.example/cards/instance');

    let normalized = normalizeQueryDefinition({
      fieldDefinition,
      queryDefinition: {
        filter: { in: { color: '$this.tags' } },
      },
      realmURL,
      fieldName: 'matchingItems',
      resolvePathValue: (path) => resolvePath(instance, path),
      relativeTo,
    });

    let targetRef = codeRefWithAbsoluteIdentifier(
      fieldDefinition.fieldOrCard,
      relativeTo,
      undefined,
    );
    assert.deepEqual(normalized?.query.filter, {
      in: { color: ['red', 'blue', 'green'] },
      on: targetRef,
    });
  });

  test('aborts in filter when interpolated array is undefined', function (assert) {
    let realmURL = new URL('https://realm.example/');
    let instance = {};
    let relativeTo = new URL('https://realm.example/cards/instance');

    let normalized = normalizeQueryDefinition({
      fieldDefinition,
      queryDefinition: {
        filter: { in: { color: '$this.tags' } },
      },
      realmURL,
      fieldName: 'matchingItems',
      resolvePathValue: (path) => resolvePath(instance, path),
      relativeTo,
    });

    assert.strictEqual(
      normalized,
      null,
      'query is aborted when in value is undefined',
    );
  });

  test('resolves live instances via custom path resolver', function (assert) {
    let realmURL = new URL('https://realm.example/');
    let instance = { address: { city: 'Paris' } };
    let relativeTo = new URL('https://realm.example/cards/instance');

    let normalized = normalizeQueryDefinition({
      fieldDefinition,
      queryDefinition: {
        filter: { eq: { city: '$this.address.city' } },
      },
      realmURL,
      fieldName: 'favoriteCity',
      resolvePathValue: (path) => resolvePath(instance, path),
      relativeTo,
    });

    let targetRef = codeRefWithAbsoluteIdentifier(
      fieldDefinition.fieldOrCard,
      relativeTo,
      undefined,
    );
    assert.deepEqual(normalized?.query.filter, {
      eq: { city: 'Paris' },
      on: targetRef,
    });
    assert.strictEqual(normalized?.realm, realmURL.href);
  });
});

function resolvePath(root: any, path: string): any {
  let current: any = root;
  for (let segment of path.split('.')) {
    if (current == null) {
      return undefined;
    }
    if (Array.isArray(current)) {
      let index = Number(segment);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (typeof current === 'object' && segment in current) {
      current = (current as any)[segment];
      continue;
    }
    return undefined;
  }
  return current;
}
