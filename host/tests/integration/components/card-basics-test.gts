import { module, test, skip } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { fillIn, click, waitUntil } from '@ember/test-helpers';
import { renderCard } from '../../helpers/render-component';
import { contains, containsMany, field, Component, primitive, Card } from 'runtime-spike/lib/card-api';
import StringCard from 'runtime-spike/lib/string';
import IntegerCard from 'runtime-spike/lib/integer';
import DateCard from 'runtime-spike/lib/date';
import DatetimeCard from 'runtime-spike/lib/datetime';
import { cleanWhiteSpace, p } from '../../helpers';
import parseISO from 'date-fns/parseISO';

module('Integration | card-basics', function (hooks) {
  setupRenderingTest(hooks);

  test('primitive field type checking', async function (assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field title = contains(StringCard);
      @field number = contains(IntegerCard);
      @field languagesSpoken = containsMany(StringCard);

      static isolated = class Isolated extends Component<typeof this> {
        <template>
          {{@model.firstName}}
          {{@model.title}}
          {{@model.number}}
          {{#each @model.languagesSpoken as |language|}}
            {{language}}
          {{/each}}
        </template>
      }
    }
    let card = new Person();
    card.firstName = 'arthur';
    card.number = 42;
    card.languagesSpoken = ['english', 'japanese'];
    let readName: string = card.firstName;
    assert.strictEqual(readName, 'arthur');
    let readNumber: number = card.number;
    assert.strictEqual(readNumber, 42);
    let readLanguages: string[] = card.languagesSpoken;
    assert.deepEqual(readLanguages, ['english', 'japanese']);
  });

  test('access @model for primitive and composite fields', async function (assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field subscribers = contains(IntegerCard);
      @field languagesSpoken = containsMany(StringCard);
    }

    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person);
      @field languagesSpoken = containsMany(StringCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          {{@model.title}} by {{@model.author.firstName}}
          speaks {{#each @model.author.languagesSpoken as |language|}} {{language}} {{/each}}
          {{@model.author.subscribers}} subscribers
        </template>
      }
    }

    let helloWorld = Post.fromSerialized({
      title: 'First Post',
      author: {
          firstName: 'Arthur',
          subscribers: 5,
          languagesSpoken: ['english', 'japanese']
        },
    });

    await renderCard(helloWorld, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'First Post by Arthur speaks english japanese 5 subscribers');
  });

  test('render primitive field', async function (assert) {
    class EmphasizedString extends Card {
      static [primitive]: string;
      static embedded = class Embedded extends Component<typeof this> {
        <template><em data-test="name">{{@model}}</em></template>
      }
    }

    class StrongInteger extends Card {
      static [primitive]: number;
      static embedded = class Embedded extends Component<typeof this> {
        <template><strong data-test="integer">{{@model}}</strong></template>
      }
    }

    class Person extends Card {
      @field firstName = contains(EmphasizedString);
      @field number = contains(StrongInteger);

      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName /><@fields.number /></template>
      }
    }

    let arthur = new Person({ firstName: 'Arthur', number: 10 });

    await renderCard(arthur, 'embedded');
    assert.dom('[data-test="name"]').containsText('Arthur');
    assert.dom('[data-test="integer"]').containsText('10');
  });

  test('render whole composite field', async function (assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field title = contains(StringCard);
      @field number = contains(IntegerCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.title/> <@fields.firstName /> <@fields.number /></template>
      }
    }

    class Post extends Card {
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template><div data-test><@fields.author /></div></template>
      }
    }

    let helloWorld = Post.fromSerialized({ author: { firstName: 'Arthur', title: 'Mr', number: 10 } });
    await renderCard(helloWorld, 'isolated');
    assert.dom('[data-test]').containsText('Mr Arthur 10');
  });

  test('render a field that is the enclosing card', async function(assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field friend = contains(() => Person); // a thunk can be used to specify a circular reference
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.firstName/> friend is <@fields.friend/></template>
      }
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName/></template>
      }
    }

    let mango = Person.fromSerialized({ firstName: 'Mango', friend: { firstName: 'Van Gogh' } });
    await renderCard(mango, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'Mango friend is Van Gogh');
  });

  test('render nested composite field', async function (assert) {
    class TestString extends Card {
      static [primitive]: string;
      static embedded = class Embedded extends Component<typeof this> {
        <template><em data-test="string">{{@model}}</em></template>
      }
    }

    class TestInteger extends Card {
      static [primitive]: number;
      static embedded = class Embedded extends Component<typeof this> {
        <template><strong data-test="integer">{{@model}}</strong></template>
      }
    }

    class Person extends Card {
      @field firstName = contains(TestString);
      @field number = contains(TestInteger);
    }

    class Post extends Card {
      @field title = contains(TestString);
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
      <template><@fields.author.firstName /><@fields.author.number /></template>
      }
    }

    let helloWorld = Post.fromSerialized({ author: { firstName: 'Arthur', number: 10 } });

    await renderCard(helloWorld, 'isolated');
    assert.dom('[data-test="string"]').containsText('Arthur');
    assert.dom('[data-test="integer"]').containsText('10');
  });

  test('render default isolated template', async function (assert) {
    class Person extends Card {
      @field firstName = contains(testString('first-name'));

      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName /></template>
      }
    }

    class Post extends Card{
      @field title = contains(testString('title'));
      @field author = contains(Person);
    }

    let helloWorld = Post.fromSerialized({ title: 'First Post', author: { firstName: 'Arthur' } });

    await renderCard(helloWorld, 'isolated');

    assert.dom('[data-test="first-name"]').containsText('Arthur');
    assert.dom('[data-test="title"]').containsText('First Post');
  });

  test('render a containsMany primitive field', async function (assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field languagesSpoken = containsMany(StringCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.firstName/> speaks <@fields.languagesSpoken/></template>
      }
    }

    let mango = new Person({
      firstName: 'Mango',
      languagesSpoken: ['english', 'japanese']
    });

    await renderCard(mango, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'Mango speaks english japanese');
  });

  test('supports an empty containsMany primitive field', async function (assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field languagesSpoken = containsMany(StringCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.firstName/> speaks <@fields.languagesSpoken/></template>
      }
    }
    let mango = new Person({ firstName: 'Mango' });
    assert.deepEqual(mango.languagesSpoken, [], 'empty containsMany field is initialized to an empty array');
  });

  test('render a containsMany composite field', async function (assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName/></template>
      }
    }

    class Family extends Card {
      @field people = containsMany(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.people/></template>
      }
    }
    let abdelRahmans = Family.fromSerialized({
      people: [
        { firstName: 'Mango'},
        { firstName: 'Van Gogh'},
        { firstName: 'Hassan'},
        { firstName: 'Mariko'},
        { firstName: 'Yume'},
        { firstName: 'Sakura'},
      ]
    });

    await renderCard(abdelRahmans, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'Mango Van Gogh Hassan Mariko Yume Sakura');
  });

  test('rerender when a primitive field changes', async function(assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><div data-test="firstName"><@fields.firstName/></div></template>
      }
    }
    let child = new Person({ firstName: 'Arthur' });
    await renderCard(child, 'embedded');
    assert.dom('[data-test="firstName"]').containsText('Arthur');
    child.firstName = 'Quint';
    await waitUntil(() => document.querySelector('[data-test="firstName"]')?.textContent?.trim() === 'Quint');
  });


  test('rerender when a containsMany field is fully replaced', async function(assert) {
    class Person extends Card {
      @field pets = containsMany(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.pets/></template>
      }
    }
    let person = new Person({ pets: ['Mango', 'Van Gogh'] });
    await renderCard(person, 'embedded');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'Mango Van Gogh');
    person.pets = ['Van Gogh', 'Mango', 'Peachy'];
    await waitUntil(() => cleanWhiteSpace(this.element.textContent!) === 'Van Gogh Mango Peachy');
  });

  skip('rerender when a containsMany field is mutated via assignment', async function(assert) {
    class Person extends Card {
      @field pets = containsMany(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.pets/></template>
      }
    }
    let person = new Person({ pets: ['Mango', 'Van Gogh'] });
    await renderCard(person, 'embedded');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'Mango Van Gogh');
    person.pets[1] = 'Peachy';
    await waitUntil(() => cleanWhiteSpace(this.element.textContent!) === 'Mango Peachy');
  });


  test('supports an empty containsMany composite field', async function (assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName/></template>
      }
    }

    class Family extends Card {
      @field people = containsMany(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.people/></template>
      }
    }

    let abdelRahmans = new Family();
    assert.deepEqual(abdelRahmans.people, [], 'empty containsMany field is initialized to an empty array');
  });

  test('throws if contains many value is set with a non-array', async function(assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field languagesSpoken = containsMany(StringCard);
    }
    assert.throws(() => new Person({ languagesSpoken: 'english' }), /Expected array for field value languagesSpoken/);
    assert.throws(() => Person.fromSerialized({ languagesSpoken: 'english' }).languagesSpoken, /Expected array for field value languagesSpoken/);
  });

  test('render default edit template', async function (assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
    }

    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person);
    }

    let helloWorld = Post.fromSerialized({ title: 'My Post', author: { firstName: 'Arthur' } });

    await renderCard(helloWorld, 'edit');
    assert.dom('[data-test-field="title"]').containsText('Title');
    assert.dom('[data-test-field="title"] input').hasValue('My Post');
    assert.dom('[data-test-field="author"]').containsText('Author First Name'); // TODO: fix nested labels
    assert.dom('[data-test-field="author"] input').hasValue('Arthur');

    await fillIn('[data-test-field="title"] input', 'New Post');
    await fillIn('[data-test-field="author"] input', 'Carl Stack');
    // Check that outputs have changed
  });

  test('can adopt a card', async function (assert) {
    class Animal extends Card {
      @field species = contains(testString('species'));
    }
    class Person extends Animal {
      @field firstName = contains(testString('first-name'));
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName /><@fields.species/></template>
      }
    }

    let hassan = new Person ({ firstName: 'Hassan', species: 'Homo Sapiens' });

    await renderCard(hassan, 'embedded');
    assert.dom('[data-test="first-name"]').containsText('Hassan');
    assert.dom('[data-test="species"]').containsText('Homo Sapiens');
  });

  test('can edit primitive and composite fields', async function (assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName /></template>
      }
    }

    class Post extends Card {
      @field title = contains(StringCard);
      @field reviews = contains(IntegerCard);
      @field author = contains(Person);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <fieldset>
            <label data-test-field="title">Title <@fields.title /></label>
            <label data-test-field="reviews">Reviews <@fields.reviews /></label>
            <label data-test-field="author">Author <@fields.author /></label>
          </fieldset>

          <div data-test-output="title">{{@model.title}}</div>
          <div data-test-output="reviews">{{@model.reviews}}</div>
          <div data-test-output="author.firstName">{{@model.author.firstName}}</div>
        </template>
      }
    }

    let helloWorld = Post.fromSerialized({ title: 'First Post', reviews: 1, author: { firstName: 'Arthur' } });

    await renderCard(helloWorld, 'edit');
    assert.dom('[data-test-field="title"] input').hasValue('First Post');
    assert.dom('[data-test-field="reviews"] input').hasValue('1');
    assert.dom('[data-test-field="author"] input').hasValue('Arthur');

    await fillIn('[data-test-field="title"] input', 'New Title');
    await fillIn('[data-test-field="reviews"] input', '5');
    await fillIn('[data-test-field="author"] input', 'Carl Stack');

    assert.dom('[data-test-output="title"]').hasText('New Title');
    assert.dom('[data-test-output="reviews"]').hasText('5');
    assert.dom('[data-test-output="author.firstName"]').hasText('Carl Stack');
  });

  test('add, remove and edit items in containsMany string field', async function (assert) {
    class Person extends Card {
      @field languagesSpoken = containsMany(StringCard);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <@fields.languagesSpoken />
          <ul data-test-output>
            {{#each @model.languagesSpoken as |language|}}
              <li>{{language}}</li>
            {{/each}}
          </ul>
        </template>
      }
    }

    let card = new Person({
      languagesSpoken: ['english', 'japanese'],
    });

    await renderCard(card, 'edit');
    assert.dom('[data-test-item]').exists({ count: 2 });
    assert.dom('[data-test-item="0"] input').hasValue('english');
    assert.dom('[data-test-output]').hasText('english japanese');

    await fillIn('[data-test-item="1"] input', 'italian');
    assert.dom('[data-test-output]').hasText('english italian');

    await click('[data-test-add-new]');
    await fillIn('[data-test-item="2"] input', 'french');
    assert.dom('[data-test-item]').exists({ count: 3 });
    assert.dom('[data-test-output]').hasText('english italian french');

    await click('[data-test-add-new]');
    await fillIn('[data-test-item="3"] input', 'spanish');
    assert.dom('[data-test-item]').exists({ count: 4 });
    assert.dom('[data-test-output]').hasText('english italian french spanish');

    await click('[data-test-remove="0"]');
    assert.dom('[data-test-item]').exists({ count: 3 });
    assert.dom('[data-test-output]').hasText('italian french spanish');
  });

  skip('add, remove and edit items in containsMany date and datetime fields', async function (assert) {
    function toDateString(date: Date | null) {
      return date instanceof Date ? date.toISOString().split('T')[0] : null;
    }

    class Person extends Card {
      @field dates = containsMany(DateCard);
      @field appointments = containsMany(DatetimeCard);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <@fields.dates />
          <ul data-test-output="dates">
            {{#each @model.dates as |date|}}
              <li>{{toDateString date}}</li>
            {{/each}}
          </ul>

          <@fields.appointments />
          <ul data-test-output="appointments">
            {{#each @model.appointments as |appointment|}}
              <li>{{toDateString appointment}}</li>
            {{/each}}
          </ul>
        </template>
      }
    }

    let card = new Person({
      dates: [p('2022-05-12'), p('2022-05-11'), p('2021-05-13')],
      appointments: [parseISO('2022-05-13T13:00+00:00'), parseISO('2021-05-30T10:45+00:00')],
    });

    await renderCard(card, 'edit');
    assert.dom('[data-test-contains-many="dates"] [data-test-item]').exists({ count: 3 });
    assert.dom('[data-test-contains-many="dates"] [data-test-item="0"] input').hasValue('2022-05-12');
    assert.dom('[data-test-output="dates"]').hasText('2022-05-12 2022-05-11 2021-05-13');

    await click('[data-test-contains-many="dates"] [data-test-add-new]');
    await fillIn('[data-test-contains-many="dates"] [data-test-item="3"] input', '2022-06-01');
    assert.dom('[data-test-contains-many="dates"] [data-test-item]').exists({ count: 4 });
    assert.dom('[data-test-output="dates"]').hasText('2022-05-12 2022-05-11 2021-05-13 2022-06-01');

    await click('[data-test-contains-many="dates"] [data-test-remove="1"]');
    await click('[data-test-contains-many="dates"] [data-test-remove="2"]'); // note: after removing index=1, the previous indexes of the following items have shifted by 1
    assert.dom('[data-test-contains-many="dates"] [data-test-item]').exists({ count: 2 });
    assert.dom('[data-test-output="dates"]').hasText('2022-05-12 2021-05-13');

    await fillIn('[data-test-contains-many="dates"] [data-test-item="1"] input', '2022-04-10');
    assert.dom('[data-test-output]').hasText('2022-05-12 2022-04-10');

    assert.dom('[data-test-contains-many="appointments"] [data-test-item]').exists({ count: 2 });
    assert.dom('[data-test-contains-many="appointments"] [data-test-item="0"] input').hasValue('2022-05-13T13:00:00');
    assert.dom('[data-test-output="appointments"]').hasText('2022-05-13 2021-05-30');

    await fillIn('[data-test-contains-many="appointments"] [data-test-item="0"] input', '2022-05-01T11:01');
    assert.dom('[data-test-output="appointments"]').hasText('2022-05-01 2021-05-30');
  });

});

function testString(label: string) {
  return class TestString extends Card {
    static [primitive]: string;
    static embedded = class Embedded extends Component<typeof this> {
      <template><em data-test={{label}}>{{@model}}</em></template>
    }
  }
}
