import { module, test, skip } from 'qunit';
import { CardInspector } from 'runtime-spike/lib/schema-util';

module('Unit | schema-util', function (hooks) {
  let inspector: CardInspector;
  hooks.before(function () {
    inspector = new CardInspector({
      async resolveModule(specifier: string) {
        if (specifier === 'fake-test-module') {
          return { default: 'hello' };
        }
        return (window as any).RUNTIME_SPIKE_EXTERNALS.get(specifier);
      },
    });
  });

  test('ignores classes that are not cards', async function (assert) {
    let src = `
      import NotACard from 'fake-test-module';
      class A extends NotACard {};
      class HasNoSuperClass {};
      let X = window.getMyClass();
      class Y extends X {};
      class Z extends window.getMyClass() {};
    `;
    let definitions = await inspector.inspectCards(src);
    assert.strictEqual(definitions.cards.length, 0, 'found no cards');
  });

  test('identifies card that extends an imported card', async function (assert) {
    let src = `
      import { Card as C } from 'runtime-spike/lib/card-api';
      class Person extends C {}
    `;

    let definitions = await inspector.inspectCards(src);
    assert.strictEqual(definitions.cards.length, 1, 'found Person card');
  });

  test('identifies card that extends a default imported card', async function (assert) {
    let src = `
      import StringCard from 'runtime-spike/lib/string';
      class Person extends StringCard {}
    `;

    let definitions = await inspector.inspectCards(src);
    assert.strictEqual(definitions.cards.length, 1, 'found Person card');
  });

  test('identifies card that extends an internal card', async function (assert) {
    let src = `
      import { Card } from 'runtime-spike/lib/card-api';
      class Person extends Card {}
      class Employee extends Person {}
      class EmployeeOfTheMonth extends Employee {}
    `;

    let definitions = await inspector.inspectCards(src);
    assert.strictEqual(definitions.cards.length, 3, 'found all cards');
  });

  test('ignores fields that are not cards', async function (assert) {
    let src = `
      import { contains, field, Card } from 'runtime-spike/lib/card-api';
      import NotACard from 'fake-test-module';
      import StringCard from 'runtime-spike/lib/string';

      function notAField() {}

      class Person extends Card {
        @field field1 = contains(NotACard);
        @field field2 = StringCard
        field3 = StringCard;
        field4 = contains(StringCard);
        field5 = function() {};
        @notAField field6 = contains(StringCard);
        @field field7 = notAField(StringCard);
      }
    `;

    let [definition] = (await inspector.inspectCards(src)).cards;
    assert.strictEqual(definition.fields.length, 0, 'no fields were found');
  });

  skip('ignores field on non-cards', async function (assert) {
    let src = `
      import { contains, field } from 'runtime-spike/lib/card-api';
      import StringCard from 'runtime-spike/lib/string';

      class Person {
        @field field1 = contains(StringCard);
      }
    `;

    let [definition] = (await inspector.inspectCards(src)).cards;
    assert.strictEqual(definition.fields.length, 0, 'no fields were found');
  });

  test('identifies a contained field that uses an external card reference', async function (assert) {
    let src = `
      import { contains, field, Card } from 'runtime-spike/lib/card-api';
      import StringCard from 'runtime-spike/lib/string';
      class Person extends Card {
        @field firstName = contains(StringCard);
      }
    `;

    let [definition] = (await inspector.inspectCards(src)).cards;
    let field = definition.getField('firstName');
    assert.strictEqual(field?.card.type, 'external');
    if (field?.card.type === 'external') {
      assert.strictEqual(field.card.module, 'runtime-spike/lib/string');
      assert.strictEqual(field.card.name, 'default');
      assert.strictEqual(field.type, 'contains');
    }
  });

  test('identifies a containsMany field that uses an external card reference', async function (assert) {
    let src = `
      import { containsMany, field, Card } from 'runtime-spike/lib/card-api';
      import StringCard from 'runtime-spike/lib/string';
      class Person extends Card {
        @field nicknames = containsMany(StringCard);
      }
    `;

    let [definition] = (await inspector.inspectCards(src)).cards;
    assert.strictEqual(definition.getField('nicknames')?.type, 'contains-many');
  });

  test('identifies a field that uses an internal card reference', async function (assert) {
    let src = `
      import { contains, field, Card } from 'runtime-spike/lib/card-api';
      import StringCard from 'runtime-spike/lib/string';
      class SpecialString extends StringCard {};
      class VerySpecialString extends SpecialString {};
      class Person extends Card {
        @field firstName = contains(VerySpecialString);
      }
    `;

    let definitions = (await inspector.inspectCards(src)).cards;
    let [, , definition] = definitions; // our card under test is the 3rd card in the module
    let field = definition.getField('firstName');
    assert.strictEqual(field?.card.type, 'internal');
    if (field?.card.type === 'internal') {
      assert.strictEqual(
        definitions[field.card.classIndex].localName,
        'VerySpecialString'
      );
      assert.strictEqual(field.type, 'contains');
    }
  });

  test('identifies fields for multiple cards in the module', async function (assert) {
    let src = `
      import { contains, field, Card } from 'runtime-spike/lib/card-api';
      import StringCard from 'runtime-spike/lib/string';
      class Person extends Card {
        @field firstName = contains(StringCard);
      }
      class Post extends Card {
        @field author = contains(Person);
        @field title = contains(StringCard);
      }
    `;

    let definitions = (await inspector.inspectCards(src)).cards;
    let [person, post] = definitions;
    {
      let { fields } = person;
      assert.strictEqual(
        fields.length,
        1,
        'the correct number of fields were found'
      );
      let [[fieldName, field]] = fields;
      assert.strictEqual(field?.card.type, 'external');
      assert.strictEqual(fieldName, 'firstName');
    }
    {
      let { fields } = post;
      assert.strictEqual(
        fields.length,
        2,
        'the correct number of fields were found'
      );
      let [[author, authorField], [title, titleField]] = fields;
      assert.strictEqual(author, 'author');
      assert.strictEqual(title, 'title');
      assert.strictEqual(titleField?.card.type, 'external');
      assert.strictEqual(authorField?.card.type, 'internal');
      if (authorField?.card.type === 'internal') {
        assert.strictEqual(
          definitions[authorField.card.classIndex].localName,
          'Person'
        );
      }
    }
  });

  test('successfully parses first-class template syntax', async function (assert) {
    let src = `
      import { contains, field, Card, Component } from 'runtime-spike/lib/card-api';
      import StringCard from 'runtime-spike/lib/string';

      class Person extends Card {
        @field firstName = contains(StringCard);

        static isolated = class Isolated extends Component<typeof this> { 
          <template><div class="hi"><@fields.firstName /></div></template>
        }
      }
    `;

    let definitions = await inspector.inspectCards(src);
    assert.strictEqual(definitions.cards.length, 1, 'found Person card');
  });

  skip('identifies a computed field that is defined by an inline function', async function (_assert) {});
  skip('identifies a computed field that is defined by the name of a class method', async function (_assert) {});
});
