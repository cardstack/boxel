import { module, test } from 'qunit';

import { createBoxelFieldPortal } from '@cardstack/host/components/boxel-field-portal';

const pluralMeta = {
  fieldType: 'containsMany' as const,
  fieldName: 'entries',
};

// RP-3.4: "Plural fields: `@fields` of a plural field is array-like
// (iterable, length, index)." Main's `linksToMany`/`containsMany` field
// component (`getLinksToManyComponent`/`getContainsManyComponent` in
// `@cardstack/base`) is a Proxy over the plural component supporting exactly
// this contract, so an authored card can write either
// `{{#each @fields.reviewers as |Item|}}` or
// `(get @fields.reviewers index)` and get the per-item component either way.
// `createBoxelFieldPortal` is the Host-owned equivalent placed in `@fields`
// for a field whose value never enters a Capsule or Sandbox — these tests
// verify it reproduces the same array-like contract over a LIVE read (a
// thunk, main's Box path — RP-20.2), never a value captured at creation.
module('Unit | components/boxel-field-portal', function () {
  test('a scalar field returns a plain portal with no array-like surface', function (assert) {
    let portal = createBoxelFieldPortal(
      () => 'a plain string value',
      undefined,
      {
        fieldType: 'contains',
        fieldName: 'title',
      },
    );
    assert.strictEqual(
      (portal as unknown as Record<PropertyKey, unknown>)[Symbol.iterator],
      undefined,
      'a non-plural portal is not iterable',
    );
    assert.strictEqual(
      (portal as unknown as Record<string, unknown>)['0'],
      undefined,
      'a non-plural portal does not answer numeric-index access',
    );
  });

  test('plurality follows the declared field kind, not the momentary value shape', function (assert) {
    let portal = createBoxelFieldPortal(() => [], undefined, pluralMeta);
    assert.strictEqual(
      typeof (portal as unknown as Record<PropertyKey, unknown>)[
        Symbol.iterator
      ],
      'function',
      'an empty containsMany is still plural — a momentarily empty array must not demote the portal to scalar',
    );
  });

  test('a plural field exposes length, in matching document order', function (assert) {
    let portal = createBoxelFieldPortal(
      () => ['first', 'second', 'third'],
      undefined,
      pluralMeta,
    );
    assert.strictEqual(
      (portal as unknown as { length: number }).length,
      3,
      'length matches the underlying array',
    );
  });

  test('length and bounds are LIVE reads — a mutation after creation is visible (RP-20.2)', function (assert) {
    let value = ['first', 'second'];
    let portal = createBoxelFieldPortal(() => value, undefined, pluralMeta);
    let indexed = portal as unknown as Record<string, unknown> & {
      length: number;
    };
    assert.strictEqual(indexed.length, 2);
    value.push('third');
    assert.strictEqual(
      indexed.length,
      3,
      'a push after portal creation is visible on the next length read — the portal holds a path, never a captured value',
    );
    assert.strictEqual(
      typeof indexed['2'],
      'function',
      'the new index answers with a per-item component',
    );
    value.length = 1;
    assert.strictEqual(
      indexed.length,
      1,
      'a splice-down is visible immediately',
    );
    assert.strictEqual(
      indexed['1'],
      undefined,
      'a now-out-of-bounds index answers undefined, not a stale component',
    );
  });

  test('a plural field supports numeric-index access, matching (get @fields.x index)', function (assert) {
    let portal = createBoxelFieldPortal(
      () => ['first', 'second', 'third'],
      undefined,
      pluralMeta,
    );
    let indexed = portal as unknown as Record<string, unknown>;
    assert.strictEqual(
      typeof indexed['0'],
      'function',
      'index 0 yields a per-item component',
    );
    assert.strictEqual(
      typeof indexed['1'],
      'function',
      'index 1 yields a per-item component',
    );
    assert.strictEqual(
      typeof indexed['2'],
      'function',
      'index 2 yields a per-item component',
    );
    assert.strictEqual(
      indexed['3'],
      undefined,
      'an out-of-bounds index yields undefined, not an error',
    );
    assert.notStrictEqual(
      indexed['0'],
      indexed['1'],
      'distinct indices yield distinct per-item components',
    );
  });

  test('the same index yields the identical per-item component across repeated access', function (assert) {
    let portal = createBoxelFieldPortal(
      () => ['first', 'second'],
      undefined,
      pluralMeta,
    );
    let indexed = portal as unknown as Record<string, unknown>;
    assert.strictEqual(
      indexed['0'],
      indexed['0'],
      'repeated access to the same index is stable, so {{#each}} keying and component identity do not thrash',
    );
  });

  test('a plural field is directly iterable, matching {{#each @fields.x as |Item|}}', function (assert) {
    let portal = createBoxelFieldPortal(
      () => ['first', 'second', 'third'],
      undefined,
      pluralMeta,
    );
    let items = [...(portal as unknown as Iterable<unknown>)];
    assert.strictEqual(
      items.length,
      3,
      'spreading (what {{#each}} does under the hood) yields one item per array entry',
    );
    assert.true(
      items.every((item) => typeof item === 'function'),
      'each iterated item is itself a component',
    );

    let indexed = portal as unknown as Record<string, unknown>;
    assert.strictEqual(
      items[0],
      indexed['0'],
      'iteration order matches index access — the same per-item component either way',
    );
    assert.strictEqual(items[1], indexed['1']);
    assert.strictEqual(items[2], indexed['2']);
  });

  test('a plural field is still directly renderable, unindexed, as a single component', function (assert) {
    let portal = createBoxelFieldPortal(
      () => ['first', 'second'],
      undefined,
      pluralMeta,
    );
    // Ember's component manager resolves a proxied component's template via
    // its prototype chain (the same reason
    // `getLinksToManyComponent`/`getContainsManyComponent` implement
    // `getPrototypeOf` on their own proxy) — confirm the trap is wired up
    // rather than falling through to the default (which would make
    // `<@fields.reviewers />`, unindexed, unrenderable).
    assert.strictEqual(
      typeof Object.getPrototypeOf(portal),
      'function',
      'the proxy still resolves to a renderable component class via its prototype',
    );
  });

  test('an empty plural field has zero length and no iterated items', function (assert) {
    let portal = createBoxelFieldPortal(() => [], undefined, pluralMeta);
    assert.strictEqual((portal as unknown as { length: number }).length, 0);
    assert.deepEqual([...(portal as unknown as Iterable<unknown>)], []);
  });

  test('a granted write on a plural item mutates the watched array in place (RP-9.3)', function (assert) {
    let value: unknown[] = ['first', 'second'];
    // The per-item write path is exercised through the portal class's static
    // `write` — reach it the way the component instance does.
    let portal = createBoxelFieldPortal(
      () => value,
      undefined,
      pluralMeta,
      () => {
        throw new Error(
          'the whole-field write must not be invoked for an item write',
        );
      },
    ) as unknown as Record<string, { write?: (v: unknown) => void }>;
    portal['1']?.write?.('replaced');
    assert.deepEqual(
      value,
      ['first', 'replaced'],
      'an item write lands at its index on the live array — the same in-place mutation main’s per-index Box.set performs',
    );
  });
});
