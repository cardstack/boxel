import { module, test, skip } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { renderCard } from '../../helpers/render-component';
import { contains, field, Component } from 'runtime-spike/lib/card-api';
import StringCard from 'runtime-spike/lib/string';
import DateCard from 'runtime-spike/lib/date';

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

  skip('can serialize field');
  // use @model.field to prove field is serialized

  skip('can deserialize a nested field');
  skip('can serialize a nested field');

  skip('can deserialize a composite field');
  skip('can serialize a composite field');

  skip('can deserialize a containsMany field');
  skip('can serialize a containsMany field');

});