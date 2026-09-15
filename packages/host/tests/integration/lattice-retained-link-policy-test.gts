import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { rri } from '@cardstack/runtime-common';
import {
  getFieldDefinitions,
  getFieldDef,
  getImmediateFieldDef,
} from '@cardstack/runtime-common/definitions';
import type { Definition } from '@cardstack/runtime-common/definitions';
import { getLatticeFieldDefinitions } from '@cardstack/runtime-common/lattice-compute-definitions';

import {
  setupBaseRealm,
  CardDef,
  FieldDef,
  contains,
  containsMany,
  field,
  linksTo,
  linksToMany,
  StringField,
} from '../helpers/base-realm';
import { setupRenderingTest } from '../helpers/setup';

module('Integration | Lattice retained link policy', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  test('preserves explicit singular and plural opt-outs without changing default field metadata', async function (assert) {
    const api = await getService('card-service').getAPI();
    class Owner extends CardDef {
      @field first = linksTo(CardDef);
      @field second = linksTo(CardDef);
      @field privateLink = linksTo(CardDef, { snapshot: false });
      @field peers = linksToMany(CardDef);
      @field privatePeers = linksToMany(CardDef, { snapshot: false });
    }
    const descriptors = api.getFields(Owner);
    assert.false(descriptors.privateLink.snapshot);
    assert.false(descriptors.privatePeers.snapshot);
    assert.strictEqual(descriptors.first.snapshot, undefined);
    assert.strictEqual(descriptors.peers.snapshot, undefined);

    for (const captured of [
      getFieldDefinitions(api, Owner),
      getLatticeFieldDefinitions(api, Owner),
    ]) {
      const roundTrip = JSON.parse(JSON.stringify(captured));
      assert.strictEqual(captured.fields.first, captured.fields.second);
      assert.notStrictEqual(captured.fields.first, captured.fields.privateLink);
      assert.deepEqual(getImmediateFieldDef(roundTrip, 'privateLink'), {
        ...getImmediateFieldDef(roundTrip, 'first')!,
        snapshot: false,
      });
      assert.deepEqual(getImmediateFieldDef(roundTrip, 'privatePeers'), {
        ...getImmediateFieldDef(roundTrip, 'peers')!,
        snapshot: false,
      });
      assert.false(
        Object.hasOwn(getImmediateFieldDef(roundTrip, 'first')!, 'snapshot'),
      );
      assert.false(
        Object.hasOwn(getImmediateFieldDef(roundTrip, 'peers')!, 'snapshot'),
      );
    }
  });

  test('inherits the policy and permits a subclass to redeclare the default without changing its parent', async function (assert) {
    const api = await getService('card-service').getAPI();
    class Parent extends CardDef {
      @field contact = linksTo(CardDef, { snapshot: false });
      @field contacts = linksToMany(CardDef, { snapshot: false });
    }
    class Inherited extends Parent {}
    class Reset extends Parent {
      @field contact = linksTo(CardDef);
      @field contacts = linksToMany(CardDef);
    }
    for (const name of ['contact', 'contacts']) {
      assert.false(
        getImmediateFieldDef(getFieldDefinitions(api, Inherited), name)
          ?.snapshot,
      );
      assert.strictEqual(
        getImmediateFieldDef(getFieldDefinitions(api, Reset), name)?.snapshot,
        undefined,
      );
      assert.false(
        getImmediateFieldDef(getFieldDefinitions(api, Parent), name)?.snapshot,
      );
    }
  });

  test('reads nested and query policies from serialized definition data without executing card computations', async function (assert) {
    const api = await getService('card-service').getAPI();
    let computations = 0;
    class Detail extends FieldDef {
      @field peers = linksToMany(CardDef, { snapshot: false });
    }
    class Owner extends CardDef {
      @field detail = contains(Detail);
      @field details = containsMany(Detail);
      @field matching = linksToMany(CardDef, {
        snapshot: false,
        query: { page: { size: 3 } },
      });
      @field derived = linksTo(CardDef, {
        snapshot: false,
        computeVia: () => {
          computations++;
          throw new Error('Policy inspection must not execute this field');
        },
      });
    }
    const moduleURL = 'https://example.com/retained-link-policy';
    getService('loader-service').loader.shimModule(moduleURL, {
      Detail,
      Owner,
    });
    const child: Definition = {
      type: 'field-def',
      codeRef: { module: rri(moduleURL), name: 'Detail' },
      displayName: null,
      ...getFieldDefinitions(api, Detail),
    };
    const root = JSON.parse(
      JSON.stringify(getLatticeFieldDefinitions(api, Owner)),
    );
    const lookups: unknown[] = [];
    const lookup = async (ref: unknown) => {
      lookups.push(ref);
      assert.deepEqual(
        ref,
        child.codeRef,
        'only contained definition data is requested',
      );
      return JSON.parse(JSON.stringify(child)) as Definition;
    };
    assert.false((await getFieldDef(root, 'detail.peers', lookup))?.snapshot);
    assert.false((await getFieldDef(root, 'details.peers', lookup))?.snapshot);
    assert.strictEqual(lookups.length, 2);
    assert.false(getImmediateFieldDef(root, 'matching')?.snapshot);
    assert.deepEqual(getImmediateFieldDef(root, 'matching')?.query, {
      page: { size: 3 },
    });
    assert.false(getImmediateFieldDef(root, 'derived')?.snapshot);
    assert.strictEqual(computations, 0);
  });

  test('the field opt-out is not serialized into authored card data', async function (assert) {
    const api = await getService('card-service').getAPI();
    class Owner extends CardDef {
      @field label = contains(StringField);
      @field contact = linksTo(CardDef, { snapshot: false });
      @field contacts = linksToMany(CardDef, { snapshot: false });
    }
    getService('loader-service').loader.shimModule(
      'https://example.com/retained-link-source',
      { Owner },
    );
    const target = new CardDef({ id: 'https://example.com/cards/target' });
    const owner = new Owner({
      id: 'https://example.com/cards/owner',
      label: 'Keep my source',
      contact: target,
      contacts: [target],
    });
    const doc = api.serializeCard(owner, {
      includeComputeds: false,
      includeLinkedResources: false,
      useAbsoluteURL: true,
    });
    assert.strictEqual(doc.data.attributes?.label, 'Keep my source');
    assert.deepEqual(doc.data.relationships?.contact, {
      links: { self: target.id },
      data: { type: 'card', id: target.id },
    });
    assert.deepEqual(doc.data.relationships?.['contacts.0'], {
      links: { self: target.id },
      data: { type: 'card', id: target.id },
    });
    assert.false(
      JSON.stringify(doc).includes('snapshot'),
      'retention is definition policy, not an instance-file mutation',
    );
    assert.false(
      api.getFields(owner).contact?.snapshot,
      'instance descriptors preserve the policy',
    );
  });

  test('capture observes resident membership and preserves contained paths without evaluating computeds', async function (assert) {
    const api = await getService('card-service').getAPI();
    let computed = 0;
    class Person extends CardDef {
      @field peer = linksTo(CardDef);
    }
    class Detail extends FieldDef {
      @field person = linksTo(CardDef);
    }
    class Owner extends CardDef {
      @field person = linksTo(Person);
      @field people = linksToMany(Person);
      @field privatePerson = linksTo(Person, { snapshot: false });
      @field privatePeople = linksToMany(Person, { snapshot: false });
      @field detail = contains(Detail);
      @field details = containsMany(Detail);
      @field untouched = linksTo(CardDef);
      @field computed = linksTo(CardDef, {
        computeVia: () => {
          computed++;
          throw new Error('Capture invoked a computed');
        },
      });
    }
    const target = new CardDef({ id: 'https://example.com/cards/target' });
    const person = new Person({
      id: 'https://example.com/cards/person',
      peer: target,
    });
    const owner = new Owner({
      id: 'https://example.com/cards/owner',
      person,
      people: [person],
      privatePerson: person,
      privatePeople: [person],
      detail: new Detail({ person: target }),
      details: [new Detail({ person: target })],
    });
    const result = api
      .latticeLoadedLinks(owner)
      .sort((a, b) =>
        `${a.ownerURL}/${a.fieldPath}`.localeCompare(
          `${b.ownerURL}/${b.fieldPath}`,
        ),
      );
    assert.deepEqual(result, [
      { ownerURL: owner.id, fieldPath: 'detail.person', sourceURL: target.id },
      {
        ownerURL: owner.id,
        fieldPath: 'details.0.person',
        sourceURL: target.id,
      },
      { ownerURL: owner.id, fieldPath: 'people', sourceURL: person.id },
      { ownerURL: owner.id, fieldPath: 'person', sourceURL: person.id },
      { ownerURL: person.id, fieldPath: 'peer', sourceURL: target.id },
    ]);
    assert.strictEqual(computed, 0);
    assert.false(
      api.getDataBucket(owner).has('untouched'),
      'capture does not initialize an unread link',
    );
  });
});
