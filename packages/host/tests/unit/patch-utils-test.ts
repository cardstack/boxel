import { module, test } from 'qunit';

import { isPatchApplied } from '@cardstack/host/utils/patch-utils';

import { testRealmURL } from '../helpers';

module('Unit | patch utils', function () {
  /*
    class AddressField extends FieldDef {
      static displayName = 'Address Field';
      @field type = contains(StringField);
      @field isUSAddress = contains(BooleanField);
      @field street = contains(StringField);
      @field city = contains(StringField);
      @field state = contains(StringField);
      @field zip = contains(StringField);
    }

    class ContactField extends FieldDef {
      static displayName = 'Contact Field';
      @field name = contains(StringField);
      @field phone = contains(NumberField);
      @field address = contains(AddressField);
    }

    class ContactCard extends CardDef {
      static displayName = 'Contact Card';
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
      @field aliases = containsMany(StringField);
      @field email = contains(StringField);
      @field birthday = contains(DateField);
      @field phone = contains(NumberField);
      @field address = contains(AddressField);
      @field emergencyContact = contains(ContactField);
      @field otherAddresses = containsMany(AddressField);
      @field topContacts = containsMany(ContactField);
    }
  */

  test('it can compare results to patch object', async function (assert) {
    assert.true(isPatchApplied({}, {}, testRealmURL));

    let aliceHomeAddress = {
      type: 'Home',
      isUSAddress: true,
      street: '123 Main St',
      city: 'New York',
      state: 'NY',
      zip: 10001,
    };

    let jamesHomeAddress = {
      type: null,
      isUSAddress: false,
      street: null,
      city: null,
      state: null,
      zip: null,
    };

    let jamesContactField = {
      name: 'James Orange',
      phone: 3477777777,
      address: jamesHomeAddress,
    };

    let card = {
      type: 'card',
      attributes: {
        title: 'Alice Smith',
        description: null,
        thumbnailURL: null,
        firstName: 'Alice',
        lastName: 'Smith',
        aliases: ['Ali', 'Smithy'],
        email: 'alice.smith@mail.com',
        birthday: new Date('1990-02-01'),
        address: aliceHomeAddress,
        emergencyContact: jamesContactField,
      },
    };
    let patch = {
      attributes: {},
    };
    assert.true(isPatchApplied(card, patch, testRealmURL));

    patch = {
      attributes: {
        firstName: 'Alice',
        lastName: null,
      },
    };
    assert.false(isPatchApplied(card, patch, testRealmURL));

    patch = card;
    assert.true(isPatchApplied(card, patch, testRealmURL));

    patch = {
      attributes: {
        aliases: ['Ali'],
      },
    };
    assert.false(isPatchApplied(card, patch, testRealmURL));

    patch = {
      attributes: {
        aliases: ['Ali', 'Smithy'],
      },
    };
    assert.true(isPatchApplied(card, patch, testRealmURL));

    patch = {
      attributes: {
        aliases: ['Alice'],
      },
    };
    assert.false(isPatchApplied(card, patch, testRealmURL));

    patch = {
      attributes: {
        aliases: ['Ali', 'Bob', 'Smithy'],
      },
    };
    assert.false(isPatchApplied(card, patch, testRealmURL));

    patch = {
      attributes: {
        address: {
          street: '123 Main St',
        },
      },
    };
    assert.true(isPatchApplied(card, patch, testRealmURL));

    card['attributes']['emergencyContact']['phone'] = 1234561111;
    card['attributes']['emergencyContact']['address']['isUSAddress'] = true;
    patch = {
      attributes: {
        emergencyContact: {
          phone: 1234561111,
          address: {
            isUSAddress: true,
          },
        },
      },
    };
    assert.true(isPatchApplied(card, patch, testRealmURL));

    patch = {
      attributes: {
        emergencyContact: {
          address: {
            city: 'New York',
            state: 'NY',
          },
        },
      },
    };
    assert.false(isPatchApplied(card, patch, testRealmURL));
  });
});
