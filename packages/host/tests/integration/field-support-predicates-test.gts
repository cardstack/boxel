import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import { setupCardLogs, setupLocalIndexing } from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

import type * as FieldSupportModule from '@cardstack/base/field-support';

let loader: Loader;
let isNotLoadedValue: (typeof FieldSupportModule)['isNotLoadedValue'];
let isLinkError: (typeof FieldSupportModule)['isLinkError'];
let isLinkNotFound: (typeof FieldSupportModule)['isLinkNotFound'];
let isNonPresentLink: (typeof FieldSupportModule)['isNonPresentLink'];

const ref = 'https://example.test/cards/pet-1';

function makeNotLoaded() {
  return { type: 'not-loaded' as const, reference: ref };
}

function makeLinkError() {
  return {
    type: 'link-error' as const,
    reference: ref,
    errorDoc: {
      status: 500,
      message: 'boom',
      additionalErrors: null,
    },
  };
}

function makeLinkNotFound() {
  return {
    type: 'link-not-found' as const,
    reference: ref,
    errorDoc: {
      status: 404,
      message: 'missing',
      additionalErrors: null,
    },
  };
}

module(
  'Integration | field-support | linksTo sentinel predicates',
  function (hooks) {
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
      isNotLoadedValue = fieldSupport.isNotLoadedValue;
      isLinkError = fieldSupport.isLinkError;
      isLinkNotFound = fieldSupport.isLinkNotFound;
      isNonPresentLink = fieldSupport.isNonPresentLink;
    });

    test('isNotLoadedValue only matches the not-loaded sentinel', function (assert) {
      assert.true(
        isNotLoadedValue(makeNotLoaded()),
        'matches not-loaded sentinel',
      );
      assert.false(
        isNotLoadedValue(makeLinkError()),
        'does not match link-error sentinel (narrow semantics preserved)',
      );
      assert.false(
        isNotLoadedValue(makeLinkNotFound()),
        'does not match link-not-found sentinel (narrow semantics preserved)',
      );
      assert.false(isNotLoadedValue(null), 'rejects null');
      assert.false(isNotLoadedValue(undefined), 'rejects undefined');
      assert.false(isNotLoadedValue('a string'), 'rejects strings');
      assert.false(isNotLoadedValue({}), 'rejects empty objects');
      assert.false(
        isNotLoadedValue({ type: 'not-loaded' }),
        'rejects sentinel missing reference',
      );
      assert.false(
        isNotLoadedValue({ reference: ref }),
        'rejects sentinel missing type',
      );
      assert.false(
        isNotLoadedValue({ type: 'not-loaded', reference: 123 }),
        'rejects non-string reference',
      );
    });

    test('isLinkError matches link-error sentinel with a well-formed errorDoc only', function (assert) {
      assert.true(isLinkError(makeLinkError()), 'matches link-error sentinel');
      assert.false(
        isLinkError(makeNotLoaded()),
        'does not match not-loaded sentinel',
      );
      assert.false(
        isLinkError(makeLinkNotFound()),
        'does not match link-not-found sentinel',
      );
      assert.false(
        isLinkError({ type: 'link-error', reference: ref }),
        'rejects link-error sentinel without errorDoc',
      );
      assert.false(
        isLinkError({ type: 'link-error', reference: ref, errorDoc: 'oops' }),
        'rejects non-object errorDoc',
      );
      assert.false(
        isLinkError({
          type: 'link-error',
          reference: ref,
          errorDoc: { status: 500 },
        }),
        'rejects errorDoc missing message',
      );
      assert.false(
        isLinkError({
          type: 'link-error',
          reference: ref,
          errorDoc: { message: 'boom', status: '500', additionalErrors: null },
        }),
        'rejects errorDoc with non-number status',
      );
      assert.false(
        isLinkError({
          type: 'link-error',
          reference: ref,
          errorDoc: { message: 'boom', status: 500, additionalErrors: 'no' },
        }),
        'rejects errorDoc with non-array additionalErrors',
      );
      assert.false(isLinkError(null), 'rejects null');
      assert.false(isLinkError(undefined), 'rejects undefined');
      assert.false(isLinkError({}), 'rejects empty objects');
    });

    test('isLinkNotFound matches link-not-found sentinel with a well-formed errorDoc only', function (assert) {
      assert.true(
        isLinkNotFound(makeLinkNotFound()),
        'matches link-not-found sentinel',
      );
      assert.false(
        isLinkNotFound(makeNotLoaded()),
        'does not match not-loaded sentinel',
      );
      assert.false(
        isLinkNotFound(makeLinkError()),
        'does not match link-error sentinel',
      );
      assert.false(
        isLinkNotFound({ type: 'link-not-found', reference: ref }),
        'rejects link-not-found sentinel without errorDoc',
      );
      assert.false(
        isLinkNotFound({
          type: 'link-not-found',
          reference: ref,
          errorDoc: 'oops',
        }),
        'rejects non-object errorDoc',
      );
      assert.false(
        isLinkNotFound({
          type: 'link-not-found',
          reference: ref,
          errorDoc: { status: 404, additionalErrors: null },
        }),
        'rejects errorDoc missing message',
      );
      assert.false(isLinkNotFound(null), 'rejects null');
      assert.false(isLinkNotFound(undefined), 'rejects undefined');
      assert.false(isLinkNotFound({}), 'rejects empty objects');
    });

    test('isNonPresentLink matches every member of LinkSentinel', function (assert) {
      assert.true(
        isNonPresentLink(makeNotLoaded()),
        'matches not-loaded sentinel',
      );
      assert.true(
        isNonPresentLink(makeLinkError()),
        'matches link-error sentinel',
      );
      assert.true(
        isNonPresentLink(makeLinkNotFound()),
        'matches link-not-found sentinel',
      );
      assert.false(isNonPresentLink(null), 'rejects null');
      assert.false(isNonPresentLink(undefined), 'rejects undefined');
      assert.false(isNonPresentLink({}), 'rejects empty objects');
      assert.false(
        isNonPresentLink({ type: 'link-error', reference: ref }),
        'rejects link-error shape missing errorDoc',
      );
      assert.false(
        isNonPresentLink({ type: 'something-else', reference: ref }),
        'rejects unknown sentinel type',
      );
    });

    test('predicates narrow types correctly', function (assert) {
      let val: unknown = makeLinkError();
      if (isLinkError(val)) {
        assert.strictEqual(
          val.type,
          'link-error',
          'type narrows to link-error',
        );
        assert.strictEqual(val.reference, ref, 'reference accessible');
        assert.strictEqual(val.errorDoc.status, 500, 'errorDoc accessible');
      } else {
        assert.ok(false, 'isLinkError did not narrow as expected');
      }

      let val2: unknown = makeLinkNotFound();
      if (isLinkNotFound(val2)) {
        assert.strictEqual(
          val2.type,
          'link-not-found',
          'type narrows to link-not-found',
        );
        assert.strictEqual(val2.errorDoc.status, 404, 'errorDoc accessible');
      } else {
        assert.ok(false, 'isLinkNotFound did not narrow as expected');
      }

      let val3: unknown = makeNotLoaded();
      if (isNonPresentLink(val3)) {
        assert.strictEqual(
          val3.reference,
          ref,
          'reference accessible after LinkSentinel narrowing',
        );
      } else {
        assert.ok(false, 'isNonPresentLink did not narrow as expected');
      }
    });
  },
);
