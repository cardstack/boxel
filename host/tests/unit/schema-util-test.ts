import { module, test } from 'qunit';
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
});
