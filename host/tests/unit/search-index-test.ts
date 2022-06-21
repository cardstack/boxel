import { module, test, skip } from 'qunit';
import { SearchIndex } from '@cardstack/runtime-common/search-index';
import { TestRealm } from '../helpers';

module('Unit | search-index', function () {
  test('full indexing discovers card instances', async function (assert) {
    let realm = new TestRealm({
      'empty.json': {
        data: {
          attributes: {},
          meta: {
            adoptsFrom: {
              module: '//cardstack.com/base/card-api',
              name: 'Card',
            },
          },
        },
      },
    });
    let indexer = new SearchIndex(realm);
    await indexer.run();
    let cards = await indexer.search({});
    assert.strictEqual(cards.length, 1, 'found the card');
  });

  test('full indexing discovers card source where superclass card comes from outside local realm', async function (assert) {
    let realm = new TestRealm({
      'person.gts': `
        import { contains, field, Card } from '//cardstack.com/base/card-api';
        import StringCard from '//cardstack.com/base/string';
        
        export class Person extends Card {
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
        }
      `,
    });
    let indexer = new SearchIndex(realm);
    await indexer.run();

    let definition = await indexer.typeOf('person.gts', 'Person');
    assert.deepEqual(definition?.id, {
      module: 'http://test-realm/person.gts',
      name: 'Person',
    });
    assert.deepEqual(definition?.adoptionChain, [
      {
        module: 'http://cardstack.com/base/card-api',
        name: 'Card',
      },
    ]);
  });

  skip('full indexing discovers card source where super class card comes from different module in the local realm', async function (assert) {
    let realm = new TestRealm({
      'person.gts': `
        import { contains, field, Card } from '//cardstack.com/base/card-api';
        import StringCard from '//cardstack.com/base/string';
        
        export class Person extends Card {
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
        }
      `,
      'fancy-person.gts': `
        import { contains, field } from '//cardstack.com/base/card-api';
        import StringCard from '//cardstack.com/base/string';
        import { Person } from './person';
        
        export class FancyPerson extends Person {
          @field favoriteColor = contains(StringCard);
        }
      `,
    });
    let indexer = new SearchIndex(realm);
    await indexer.run();
    assert.ok(
      await indexer.typeOf('fancy-person.gts', 'FancyPerson'),
      'found FancyPerson definition'
    );
  });

  skip('full indexing discovers card source where superclass card comes same module', async function (assert) {
    let realm = new TestRealm({
      'person.gts': `
        import { contains, field, Card } from '//cardstack.com/base/card-api';
        import StringCard from '//cardstack.com/base/string';
        
        export class Person extends Card {
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
        }

        export class FancyPerson extends Person {
          @field favoriteColor = contains(StringCard);
        }
      `,
    });
    let indexer = new SearchIndex(realm);
    await indexer.run();
    assert.ok(
      await indexer.typeOf('person.gts', 'FancyPerson'),
      'found Person definition'
    );
  });

  skip('full indexing ignores card source where super class in a different module is not actually a card', async function (assert) {
    let realm = new TestRealm({
      'person.gts': `
        import { contains, field } from '//cardstack.com/base/card-api';
        import StringCard from '//cardstack.com/base/string';
        
        class NotACard {};
        
        export class Person extends NotACard {
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
        }
      `,
      'fancy-person.gts': `
        import { contains, field } from '//cardstack.com/base/card-api';
        import StringCard from '//cardstack.com/base/string';
        import { Person } from './person';
        
        export class FancyPerson extends Person {
          @field favoriteColor = contains(StringCard);
        }
      `,
    });
    let indexer = new SearchIndex(realm);
    await indexer.run();
    assert.strictEqual(
      await indexer.typeOf('fancy-person.gts', 'FancyPerson'),
      undefined,
      'FancyPerson is not actually a card'
    );
  });

  skip('full indexing ignores card source where the super class is in the same module and not actually a card', async function (assert) {
    let realm = new TestRealm({
      'person.gts': `
        import { contains, field } from '//cardstack.com/base/card-api';
        import StringCard from '//cardstack.com/base/string';
        
        class NotACard {}

        export class FancyPerson extends NotACard {
          @field favoriteColor = contains(StringCard);
        }
      `,
    });
    let indexer = new SearchIndex(realm);
    await indexer.run();
    assert.strictEqual(
      await indexer.typeOf('person.gts', 'FancyPerson'),
      undefined,
      'FancyPerson is not actually a card'
    );
  });

  skip('full indexing ignores cards that are not exported from their module', async function (assert) {
    let realm = new TestRealm({
      'person.gts': `
        import { contains, field, Card } from '//cardstack.com/base/card-api';
        import StringCard from '//cardstack.com/base/string';
        
        class Person extends Card {
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
        }
      `,
    });
    let indexer = new SearchIndex(realm);
    await indexer.run();
    assert.strictEqual(
      await indexer.typeOf('person.gts', 'Person'),
      undefined,
      'Person is not actually a card (that is exported)'
    );
  });

  skip('full indexing ignores card source where super class is in a different realm, but the realm says that the export is not actually a card', async function (assert) {
    let realm = new TestRealm({
      'person.gts': `
        import { contains, field, NotACard } from '//cardstack.com/base/card-api';
        import StringCard from '//cardstack.com/base/string';
        
        export class FancyPerson extends NotACard {
          @field favoriteColor = contains(StringCard);
        }
      `,
    });
    let indexer = new SearchIndex(realm);
    await indexer.run();
    assert.strictEqual(
      await indexer.typeOf('person.gts', 'FancyPerson'),
      undefined,
      'FancyPerson is not actually a card'
    );
  });

  // TODO test fields in card definitions
});
