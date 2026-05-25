import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import type { BaseDef } from 'https://cardstack.com/base/card-api';
import type * as FieldSupportModule from 'https://cardstack.com/base/field-support';
import type {
  LinkErrorValue,
  LinkNotFoundValue,
  NotLoadedValue,
} from 'https://cardstack.com/base/field-support';

import { setupCardLogs, setupLocalIndexing } from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

let loader: Loader;
let getPhantom: (typeof FieldSupportModule)['getPhantom'];
let isPhantom: (typeof FieldSupportModule)['isPhantom'];
let readPhantomState: (typeof FieldSupportModule)['readPhantomState'];

const ref = 'https://example.test/cards/pet-1';

function stubInstance(): BaseDef {
  return {} as unknown as BaseDef;
}

function makeNotLoaded(reference = ref): NotLoadedValue {
  return { type: 'not-loaded', reference };
}

function makeLinkError(reference = ref): LinkErrorValue {
  return {
    type: 'link-error',
    reference,
    errorDoc: { status: 500, message: 'boom', additionalErrors: null },
  };
}

function makeLinkNotFound(reference = ref): LinkNotFoundValue {
  return {
    type: 'link-not-found',
    reference,
    errorDoc: { status: 404, message: 'missing', additionalErrors: null },
  };
}

module('Integration | field-support | phantom value', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );
  setupLocalIndexing(hooks);
  setupMockMatrix(hooks);

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    let fieldSupport = await loader.import<typeof FieldSupportModule>(
      `${baseRealm.url}field-support`,
    );
    getPhantom = fieldSupport.getPhantom;
    isPhantom = fieldSupport.isPhantom;
    readPhantomState = fieldSupport.readPhantomState;
  });

  test('every property access on the phantom resolves to undefined', function (assert) {
    let phantom = getPhantom(stubInstance(), 'pet', makeNotLoaded());
    assert.strictEqual((phantom as any).anyField, undefined);
    assert.strictEqual((phantom as any).deeply, undefined);
    assert.strictEqual((phantom as any)['kebab-prop'], undefined);
    assert.strictEqual((phantom as any)[Symbol.iterator], undefined);
    assert.strictEqual((phantom as any)[Symbol.asyncIterator], undefined);
  });

  test('invoking the phantom as a function returns undefined', function (assert) {
    let phantom = getPhantom(stubInstance(), 'pet', makeNotLoaded());
    let callable = phantom as unknown as (...args: unknown[]) => unknown;
    assert.strictEqual(callable(), undefined);
    assert.strictEqual(callable('a', 'b', 'c'), undefined);
  });

  test('getPrototypeOf returns null', function (assert) {
    let phantom = getPhantom(stubInstance(), 'pet', makeNotLoaded());
    assert.strictEqual(Object.getPrototypeOf(phantom), null);
  });

  test('Symbol.toPrimitive returns null', function (assert) {
    let phantom = getPhantom(stubInstance(), 'pet', makeNotLoaded()) as any;
    let toPrim = phantom[Symbol.toPrimitive];
    assert.strictEqual(typeof toPrim, 'function');
    assert.strictEqual(toPrim('default'), null);
    assert.strictEqual(toPrim('number'), null);
    assert.strictEqual(toPrim('string'), null);
    // Coercions that flow through Symbol.toPrimitive collapse to null/zero.
    assert.strictEqual(
      +phantom,
      0,
      'numeric coercion yields ToNumber(null) = 0',
    );
    assert.strictEqual(
      `${phantom}`,
      'null',
      'string coercion yields ToString(null)',
    );
  });

  test('the phantom is identity-stable per (instance, fieldName, sentinel)', function (assert) {
    let instance = stubInstance();
    let sentinel = makeNotLoaded();
    let a = getPhantom(instance, 'pet', sentinel);
    let b = getPhantom(instance, 'pet', sentinel);
    assert.strictEqual(a, b, 'same triple returns the same Proxy');
  });

  test('a different sentinel object yields a different phantom', function (assert) {
    let instance = stubInstance();
    let a = getPhantom(instance, 'pet', makeNotLoaded());
    let b = getPhantom(instance, 'pet', makeNotLoaded());
    assert.notStrictEqual(
      a,
      b,
      'two distinct sentinel objects mint two distinct phantoms even if their type matches',
    );
  });

  test('a different field name yields a different phantom', function (assert) {
    let instance = stubInstance();
    let sentinel = makeNotLoaded();
    let petPhantom = getPhantom(instance, 'pet', sentinel);
    let ownerPhantom = getPhantom(instance, 'owner', sentinel);
    assert.notStrictEqual(petPhantom, ownerPhantom);
  });

  test('a different instance yields a different phantom', function (assert) {
    let sentinel = makeNotLoaded();
    let a = getPhantom(stubInstance(), 'pet', sentinel);
    let b = getPhantom(stubInstance(), 'pet', sentinel);
    assert.notStrictEqual(a, b);
  });

  test('null sentinel (not-set state) is supported and identity-stable', function (assert) {
    let instance = stubInstance();
    let a = getPhantom(instance, 'pet', null);
    let b = getPhantom(instance, 'pet', null);
    assert.strictEqual(
      a,
      b,
      'the not-set phantom is cached per (instance, field)',
    );
    assert.true(isPhantom(a));
  });

  test('Error and NotFound sentinels each mint their own phantom', function (assert) {
    let instance = stubInstance();
    let err = makeLinkError();
    let notFound = makeLinkNotFound();
    let errPhantom = getPhantom(instance, 'pet', err);
    let notFoundPhantom = getPhantom(instance, 'pet', notFound);
    assert.notStrictEqual(errPhantom, notFoundPhantom);
    assert.true(isPhantom(errPhantom));
    assert.true(isPhantom(notFoundPhantom));
  });

  test('isPhantom narrows phantoms and rejects everything else', function (assert) {
    let phantom = getPhantom(stubInstance(), 'pet', makeNotLoaded());
    assert.true(isPhantom(phantom), 'phantom is recognized');

    assert.false(isPhantom(null), 'null is not a phantom');
    assert.false(isPhantom(undefined), 'undefined is not a phantom');
    assert.false(isPhantom(0), 'numbers are not phantoms');
    assert.false(isPhantom(''), 'strings are not phantoms');
    assert.false(isPhantom(false), 'booleans are not phantoms');
    assert.false(isPhantom({}), 'plain objects are not phantoms');
    assert.false(isPhantom([]), 'arrays are not phantoms');
    assert.false(
      isPhantom(() => {}),
      'arbitrary functions are not phantoms',
    );
    assert.false(
      isPhantom(new Proxy({}, {})),
      'unbranded proxies are not phantoms',
    );
    assert.false(
      isPhantom({ type: 'link-error', reference: ref }),
      'sentinel-shaped objects are not phantoms',
    );

    let v: unknown = phantom;
    if (isPhantom(v)) {
      // type narrowing exercise — `v` is `PhantomValue`, an opaque branded type
      assert.ok(v, 'narrowed value remains an object');
    } else {
      assert.ok(false, 'isPhantom did not narrow');
    }
  });

  test('readPhantomState exposes the (instance, fieldName, sentinel) triple', function (assert) {
    let instance = stubInstance();
    let sentinel = makeLinkError();
    let phantom = getPhantom(instance, 'pet', sentinel);
    let state = readPhantomState(phantom);
    assert.ok(state, 'state is exposed for phantoms');
    assert.strictEqual(state!.instance, instance);
    assert.strictEqual(state!.fieldName, 'pet');
    assert.strictEqual(state!.sentinel, sentinel);
  });

  test('readPhantomState returns undefined for non-phantoms', function (assert) {
    assert.strictEqual(readPhantomState(null as any), undefined);
    assert.strictEqual(readPhantomState({} as any), undefined);
    assert.strictEqual(readPhantomState(makeNotLoaded() as any), undefined);
  });

  test('the hidden state symbol is not enumerable on the phantom surface', function (assert) {
    let phantom = getPhantom(stubInstance(), 'pet', makeNotLoaded());
    assert.deepEqual(
      Object.keys(phantom as object),
      [],
      'Object.keys returns no own keys',
    );
    assert.deepEqual(
      Object.getOwnPropertySymbols(phantom as object),
      [],
      'Object.getOwnPropertySymbols returns no own symbols',
    );
    let in_ = (key: PropertyKey) => key in (phantom as object);
    assert.false(in_('anyField'), '"anyField" in phantom is false');
    assert.false(in_(Symbol.iterator), 'Symbol.iterator in phantom is false');
  });

  test('writes and deletes against the phantom are silently absorbed', function (assert) {
    let phantom = getPhantom(stubInstance(), 'pet', makeNotLoaded()) as any;
    phantom.foo = 'bar';
    assert.strictEqual(phantom.foo, undefined, 'a write does not change reads');
    delete phantom.foo;
    assert.strictEqual(phantom.foo, undefined, 'a delete is a no-op');
  });

  // Object.freeze / Object.seal / Object.preventExtensions on the proxy would
  // make the function target non-extensible and (for freeze) lock its `length`
  // and `name` properties to non-configurable. After that, the `has` trap
  // returning false for those keys violates proxy invariants, turning the
  // next property access into a TypeError. Refusing the hardening operation
  // raises a TypeError at the freeze/seal call instead, and the phantom stays
  // valid for subsequent reads.
  test('freezing the phantom is refused and leaves it intact', function (assert) {
    let phantom = getPhantom(stubInstance(), 'pet', makeNotLoaded());
    assert.throws(
      () => Object.preventExtensions(phantom as object),
      TypeError,
      'Object.preventExtensions throws TypeError',
    );
    assert.throws(
      () => Object.freeze(phantom as object),
      TypeError,
      'Object.freeze throws TypeError',
    );
    assert.throws(
      () => Object.seal(phantom as object),
      TypeError,
      'Object.seal throws TypeError',
    );
    assert.throws(
      () => Object.defineProperty(phantom as object, 'foo', { value: 'bar' }),
      TypeError,
      'Object.defineProperty throws TypeError',
    );
    assert.strictEqual(
      (phantom as any).anyField,
      undefined,
      'post-attempt property reads still resolve to undefined',
    );
    assert.true(
      isPhantom(phantom),
      'post-attempt the phantom still satisfies isPhantom',
    );
  });

  // Documenting JS-spec deviations from the ticket's stated mechanics:
  // ECMAScript Abstract Equality returns false for any (Object, Null) pair
  // without invoking Symbol.toPrimitive, and unary `!` on any object (outside
  // `document.all`'s [[IsHTMLDDA]] slot) is always false. Detect non-Present
  // via isPhantom or the Relationship API, not via `== null` or `!value`.
  test('phantom is not loosely equal to null and is truthy', function (assert) {
    let phantom = getPhantom(stubInstance(), 'pet', makeNotLoaded());
    let looseEqualsNull = (phantom as unknown) == null;
    assert.false(
      looseEqualsNull,
      '`phantom == null` is false: spec returns false for (Object, Null)',
    );
    let bangPhantom = !phantom;
    assert.false(bangPhantom, '`!phantom` is false: any object is truthy');
    assert.notStrictEqual(phantom as unknown, undefined);
    assert.notStrictEqual(phantom as unknown, null);
  });

  test('one-level safe traversal: author.publisher.name returns undefined', function (assert) {
    // Simulates the computed-traversal acceptance: a contained `author` field
    // with a broken `publisher` linksTo. The phantom is returned for
    // `author.publisher`, and `.name` on the phantom evaluates to undefined
    // without TypeError. The broken-link boundary is the only thing shielded
    // — deeper chains from undefined throw per ordinary JS semantics.
    let publisher = getPhantom(stubInstance(), 'publisher', makeLinkNotFound());
    let author = { publisher } as { publisher: unknown };
    let name = (author.publisher as any).name;
    assert.strictEqual(name, undefined);
  });
});
