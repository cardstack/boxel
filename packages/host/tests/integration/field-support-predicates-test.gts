import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import type * as FieldSupportModule from 'https://cardstack.com/base/field-support';

import { setupCardLogs, setupLocalIndexing } from '../helpers';
import {
  setupBaseRealm,
  CardDef,
  StringField,
  field,
  contains,
  linksTo,
  linksToMany,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

let loader: Loader;
let isNotLoadedValue: (typeof FieldSupportModule)['isNotLoadedValue'];
let isLinkError: (typeof FieldSupportModule)['isLinkError'];
let isLinkNotFound: (typeof FieldSupportModule)['isLinkNotFound'];
let isNonPresentLink: (typeof FieldSupportModule)['isNonPresentLink'];
let scanForBrokenLinks: (typeof FieldSupportModule)['scanForBrokenLinks'];
let getDataBucket: (typeof FieldSupportModule)['getDataBucket'];
let relationshipMeta: (typeof FieldSupportModule)['relationshipMeta'];

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
      scanForBrokenLinks = fieldSupport.scanForBrokenLinks;
      getDataBucket = fieldSupport.getDataBucket;
      relationshipMeta = fieldSupport.relationshipMeta;
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

    test('scanForBrokenLinks finds nothing on a card with no sentinels', function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      let alice = new Person({ firstName: 'Alice' });
      assert.deepEqual(scanForBrokenLinks(alice), []);
    });

    test('scanForBrokenLinks finds a singular linksTo link-error sentinel', function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      let alice = new Person({ firstName: 'Alice' });
      getDataBucket(alice).set('pet', makeLinkError());
      let findings = scanForBrokenLinks(alice);
      assert.strictEqual(findings.length, 1, 'one finding emitted');
      assert.strictEqual(findings[0].fieldName, 'pet');
      assert.strictEqual(findings[0].sentinel.type, 'link-error');
      assert.strictEqual(findings[0].sentinel.reference, ref);
    });

    test('scanForBrokenLinks finds a singular linksTo link-not-found sentinel', function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      let alice = new Person({ firstName: 'Alice' });
      getDataBucket(alice).set('pet', makeLinkNotFound());
      let findings = scanForBrokenLinks(alice);
      assert.strictEqual(findings.length, 1);
      assert.strictEqual(findings[0].fieldName, 'pet');
      assert.strictEqual(findings[0].sentinel.type, 'link-not-found');
    });

    test('scanForBrokenLinks ignores not-loaded sentinels', function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      let alice = new Person({ firstName: 'Alice' });
      getDataBucket(alice).set('pet', makeNotLoaded());
      assert.deepEqual(
        scanForBrokenLinks(alice),
        [],
        'not-loaded is a transient state, not a render failure',
      );
    });

    test('scanForBrokenLinks finds a broken element inside a linksToMany array', function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
      let alice = new Person({ firstName: 'Alice' });
      let healthyPet = new Pet({ name: 'Mango' });
      getDataBucket(alice).set('pets', [
        healthyPet,
        makeLinkError(),
        makeLinkNotFound(),
      ]);
      let findings = scanForBrokenLinks(alice);
      assert.strictEqual(findings.length, 2);
      assert.strictEqual(findings[0].fieldName, 'pets');
      assert.strictEqual(findings[0].sentinel.type, 'link-error');
      assert.strictEqual(findings[1].fieldName, 'pets');
      assert.strictEqual(findings[1].sentinel.type, 'link-not-found');
    });

    test('scanForBrokenLinks finds a sentinel-shaped linksToMany whole-field value', function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
      let alice = new Person({ firstName: 'Alice' });
      // Computed linksToMany that consumes a not-yet-resolved link can
      // surface a single sentinel as the whole field value (see
      // relationshipMeta's plural branch). Verify the scan handles that
      // shape as well.
      getDataBucket(alice).set('pets', makeLinkError());
      let findings = scanForBrokenLinks(alice);
      assert.strictEqual(findings.length, 1);
      assert.strictEqual(findings[0].fieldName, 'pets');
      assert.strictEqual(findings[0].sentinel.type, 'link-error');
    });

    test('scanForBrokenLinks skips computed linksTo fields', function (assert) {
      // A computeVia returns the field's value, and for linksTo the
      // value has to be a live CardDef instance — Error/NotFound
      // sentinels are only ever planted by lazilyLoadLink's failure
      // path on a declared field, never produced by a computed. The
      // synthetic-sentinel return below is contrived to confirm the
      // scan does not attempt to inspect computeds at all.
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      let brokenSentinel = makeLinkError();
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field favoritePet = linksTo(Pet, {
          computeVia: function (this: Person) {
            return brokenSentinel as unknown as Pet;
          },
        });
      }
      let alice = new Person({ firstName: 'Alice' });
      assert.deepEqual(
        scanForBrokenLinks(alice),
        [],
        'computed linksTo is intentionally not scanned',
      );
    });

    test('scanForBrokenLinks aggregates findings across multiple linksTo fields', function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
        @field rival = linksTo(Pet);
      }
      let alice = new Person({ firstName: 'Alice' });
      getDataBucket(alice).set('pet', makeLinkError());
      getDataBucket(alice).set('rival', makeLinkNotFound());
      let findings = scanForBrokenLinks(alice);
      assert.strictEqual(findings.length, 2);
      let byField = Object.fromEntries(
        findings.map((f) => [f.fieldName, f.sentinel.type]),
      );
      assert.deepEqual(byField, {
        pet: 'link-error',
        rival: 'link-not-found',
      });
    });

    test('singular linksTo getter returns null for a link-error sentinel', function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      let alice = new Person({ firstName: 'Alice' });
      getDataBucket(alice).set('pet', makeLinkError());
      assert.strictEqual(alice.pet, null);
      // The terminal sentinel must survive the read so a subsequent scan
      // (e.g. the prerender's broken-link scan) can still locate it.
      let bucket = getDataBucket(alice).get('pet');
      assert.true(
        isLinkError(bucket),
        'sentinel still in bucket after getter read',
      );
    });

    test('singular linksTo getter returns null for a link-not-found sentinel', function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      let alice = new Person({ firstName: 'Alice' });
      getDataBucket(alice).set('pet', makeLinkNotFound());
      assert.strictEqual(alice.pet, null);
      assert.true(isLinkNotFound(getDataBucket(alice).get('pet')));
    });

    test('relationshipMeta treats Error / NotFound sentinels as not-loaded', function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
        @field rival = linksTo(Pet);
      }
      let alice = new Person({ firstName: 'Alice' });
      getDataBucket(alice).set('pet', makeLinkError());
      getDataBucket(alice).set('rival', makeLinkNotFound());

      let petMeta = relationshipMeta(alice, 'pet');
      assert.deepEqual(
        petMeta,
        { type: 'not-loaded', reference: ref },
        'link-error sentinel surfaces as a not-loaded RelationshipMeta',
      );

      let rivalMeta = relationshipMeta(alice, 'rival');
      assert.deepEqual(
        rivalMeta,
        { type: 'not-loaded', reference: ref },
        'link-not-found sentinel surfaces as a not-loaded RelationshipMeta',
      );
    });

    test('linksToMany getter does not retrigger load on a terminal sentinel element', function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
      let alice = new Person({ firstName: 'Alice' });
      let healthyPet = new Pet({ name: 'Mango' });
      let brokenSentinel = makeLinkError();
      let stored = [healthyPet, brokenSentinel];
      getDataBucket(alice).set('pets', stored);

      // Read through the public getter. The terminal sentinel must remain
      // unchanged in the array — the linksToMany lazy-load loop only acts
      // on isNotLoadedValue entries, so a sentinel-bearing slot must not
      // be replaced or refetched.
      let pets = alice.pets;
      assert.strictEqual(pets.length, 2, 'array length preserved');
      assert.strictEqual(pets[0], healthyPet, 'healthy element untouched');
      assert.true(
        isLinkError(pets[1]),
        'sentinel element remains in place after read',
      );
    });
  },
);
