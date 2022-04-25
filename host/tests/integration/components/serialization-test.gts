import { module, test, skip } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { parse } from 'date-fns';
import { renderCard } from '../../helpers/render-component';
import { contains, field, Component, serializedGet } from 'runtime-spike/lib/card-api';
import StringCard from 'runtime-spike/lib/string';
import DateCard from 'runtime-spike/lib/date';

function p(dateString: string): Date {
  return parse(dateString, 'yyyy-MM-dd', new Date());
}

module('Integration | serialization', function (hooks) {
  setupRenderingTest(hooks);

  test('can deserialize field', async function (assert) {
    class Post {
      @field title = contains(StringCard)
      @field created = contains(DateCard)
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.title/> created <@fields.created/></template>
      }
    }
    class FirstPost extends Post {
      static data = { title: 'First Post', created: '2022-04-22' }
    }

    await renderCard(FirstPost, 'isolated');

    // the template value 'Apr 22, 2022' can only be realized when the card has
    // correctly deserialized it's static data property
    assert.dom('[data-test="date"]').containsText('Apr 22, 2022');
  });

  test('can serialize field', async function(assert) {
    class Post {
      @field title = contains(StringCard)
      @field created = contains(DateCard)
      static isolated = class Isolated extends Component<typeof this> {
        <template>created {{serializedGet @model 'created'}}</template>
      }
    }
    class FirstPost extends Post {
      // initialze card data as deserialized to force us to serialize instead of using cached data
      static data = { title: 'First Post', created: p('2022-04-22') }
    }

    await renderCard(FirstPost, 'isolated', { dataIsDeserialized: true });
    assert.strictEqual(this.element.textContent!.trim(), 'created 2022-04-22');
  });

  skip('can deserialize a nested field');
  skip('can serialize a nested field');

  skip('can deserialize a composite field');
  skip('can serialize a composite field');

  skip('can deserialize a containsMany field');
  skip('can serialize a containsMany field');

});