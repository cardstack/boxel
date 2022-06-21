import { module, test } from 'qunit';
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

  test('full indexing discovers card sources', async function (assert) {
    let realm = new TestRealm({
      'person.gts': `
        import { contains, field, Component, Card } from '//cardstack.com/base/card-api';
        import StringCard from '//cardstack.com/base/string';
        
        export class Person extends Card {
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
          static embedded = class Embedded extends Component<typeof this> {
            <template><@fields.firstName/> <@fields.lastName /></template>
          }
          static isolated = class Isolated extends Component<typeof this> {
            <template><h1><@fields.firstName/> <@fields.lastName /></h1></template>
          }
        }
      `,
    });
    let indexer = new SearchIndex(realm);
    await indexer.run();
    assert.ok(
      await indexer.typeOf('person.gts', 'Person'),
      'found Person definition'
    );
  });
});
