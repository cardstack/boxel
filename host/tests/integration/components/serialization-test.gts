import { module, test, skip } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import stringify from 'fast-json-stable-stringify'
import { renderCard } from '../../helpers/render-component';
import { contains, field, Component, serializedGet } from 'runtime-spike/lib/card-api';
import StringCard from 'runtime-spike/lib/string';
import DateCard from 'runtime-spike/lib/date';
import DatetimeCard from 'runtime-spike/lib/datetime';
import parseISO from 'date-fns/parseISO';
import { p, cleanWhiteSpace } from '../../helpers';

module('Integration | serialization', function (hooks) {
  setupRenderingTest(hooks);

  test('can deserialize field', async function (assert) {
    class Post {
      @field title = contains(StringCard);
      @field created = contains(DateCard);
      @field published = contains(DatetimeCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.title/> created <@fields.created/> published <@fields.published /></template>
      }
    }
    class FirstPost extends Post {
      static data = { title: 'First Post', created: '2022-04-22', published: '2022-04-27T16:02' }
    }

    await renderCard(FirstPost, 'isolated');

    // the template value 'Apr 22, 2022' can only be realized when the card has
    // correctly deserialized it's static data property
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'First Post created Apr 22, 2022 published Apr 27, 2022, 4:02 PM');
  });

  test('can serialize field', async function(assert) {
    class Post {
      @field title = contains(StringCard);
      @field created = contains(DateCard);
      @field published = contains(DatetimeCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template>created {{serializedGet @model 'created'}}, published {{serializedGet @model 'published'}}</template>
      }
    }
    class FirstPost extends Post {
      // initialize card data as deserialized to force us to serialize instead of using cached data
      static data = { title: 'First Post', created: p('2022-04-22'), published: parseISO('2022-04-27T16:30+00:00') }
    }

    await renderCard(FirstPost, 'isolated', { dataIsDeserialized: true });
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'created 2022-04-22, published 2022-04-27T16:30:00.000Z');
  });

  test('can deserialize a nested field', async function(assert) {
    class Person {
      @field firstName = contains(StringCard);
      @field birthdate = contains(DateCard);
      @field lastLogin = contains(DatetimeCard);
    }

    class Post {
      @field title = contains(StringCard);
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template>birthdate <@fields.author.birthdate/> last login <@fields.author.lastLogin/></template>
      }
    }

    class FirstPost extends Post {
      static data = { title: 'First Post', author: { firstName: 'Mango', birthdate: '2019-10-30', lastLogin: '2022-04-27T16:58' } }
    }

    await renderCard(FirstPost, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'birthdate Oct 30, 2019 last login Apr 27, 2022, 4:58 PM');
  });

  test('can deserialize a composite field', async function(assert) {
    class Person {
      @field firstName = contains(StringCard);
      @field birthdate = contains(DateCard);
      @field lastLogin = contains(DatetimeCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName/> born on: <@fields.birthdate/> last logged in: <@fields.lastLogin/></template>
      }
    }

    class Post {
      @field title = contains(StringCard);
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.author/></template>
      }
    }

    class FirstPost extends Post {
      static data = { title: 'First Post', author: { firstName: 'Mango', birthdate: '2019-10-30', lastLogin: '2022-04-27T17:00' } }
    }

    await renderCard(FirstPost, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'Mango born on: Oct 30, 2019 last logged in: Apr 27, 2022, 5:00 PM');
  });

  test('can serialize a composite field', async function(assert) {
    class Animal {
      @field species = contains(StringCard);
    }

    class Person extends Animal {
      @field firstName = contains(StringCard);
      @field birthdate = contains(DateCard);
      @field lastLogin = contains(DatetimeCard);
    }

    class Post {
      @field title = contains(StringCard);
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template>{{stringify (serializedGet @model 'author')}}</template>
      }
    }

    class FirstPost extends Post {
      static data = { title: 'First Post', author: { firstName: 'Mango', birthdate: p('2019-10-30'), species: 'canis familiaris', lastLogin: parseISO('2022-04-27T16:30+00:00') } }
    }
    await renderCard(FirstPost, 'isolated', { dataIsDeserialized: true });
    assert.strictEqual(this.element.textContent!.trim(), `{"birthdate":"2019-10-30","firstName":"Mango","lastLogin":"2022-04-27T16:30:00.000Z","species":"canis familiaris"}`);
  });

  test('can serialize a computed field', async function(assert) {
    class Person {
      @field birthdate = contains(DateCard);
      @field firstBirthday = contains(DateCard,
        function(this: Person) {
          return new Date(this.birthdate.getFullYear() + 1, this.birthdate.getMonth(), this.birthdate.getDate());
        });
      static isolated = class Isolated extends Component<typeof this> {
        <template>{{serializedGet @model 'firstBirthday'}}</template>
      }
    }

    class Mango extends Person {
      static data = { birthdate: p('2019-10-30') }
    }

    await renderCard(Mango, 'isolated', { dataIsDeserialized: true});
    assert.strictEqual(this.element.textContent!.trim(), '2020-10-30');
  });

  skip('can deserialize a containsMany field');
  skip('can serialize a containsMany field');
});
