import { module, test } from 'qunit';
import { CardDefinitions } from 'runtime-spike/lib/schema-util';

module('Unit | schema-util', function (_hooks) {
  test('renders card chooser', async function (assert) {
    let src = `
      import { contains, field, Card } from 'runtime-spike/lib/card-api';
      import StringCard from 'runtime-spike/lib/string';
      export class Person extends Card {
        @field firstName = contains(StringCard)
      }
    `;

    let definitions = new CardDefinitions(src);
    assert.ok(
      definitions.getCard('Person').getField('firstName'),
      'found firstName field'
    );
  });

  // TODO:
  // test default exports
  // test reexports
  // test namespace imports (where we import from card-api via a namespace import)
  // test export all
});
