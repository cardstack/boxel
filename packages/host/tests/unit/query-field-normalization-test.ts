import { module, test } from 'qunit';

import type { LooseCardResource } from '@cardstack/runtime-common';
import { codeRefWithAbsoluteURL } from '@cardstack/runtime-common';
import {
  getValueForResourcePath,
  normalizeQueryDefinition,
} from '@cardstack/runtime-common/query-field-utils';

module('normalizeQueryDefinition', function () {
  let fieldDefinition = {
    type: 'containsMany',
    isPrimitive: false,
    isComputed: false,
    fieldOrCard: { module: 'https://example.com/test', name: 'Test' },
  } as const;

  test('resolves serialized resources with base paths and dot paths', function (assert) {
    let realmURL = new URL('https://realm.example/');
    let resource: LooseCardResource = {
      id: 'https://realm.example/cards/1',
      meta: {
        adoptsFrom: { module: 'https://example.com/base', name: 'BaseCard' },
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
    let targetRef = codeRefWithAbsoluteURL(
      fieldDefinition.fieldOrCard,
      new URL(resource.id!),
    );
    assert.deepEqual(normalized?.query.filter, {
      eq: { city: 'NYC' },
      on: targetRef,
    });
    assert.strictEqual(normalized?.realm, 'https://other.realm/');
  });

  test('injects on into leaf filter inside not', function (assert) {
    let realmURL = new URL('https://realm.example/');
    let relativeTo = new URL('https://realm.example/cards/1');
    let targetRef = codeRefWithAbsoluteURL(
      fieldDefinition.fieldOrCard,
      relativeTo,
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
    let targetRef = codeRefWithAbsoluteURL(
      fieldDefinition.fieldOrCard,
      relativeTo,
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
    let targetRef = codeRefWithAbsoluteURL(
      fieldDefinition.fieldOrCard,
      relativeTo,
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
    let targetRef = codeRefWithAbsoluteURL(
      fieldDefinition.fieldOrCard,
      relativeTo,
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
    let targetRef = codeRefWithAbsoluteURL(
      fieldDefinition.fieldOrCard,
      relativeTo,
    );
    let typeRef = { module: 'https://example.com/other', name: 'Other' };

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
    let existingOn = { module: 'https://example.com/custom', name: 'Custom' };

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
    let targetRef = codeRefWithAbsoluteURL(
      fieldDefinition.fieldOrCard,
      relativeTo,
    );
    assert.deepEqual(normalized?.query.filter, {
      any: [
        { eq: { name: 'foo' }, on: existingOn },
        { eq: { name: 'bar' }, on: targetRef },
      ],
    });
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

    let targetRef = codeRefWithAbsoluteURL(
      fieldDefinition.fieldOrCard,
      relativeTo,
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
