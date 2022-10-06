import { module, test, skip } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import waitUntil from '@ember/test-helpers/wait-until';
import { renderCard } from '../../helpers/render-component';
import { cleanWhiteSpace, p, testRealmURL, shimModule } from '../../helpers';
import parseISO from 'date-fns/parseISO';
import { on } from '@ember/modifier';
import { baseRealm, } from "@cardstack/runtime-common";
import { Loader } from '@cardstack/runtime-common/loader';
import type { ExportedCardRef, } from "@cardstack/runtime-common";
import type { SignatureFor, primitive as primitiveType, queryableValue as queryableValueType } from "https://cardstack.com/base/card-api";
import { shadowQuerySelector, shadowQuerySelectorAll, fillIn, click } from '../../helpers/shadow-assert';

let cardApi: typeof import("https://cardstack.com/base/card-api");
let string: typeof import ("https://cardstack.com/base/string");
let integer: typeof import ("https://cardstack.com/base/integer");
let date: typeof import ("https://cardstack.com/base/date");
let datetime: typeof import ("https://cardstack.com/base/datetime");
let boolean: typeof import ("https://cardstack.com/base/boolean");
let cardRef: typeof import ("https://cardstack.com/base/card-ref");
let catalogEntry: typeof import ("https://cardstack.com/base/catalog-entry");
let pickModule: typeof import ("https://cardstack.com/base/pick");
let primitive: typeof primitiveType;
let queryableValue: typeof queryableValueType;

module('Integration | card-basics', function (hooks) {
  setupRenderingTest(hooks);

  hooks.before(async function () {
    Loader.destroy();
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    cardApi = await Loader.import(`${baseRealm.url}card-api`);
    primitive = cardApi.primitive;
    queryableValue = cardApi.queryableValue;
    string = await Loader.import(`${baseRealm.url}string`);
    integer = await Loader.import(`${baseRealm.url}integer`);
    date = await Loader.import(`${baseRealm.url}date`);
    datetime = await Loader.import(`${baseRealm.url}datetime`);
    boolean = await Loader.import(`${baseRealm.url}boolean`);
    cardRef = await Loader.import(`${baseRealm.url}card-ref`);
    catalogEntry = await Loader.import(`${baseRealm.url}catalog-entry`);
    pickModule = await Loader.import(`${baseRealm.url}pick`);
  });

  test('primitive field type checking', async function (assert) {
    let { field, contains, containsMany, Card, Component } = cardApi;
    let { default: StringCard } = string;
    let { default: IntegerCard } = integer;
    let { default: BooleanCard } = boolean;
    let { default: CardRefCard } = cardRef;
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field title = contains(StringCard);
      @field number = contains(IntegerCard);
      @field languagesSpoken = containsMany(StringCard);
      @field ref = contains(CardRefCard);
      @field boolean = contains(BooleanCard);

      static isolated = class Isolated extends Component<typeof this> {
        <template>
          {{@model.firstName}}
          {{@model.title}}
          {{@model.number}}
          {{@model.ref.module}}
          {{@model.ref.name}}
          {{@model.boolean}}
          {{#each @model.languagesSpoken as |language|}}
            {{language}}
          {{/each}}
        </template>
      }
    }
    let card = new Person();
    card.firstName = 'arthur';
    card.number = 42;
    card.boolean = true;
    card.languagesSpoken = ['english', 'japanese'];
    card.ref = { module: `${testRealmURL}person`, name: "Person" };
    let readName: string = card.firstName;
    assert.strictEqual(readName, 'arthur');
    let readNumber: number = card.number;
    assert.strictEqual(readNumber, 42);
    let readLanguages: string[] = card.languagesSpoken;
    assert.deepEqual(readLanguages, ['english', 'japanese']);
    let readRef: ExportedCardRef = card.ref;
    assert.deepEqual(readRef, { module: `${testRealmURL}person`, name: "Person" });
    let readBoolean: boolean = card.boolean;
    assert.deepEqual(readBoolean, true);
  });

  test('access @model for primitive and composite fields', async function (assert) {
    let {field, contains, containsMany, Card, Component, createFromSerialized } = cardApi;
    let { default: StringCard} = string;
    let { default: IntegerCard} = integer;
    let { default: BooleanCard } = boolean;
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field subscribers = contains(IntegerCard);
      @field languagesSpoken = containsMany(StringCard);
      @field isCool = contains(BooleanCard);
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
          is cool {{@model.author.isCool}}
        </template>
      }
    }
    await shimModule(`${testRealmURL}test-cards`, { Post, Person });

    let helloWorld = await createFromSerialized(Post, {
      attributes: {
        title: 'First Post',
        author: {
          firstName: 'Arthur',
          subscribers: 5,
          isCool: true,
          languagesSpoken: ['english', 'japanese']
        },
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'Post'
        }
      }
    });

    let cardRoot = await renderCard(helloWorld, 'isolated');
    assert.strictEqual(cleanWhiteSpace(cardRoot.textContent!), 'First Post by Arthur speaks english japanese 5 subscribers is cool true');
  });

  test('render primitive field', async function (assert) {
    let {field, contains, Card, Component } = cardApi;
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
        <template><div><@fields.firstName /><@fields.number /></div></template>
      }
    }

    let arthur = new Person({ firstName: 'Arthur', number: 10 });

    await renderCard(arthur, 'embedded');
    assert.shadowDOM('[data-test="name"]').containsText('Arthur');
    assert.shadowDOM('[data-test="integer"]').containsText('10');
  });

  test('can set the ID for an unsaved card', async function(assert) {
    let { field, contains, Card } = cardApi;
    let { default: StringCard} = string;
    
    class Person extends Card {
      @field firstName = contains(StringCard);
    }

    let mango = new Person();
    mango.id = `${testRealmURL}Person/mango`;
    assert.strictEqual(mango.id, `${testRealmURL}Person/mango`);

    let vanGogh = new Person({id: `${testRealmURL}Person/vanGogh`})
    assert.strictEqual(vanGogh.id, `${testRealmURL}Person/vanGogh`);
  });

  test('throws when setting the ID for a saved card', async function (assert) {
    let { field, contains, Card, createFromSerialized } = cardApi;
    let { default: StringCard} = string;

    class Person extends Card {
      @field firstName = contains(StringCard);
    }
    await shimModule(`${testRealmURL}test-cards`, { Person });

    // deserialize a card with an ID to mark it as "saved"
    let savedCard = await createFromSerialized({
      id: `${testRealmURL}Person/mango`,
      attributes: {
        firstName: 'Mango'
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'Person'
        }
      }
    }, undefined);

    try {
      savedCard.id = 'boom';
      throw new Error(`expected exception not thrown`);
    } catch (err: any) {
      assert.ok(err.message.match(/cannot assign a value to the field 'id' on the saved card/), 'exception thrown when setting ID of saved card');
    }
  });

  test('render cardRef field', async function (assert) {
    let {field, contains, Card, Component } = cardApi;
    let { default: CardRefCard } = cardRef;
    class DriverCard extends Card {
      @field ref = contains(CardRefCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><div data-test-ref><@fields.ref/></div></template>
      }
    }

    let ref = { module: `http://localhost:4201/test/person`, name: 'Person' };
    let driver = new DriverCard({ ref });

    await renderCard(driver, 'embedded');
    assert.shadowDOM('[data-test-ref]').containsText(`Module: http://localhost:4201/test/person Name: Person`);

    // is this worth an assertion? or is it just obvious?
    assert.strictEqual(driver.ref, ref, 'The deserialized card ref constructor param is strict equal to the deserialized card ref value');
  });

  test('render cardRef fields are not editable', async function (assert) {
    let {field, contains, Card, Component } = cardApi;
    let { default: CardRefCard } = cardRef;
    class DriverCard extends Card {
      @field ref = contains(CardRefCard);
      static edit = class Edit extends Component<typeof this> {
        <template><div data-test-ref><@fields.ref/></div></template>
      }
    }

    let ref = { module: `http://localhost:4201/test/person`, name: 'Person' };
    let driver = new DriverCard({ ref });

    await renderCard(driver, 'edit');
    assert.shadowDOM('input').doesNotExist('no input fields exist');
    assert.shadowDOM('[data-test-ref').containsText(`Module: http://localhost:4201/test/person Name: Person`);
  });

  test('catalog entry isPrimitive indicates if the catalog entry is a primitive field card', async function (assert) {
    let { createFromSerialized } = cardApi;
    let { CatalogEntry } = catalogEntry;

    let nonPrimitiveEntry = await createFromSerialized<typeof CatalogEntry>({
      attributes: {
        title: "CatalogEntry Card",
        ref: {
          module: "https://cardstack.com/base/catalog-entry",
          name: "CatalogEntry"
        }
      },
      meta: {
        adoptsFrom: {
          module: `${baseRealm.url}catalog-entry`,
          name: 'CatalogEntry'
        }
      }
    }, undefined);
    let primitiveEntry = await createFromSerialized<typeof CatalogEntry>({
      attributes: {
        title: "String Card",
        ref: {
          module: "https://cardstack.com/base/string",
          name: "default"
        }
      },
      meta: {
        adoptsFrom: {
          module: `${baseRealm.url}catalog-entry`,
          name: 'CatalogEntry'
        }
      }
    }, undefined);

    await cardApi.recompute(nonPrimitiveEntry);
    await cardApi.recompute(primitiveEntry);

    assert.strictEqual(nonPrimitiveEntry.isPrimitive, false, 'isPrimitive is correct');
    assert.strictEqual(primitiveEntry.isPrimitive, true, 'isPrimitive is correct');
  });

  test('render whole composite field', async function (assert) {
    let {field, contains, Card, Component, createFromSerialized } = cardApi;
    let { default: StringCard} = string;
    let { default: IntegerCard} = integer;
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field title = contains(StringCard);
      @field number = contains(IntegerCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><div data-test-embedded-person><@fields.title/> <@fields.firstName /> <@fields.number /></div></template>
      }
    }

    class Post extends Card {
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template><div data-test><@fields.author /></div></template>
      }
    }
    await shimModule(`${testRealmURL}test-cards`, { Post, Person });

    let helloWorld = await createFromSerialized({
      attributes: {
        author: {
          firstName: 'Arthur',
          title: 'Mr',
          number: 10
        }
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'Post'
        }
      }
    }, undefined);
    await renderCard(helloWorld, 'isolated');
    assert.shadowDOM('[data-test-embedded-person]').containsText('Mr Arthur 10');
  });

  // this will apply to linksTo, but doesn't apply to contains
  skip('render a field that is the enclosing card', async function(assert) {
    let {field, contains,  Card, Component, createFromSerialized } = cardApi;
    let { default: StringCard} = string;
    class Person extends Card {
      @field firstName = contains(StringCard);
      // @field friend = contains(() => Person); // a thunk can be used to specify a circular reference
      // static isolated = class Isolated extends Component<typeof this> {
      //   <template><@fields.firstName/> friend is <@fields.friend/></template>
      // }
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName/></template>
      }
    }
    await shimModule(`${testRealmURL}test-cards`, { Person });

    let mango = await createFromSerialized({
      attributes: {
        firstName: 'Mango',
        friend: {
          firstName: 'Van Gogh'
        }
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'Person'
        }
      }
    }, undefined);
    await renderCard(mango, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'Mango friend is Van Gogh');
  });

  test('render nested composite field', async function (assert) {
    let {field, contains, Card, Component, createFromSerialized } = cardApi;
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
      <template><div><@fields.author.firstName /><@fields.author.number /></div></template>
      }
    }
    await shimModule(`${testRealmURL}test-cards`, { Post, Person, TestInteger, TestString });

    let helloWorld = await createFromSerialized({
      attributes: {
        author: {
          firstName: 'Arthur',
          number: 10
        }
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'Post'
        }
      }
    }, undefined);

    await renderCard(helloWorld, 'isolated');
    assert.shadowDOM('[data-test="string"]').containsText('Arthur');
    assert.shadowDOM('[data-test="integer"]').containsText('10');
  });

  test('render default isolated template', async function (assert) {
    let {field, contains, Card, Component, createFromSerialized } = cardApi;
    let firstName = await testString('first-name');
    class Person extends Card {
      @field firstName = contains(firstName);

      static embedded = class Embedded extends Component<typeof this> {
        <template><span><@fields.firstName /></span></template>
      }
    }

    let title = await testString('title');
    class Post extends Card{
      @field title = contains(title);
      @field author = contains(Person);
    }
    await shimModule(`${testRealmURL}test-cards`, { Post, Person });

    let helloWorld = await createFromSerialized({
      attributes: {
        title: 'First Post',
        author: {
          firstName: 'Arthur'
        }
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'Post'
        }
      }
    }, undefined);

    await renderCard(helloWorld, 'isolated');
    assert.shadowDOM('[data-test="first-name"]').containsText('Arthur');
    assert.shadowDOM('[data-test="title"]').containsText('First Post');
  });

  test('render a containsMany primitive field', async function (assert) {
    let {field, contains, containsMany, Card, Component } = cardApi;
    let { default: StringCard} = string;
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

    let root = await renderCard(mango, 'isolated');
    assert.strictEqual(cleanWhiteSpace(root.textContent!), 'Mango speaks english japanese');
  });

  test('supports an empty containsMany primitive field', async function (assert) {
    let {field, contains, containsMany, Card, Component } = cardApi;
    let { default: StringCard} = string;
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
    let {field, contains, containsMany, Card, Component, createFromSerialized } = cardApi;
    let { default: StringCard} = string;
    class Person extends Card {
      @field firstName = contains(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><div data-test-person-firstName><@fields.firstName/></div></template>
      }
    }

    class Family extends Card {
      @field people = containsMany(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template><div><@fields.people/></div></template>
      }
    }
    await shimModule(`${testRealmURL}test-cards`, { Family, Person });

    let abdelRahmans = await createFromSerialized({
      attributes: {
        people: [
          { firstName: 'Mango'},
          { firstName: 'Van Gogh'},
          { firstName: 'Hassan'},
          { firstName: 'Mariko'},
          { firstName: 'Yume'},
          { firstName: 'Sakura'},
        ]
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'Family'
        }
      }
    }, undefined);

    await renderCard(abdelRahmans, 'isolated');
    assert.deepEqual(
      shadowQuerySelectorAll('[data-test-person-firstName]', this.element).map(element => element.textContent?.trim()),
      ['Mango',  'Van Gogh', 'Hassan', 'Mariko',  'Yume',  'Sakura']
    );
  });

  test('rerender when a primitive field changes', async function(assert) {
    let {field, contains, Card, Component } = cardApi;
    let { default: StringCard} = string;
    class Person extends Card {
      @field firstName = contains(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><div data-test="firstName"><@fields.firstName/></div></template>
      }
    }
    let child = new Person({ firstName: 'Arthur' });
    let root = await renderCard(child, 'embedded');
    assert.dom(root.children[0]).containsText('Arthur');
    child.firstName = 'Quint';
    await waitUntil(() => cleanWhiteSpace(root.textContent!) === 'Quint');
  });


  test('rerender when a containsMany field is fully replaced', async function(assert) {
    let {field, containsMany, Card, Component } = cardApi;
    let { default: StringCard} = string;
    class Person extends Card {
      @field pets = containsMany(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.pets/></template>
      }
    }
    let person = new Person({ pets: ['Mango', 'Van Gogh'] });
    let root = await renderCard(person, 'embedded');
    assert.strictEqual(cleanWhiteSpace(root.textContent!), 'Mango Van Gogh');
    person.pets = ['Van Gogh', 'Mango', 'Peachy'];
    await waitUntil(() => cleanWhiteSpace(root.textContent!) === 'Van Gogh Mango Peachy');
  });

  test('rerender when a containsMany field is mutated via assignment', async function(assert) {
    let {field, containsMany, Card, Component } = cardApi;
    let { default: StringCard} = string;
    class Person extends Card {
      @field pets = containsMany(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.pets/></template>
      }
    }
    let person = new Person({ pets: ['Mango', 'Van Gogh'] });
    let root = await renderCard(person, 'embedded');
    assert.strictEqual(cleanWhiteSpace(root.textContent!), 'Mango Van Gogh');
    person.pets[1] = 'Peachy';
    await waitUntil(() => cleanWhiteSpace(root.textContent!) === 'Mango Peachy');
  });


  test('rerender when a containsMany field changes size', async function(assert) {
    let {field, containsMany, Card, Component } = cardApi;
    let { default: StringCard} = string;
    class Person extends Card {
      @field pets = containsMany(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.pets/></template>
      }
    }
    let person = new Person({ pets: ['Mango', 'Van Gogh'] });
    let root = await renderCard(person, 'embedded');
    assert.strictEqual(cleanWhiteSpace(root.textContent!), 'Mango Van Gogh');
    person.pets.push('Peachy');
    await waitUntil(() => cleanWhiteSpace(root.textContent!) === 'Mango Van Gogh Peachy');
    person.pets.shift();
    await waitUntil(() => cleanWhiteSpace(root.textContent!) === 'Van Gogh Peachy');
  });

  test('supports an empty containsMany composite field', async function (assert) {
    let {field, contains, containsMany, Card, Component } = cardApi;
    let { default: StringCard} = string;
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
    let {field, contains, containsMany, Card, createFromSerialized } = cardApi;
    let { default: StringCard} = string;
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field languagesSpoken = containsMany(StringCard);
    }
    await shimModule(`${testRealmURL}test-cards`, { Person });
    assert.throws(() => new Person({ languagesSpoken: 'english' }), /Expected array for field value languagesSpoken/);
    try {
      await createFromSerialized({
        attributes: {
          languagesSpoken: 'english'
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Person'
          }
        }
      }, undefined);
      throw new Error(`expected exception to be thrown`);
    } catch (err: any) {
      assert.ok(err.message.match(/Expected array for field value languagesSpoken/), 'expected error received')
    }
  });

  test('render default edit template', async function (assert) {
    let {field, contains, Card, createFromSerialized } = cardApi;
    let { default: StringCard} = string;
    class Person extends Card {
      @field firstName = contains(StringCard);
    }

    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person);
    }
    await shimModule(`${testRealmURL}test-cards`, { Post, Person });

    let helloWorld = await createFromSerialized({
      attributes: {
        title: 'My Post',
        author: { firstName: 'Arthur' }
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'Post'
        }
      }
    }, undefined);

    await renderCard(helloWorld, 'edit');
    assert.shadowDOM('[data-test-field="title"]').hasText('Title');
    assert.shadowDOM('[data-test-field="title"] input').hasValue('My Post');
    assert.shadowDOM('[data-test-field="author"] [data-test-field="firstName"]').hasText('First Name');
    assert.shadowDOM('[data-test-field="author"] input').hasValue('Arthur');

    await fillIn('[data-test-field="title"] input', 'New Post');
    await fillIn('[data-test-field="firstName"] input', 'Carl Stack');

    assert.shadowDOM('[data-test-field="title"] input').hasValue('New Post');
    assert.shadowDOM('[data-test-field="author"] input').hasValue('Carl Stack');
  });

  test('renders field name for boolean default view values', async function (assert) {
    let {field, contains, Card, createFromSerialized } = cardApi;
    let { default: StringCard} = string;
    let { default: BooleanCard } = boolean;

    class Person extends Card {
      @field firstName = contains(StringCard);
      @field isCool = contains(BooleanCard);
    }
    await shimModule(`${testRealmURL}test-cards`, { Person });

    let mango = await createFromSerialized({
      attributes: {
        firstName: 'Mango',
        isCool: true
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'Person'
        }
      }
    }, undefined);
    let root = await renderCard(mango, 'isolated');
    assert.strictEqual(cleanWhiteSpace(root.textContent!), 'Mango isCool: true');
  });

  test('renders boolean edit view', async function(assert) {
    let {field, contains, Card, createFromSerialized } = cardApi;
    let { default: StringCard} = string;
    let { default: BooleanCard } = boolean;

    class Person extends Card {
      @field firstName = contains(StringCard);
      @field isCool = contains(BooleanCard);
      @field isHuman = contains(BooleanCard);
    }
    await shimModule(`${testRealmURL}test-cards`, { Person });
    let mango = await createFromSerialized<typeof Person>({
      attributes: {
        firstName: 'Mango',
        isCool: true,
        isHuman: false
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'Person'
        }
      }
    }, undefined);

    const TRUE = 0;
    const FALSE = 1;
    await renderCard(mango, 'edit');
    let isCoolRadios: HTMLInputElement[] = [...shadowQuerySelector('[data-test-field="isCool"]').children].map(el => el.children[0] as HTMLInputElement);
    let isHumanRadios: HTMLInputElement[] = [...shadowQuerySelector('[data-test-field="isHuman"]').children].map(el => el.children[0] as HTMLInputElement);
    assert.strictEqual(isCoolRadios[TRUE].checked, true, 'the isCool true radio has correct state');
    assert.strictEqual(isCoolRadios[FALSE].checked, false, 'the isCool false radio has correct state');
    assert.strictEqual(isHumanRadios[TRUE].checked, false, 'the isHuman true radio has correct state');
    assert.strictEqual(isHumanRadios[FALSE].checked, true, 'the isHuman false radio has correct state');

    await click(isHumanRadios[TRUE]);
    // make sure radio group changes don't bleed into one another
    assert.strictEqual(isCoolRadios[TRUE].checked, true, 'the isCool true radio has correct state');
    assert.strictEqual(isCoolRadios[FALSE].checked, false, 'the isCool false radio has correct state');
    assert.strictEqual(isHumanRadios[TRUE].checked, true, 'the isHuman true radio has correct state');
    assert.strictEqual(isHumanRadios[FALSE].checked, false, 'the isHuman false radio has correct state');

    assert.strictEqual(mango.isCool, true, 'the isCool field has the correct value');
    assert.strictEqual(mango.isHuman, true, 'the isHuman field has the correct value');
  });

  test('can adopt a card', async function (assert) {
    let {field, contains,  Card, Component } = cardApi;
    let species = await testString('species');
    class Animal extends Card {
      @field species = contains(species);
    }
    let firstName = await testString('first-name');
    class Person extends Animal {
      @field firstName = contains(firstName);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName /><@fields.species/></template>
      }
    }

    let hassan = new Person ({ firstName: 'Hassan', species: 'Homo Sapiens' });

    await renderCard(hassan, 'embedded');
    assert.shadowDOM('[data-test="first-name"]').containsText('Hassan');
    assert.shadowDOM('[data-test="species"]').containsText('Homo Sapiens');
  });

  test('can edit primitive and composite fields', async function (assert) {
    let {field, contains, Card, Component, createFromSerialized } = cardApi;
    let { default: StringCard} = string;
    let { default: IntegerCard} = integer;
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
    await shimModule(`${testRealmURL}test-cards`, { Post, Person });

    let helloWorld = await createFromSerialized({
      attributes: {
        title: 'First Post',
        reviews: 1,
        author: { firstName: 'Arthur' }
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'Post'
        }
      }
    }, undefined);

    await renderCard(helloWorld, 'edit');
    assert.shadowDOM('[data-test-field="title"] input').hasValue('First Post');
    assert.shadowDOM('[data-test-field="reviews"] input').hasValue('1');
    assert.shadowDOM('[data-test-field="firstName"] input').hasValue('Arthur');

    await fillIn('[data-test-field="title"] input', 'New Title');
    await fillIn('[data-test-field="reviews"] input', '5');
    await fillIn('[data-test-field="firstName"] input', 'Carl Stack');

    assert.shadowDOM('[data-test-output="title"]').hasText('New Title');
    assert.shadowDOM('[data-test-output="reviews"]').hasText('5');
    assert.shadowDOM('[data-test-output="author.firstName"]').hasText('Carl Stack');
  });

  test('component stability when editing containsMany primitive field', async function(assert) {
    let {field, containsMany, Card, Component } = cardApi;
    let { default: StringCard } = string;
    let { pick } = pickModule;
    let counter = 0;
    class TestString extends StringCard {
      static edit = class Edit extends Component<typeof this> {
        private counter: number;
        constructor(owner: unknown, args: SignatureFor<typeof TestString>["Args"]) {
          super(owner, args);
          this.counter = counter++;
        }
        <template>
          <input data-counter={{this.counter}} type="text" value={{@model}} {{on "input" (pick "target.value" @set) }} />
        </template>
      }
    }

    class Person extends Card {
      @field languagesSpoken = containsMany(TestString);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <@fields.languagesSpoken />
        </template>
      }
    }

    let card = new Person({
      languagesSpoken: ['english', "japanese"],
    });

    await renderCard(card, 'edit');
    assert.shadowDOM('[data-test-item="0"] [data-counter]').hasAttribute('data-counter', '0');
    assert.shadowDOM('[data-test-item="1"] [data-counter]').hasAttribute('data-counter', '1');
    await fillIn('[data-test-item="0"] [data-counter]', 'italian');
    assert.shadowDOM('[data-test-item="0"] [data-counter]').hasAttribute('data-counter', '0');
    assert.shadowDOM('[data-test-item="1"] [data-counter]').hasAttribute('data-counter', '1');
  });

  test('add, remove and edit items in containsMany string field', async function (assert) {
    let {field, containsMany, Card, Component } = cardApi;
    let { default: StringCard} = string;
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

    let card = new Person();

    await renderCard(card, 'edit');
    assert.shadowDOM('[data-test-item]').doesNotExist();

    // add english
    await click('[data-test-add-new]');
    await fillIn('[data-test-item="0"] input', 'english');
    assert.shadowDOM('[data-test-item]').exists({ count: 1 });
    assert.shadowDOM('[data-test-output]').hasText('english');

    // add japanese
    await click('[data-test-add-new]');
    await fillIn('[data-test-item="1"] input', 'japanese');
    assert.shadowDOM('[data-test-item]').exists({ count: 2 });
    assert.shadowDOM('[data-test-output]').hasText('english japanese');

    // change japanese to italian
    await fillIn('[data-test-item="1"] input', 'italian');
    assert.shadowDOM('[data-test-output]').hasText('english italian');

    // remove english
    await click('[data-test-remove="0"]');
    assert.shadowDOM('[data-test-item]').exists({ count: 1 });
    assert.shadowDOM('[data-test-output]').hasText('italian');
  });

  test('add, remove and edit items in containsMany composite field', async function (assert) {
    let {field, containsMany, contains, Card, Component } = cardApi;
    let { default: StringCard} = string;
    class Post extends Card {
      @field title = contains(StringCard);
    }

    class Blog extends Card {
      @field posts = containsMany(Post);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <@fields.posts />
          <ul data-test-output>
            {{#each @model.posts as |post|}}
              <li>{{post.title}}</li>
            {{/each}}
          </ul>
        </template>
      }
    }

    let card = new Blog();

    await renderCard(card, 'edit');
    assert.shadowDOM('[data-test-item]').doesNotExist();
    
    await click('[data-test-add-new]');
    await fillIn('[data-test-field="title"] input', "Tail Wagging Basics");
    assert.shadowDOM('[data-test-item]').exists({ count: 1 });
    assert.shadowDOM('[data-test-output]').hasText('Tail Wagging Basics');

    await click('[data-test-add-new]');
    assert.shadowDOM('[data-test-item]').exists({ count: 2 });

    await click('[data-test-remove="0"]');
    assert.shadowDOM('[data-test-item]').exists({ count: 1 });
    assert.shadowDOM('[data-test-output]').hasText('');

    await fillIn('[data-test-field="title"] input', "Begging for Beginners");
    assert.shadowDOM('[data-test-item]').exists({ count: 1 });
    assert.shadowDOM('[data-test-output]').hasText('Begging for Beginners');
  });

  test('add, remove and edit items in containsMany date and datetime fields', async function (assert) {
    let {field, containsMany, Card, Component } = cardApi;
    let { default: DateCard} = date;
    let { default: DatetimeCard} = datetime;
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
      appointments: [parseISO('2022-05-13T13:00'), parseISO('2021-05-30T10:45')],
    });

    await renderCard(card, 'edit');
    assert.shadowDOM('[data-test-contains-many="dates"] [data-test-item]').exists({ count: 3 });
    assert.shadowDOM('[data-test-contains-many="dates"] [data-test-item="0"] input').hasValue('2022-05-12');
    assert.shadowDOM('[data-test-output="dates"]').hasText('2022-05-12 2022-05-11 2021-05-13');

    await click('[data-test-contains-many="dates"] [data-test-add-new]');
    await fillIn('[data-test-contains-many="dates"] [data-test-item="3"] input', '2022-06-01');
    assert.shadowDOM('[data-test-contains-many="dates"] [data-test-item]').exists({ count: 4 });
    assert.shadowDOM('[data-test-output="dates"]').hasText('2022-05-12 2022-05-11 2021-05-13 2022-06-01');

    await click('[data-test-contains-many="dates"] [data-test-remove="1"]');
    await click('[data-test-contains-many="dates"] [data-test-remove="2"]'); // note: after removing index=1, the previous indexes of the following items have shifted by 1
    assert.shadowDOM('[data-test-contains-many="dates"] [data-test-item]').exists({ count: 2 });
    assert.shadowDOM('[data-test-output="dates"]').hasText('2022-05-12 2021-05-13');

    await fillIn('[data-test-contains-many="dates"] [data-test-item="1"] input', '2022-04-10');
    assert.shadowDOM('[data-test-output]').hasText('2022-05-12 2022-04-10');

    assert.shadowDOM('[data-test-contains-many="appointments"] [data-test-item]').exists({ count: 2 });
    assert.strictEqual(getDateFromInput('[data-test-contains-many="appointments"] [data-test-item="0"] input')?.getTime(), parseISO('2022-05-13T13:00').getTime());
    assert.shadowDOM('[data-test-output="appointments"]').hasText('2022-05-13 2021-05-30');

    await fillIn('[data-test-contains-many="appointments"] [data-test-item="0"] input', '2022-05-01T11:01');
    assert.shadowDOM('[data-test-output="appointments"]').hasText('2022-05-01 2021-05-30');
  });

  test('can get a queryable value for a field', async function(assert) {
    let { Card, getQueryableValue } = cardApi;

    class TestField extends Card {
      static [primitive]: TestShape;
      static [queryableValue](value: TestShape) {
        return value.firstName;
      }
    }

    assert.strictEqual(getQueryableValue(TestField, { firstName: 'Van Gogh', age: 6}), 'Van Gogh', 'The queryable value from user supplied data is correct (string)')
    assert.strictEqual(getQueryableValue(TestField, { firstName: 1, age: 6}), 1, 'The queryable value from user supplied data is correct (number)')
    assert.strictEqual(getQueryableValue(TestField, { firstName: true, age: 6}), true, 'The queryable value from user supplied data is correct (boolean)')
    assert.strictEqual(getQueryableValue(TestField, { firstName: undefined, age: 6}), undefined, 'The queryable value from user supplied data is correct (undefined)')
    assert.strictEqual(getQueryableValue(TestField, { firstName: null, age: 6}), null, 'The queryable value from user supplied data is correct (null)')
    assert.deepEqual(getQueryableValue(TestField, { firstName: ['a'], age: 6}), ['a'], 'The queryable value from user supplied data is correct (string[])')
    assert.deepEqual(getQueryableValue(TestField, { firstName: [1], age: 6}), [1], 'The queryable value from user supplied data is correct (number[])')
    assert.deepEqual(getQueryableValue(TestField, { firstName: [true], age: 6}), [true], 'The queryable value from user supplied data is correct (boolean[])')
    assert.deepEqual(getQueryableValue(TestField, { firstName: [null], age: 6}), [null], 'The queryable value from user supplied data is correct (null[])')
    assert.deepEqual(getQueryableValue(TestField, { firstName: [undefined], age: 6}), [undefined], 'The queryable value from user supplied data is correct (undefined[])')
  });

  test('queryable value for a field defaults to current field value when not specified', async function (assert) {
    let { Card, getQueryableValue } = cardApi;
    class StringCard extends Card {
      static [primitive]: string;
    }

    assert.strictEqual(getQueryableValue(StringCard, 'Van Gogh'), 'Van Gogh', 'The queryable value from user supplied data is correct')
  });

  test('throws when card returns non-scalar queryable value from "queryableValue" function', async function (assert) {
    let { Card, getQueryableValue } = cardApi;

    class TestField1 extends Card {
      static [primitive]: TestShape;
      static [queryableValue](_value: TestShape) {
        return { notAScalar: true };
      }
    }
    assert.throws(() => getQueryableValue(TestField1, { firstName: 'Mango', lastName: 'Abdel-Rahman'}), /expected queryableValue for field type TestField1 to be scalar/);

    class TestField2 extends Card {
      static [primitive]: TestShape;
      static [queryableValue](_value: TestShape) {
        return [{ notAScalar: true }];
      }
    }
    assert.throws(() => getQueryableValue(TestField2, { firstName: 'Mango', lastName: 'Abdel-Rahman'}), /expected queryableValue for field type TestField2 to be scalar/);
  })

  test('throws when card returns non-scalar queryable value when there is no "queryableValue" function', async function (assert) {
    let { Card, getQueryableValue } = cardApi;

    class TestField extends Card {
      static [primitive]: TestShape;
    }
    assert.throws(() => getQueryableValue(TestField, { firstName: 'Mango', lastName: 'Abdel-Rahman'}), /expected queryableValue for field type TestField to be scalar/);
  })
});

async function testString(label: string) {
  cardApi = await Loader.import(`${baseRealm.url}card-api`);
  let {Card, Component } = cardApi;
  return class TestString extends Card {
    static [primitive]: string;
    static embedded = class Embedded extends Component<typeof this> {
      <template><em data-test={{label}}>{{@model}}</em></template>
    }
  }
}

function getDateFromInput(selector: string): Date | undefined {
  let input = shadowQuerySelector(selector) as HTMLInputElement | undefined ;
  if (input?.value) {
    return parseISO(input.value);
  }
  return undefined;
}

interface TestShape {
  firstName: string;
  age: number
}
