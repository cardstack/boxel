import { module, test, skip } from 'qunit';
import { renderCard } from '../../helpers/render-component';
import { contains, field, Component } from 'runtime-spike/lib/card-api';
import StringCard from 'runtime-spike/lib/string';
import { setupRenderingTest } from 'ember-qunit';

module('Integration | serialization', function (hooks) {
  setupRenderingTest(hooks);

  test('can render a synchronous computed field', async function(assert) {
    class Person {
      @field firstName = contains(StringCard);
      @field lastName = contains(StringCard);
      @field fullName = contains(StringCard, function(this: Person) { return `${this.firstName} ${this.lastName}`; });
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.fullName/></template>
      }
    }

    class Mango extends Person {
      static data = { firstName: 'Mango', lastName: 'Abdel-Rahman' };
    }

    await renderCard(Mango, 'isolated');

    assert.strictEqual(this.element.textContent!.trim(), 'Mango Abdel-Rahman');
  });

  skip('can render a computed that consumes a nested property');
  skip('can render a computed that has a serializer');
  skip('can render a computed that is a composite type');
});