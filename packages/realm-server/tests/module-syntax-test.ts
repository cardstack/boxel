import { module, test } from 'qunit';
import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';
import { dirSync } from 'tmp';
import { Loader, baseRealm } from '@cardstack/runtime-common';
import { testRealm, createRealm } from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { shimExternals } from '../lib/externals';

module('module-syntax', function () {
  let loader = new Loader();
  loader.addURLMapping(
    new URL(baseRealm.url),
    new URL('http://localhost:4201/base/'),
  );
  shimExternals(loader);

  test('can get the code for a card', async function (assert) {
    let src = `
      import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends CardDef {
        @field firstName = contains(StringCard);
        static embedded = class Embedded extends Component<typeof this> {
          <template><h1><@fields.firstName/></h1></template>
        }
      }
    `;

    let mod = new ModuleSyntax(src);
    assert.codeEqual(mod.code(), src);
  });

  test('can add a field to a card', async function (assert) {
    let src = `
      import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends CardDef {
        @field firstName = contains(StringCard);
        static embedded = class Embedded extends Component<typeof this> {
          <template><h1><@fields.firstName/></h1></template>
        }
      }
    `;

    let mod = new ModuleSyntax(src);
    mod.addField(
      { type: 'exportedName', name: 'Person' },
      'age',
      {
        module: 'https://cardstack.com/base/number',
        name: 'default',
      },
      'contains',
    );

    assert.codeEqual(
      mod.code(),
      `
        import NumberCard from "https://cardstack.com/base/number";
        import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Person extends CardDef {
          @field firstName = contains(StringCard);
          @field age = contains(NumberCard);
          static embedded = class Embedded extends Component<typeof this> {
            <template><h1><@fields.firstName/></h1></template>
          }
        }
      `,
    );

    let card = mod.possibleCards.find((c) => c.exportedAs === 'Person');
    let field = card!.possibleFields.get('age');
    assert.ok(field, 'new field was added to syntax');
    assert.deepEqual(
      field?.card,
      {
        type: 'external',
        module: 'https://cardstack.com/base/number',
        name: 'default',
      },
      'the field card is correct',
    );
    assert.deepEqual(
      field?.type,
      {
        type: 'external',
        module: 'https://cardstack.com/base/card-api',
        name: 'contains',
      },
      'the field type is correct',
    );
    assert.deepEqual(
      field?.decorator,
      {
        type: 'external',
        module: 'https://cardstack.com/base/card-api',
        name: 'field',
      },
      'the field decorator is correct',
    );

    // add another field which will assert that the field path is correct since
    // the new field must go after this field
    mod.addField(
      { type: 'exportedName', name: 'Person' },
      'lastName',
      {
        module: 'https://cardstack.com/base/string',
        name: 'default',
      },
      'contains',
    );
    assert.codeEqual(
      mod.code(),
      `
        import NumberCard from "https://cardstack.com/base/number";
        import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Person extends CardDef {
          @field firstName = contains(StringCard);
          @field age = contains(NumberCard);
          @field lastName = contains(StringCard);
          static embedded = class Embedded extends Component<typeof this> {
            <template><h1><@fields.firstName/></h1></template>
          }
        }
      `,
    );
  });

  test("can add a field to a card that doesn't have any fields", async function (assert) {
    let src = `
        import { CardDef } from "https://cardstack.com/base/card-api";

        export class Person extends CardDef { }
      `;

    let mod = new ModuleSyntax(src);
    mod.addField(
      { type: 'exportedName', name: 'Person' },
      'firstName',
      {
        module: 'https://cardstack.com/base/string',
        name: 'default',
      },
      'contains',
    );

    assert.codeEqual(
      mod.code(),
      `
          import StringCard from "https://cardstack.com/base/string";
          import { CardDef, field, contains } from "https://cardstack.com/base/card-api";

          export class Person extends CardDef {
            @field firstName = contains(StringCard);
          }
        `,
    );
  });

  test('can add a field to a card that is not exported', async function (assert) {
    let src = `
      import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      class Person extends CardDef {
        @field firstName = contains(StringCard);
        static embedded = class Embedded extends Component<typeof this> {
          <template><h1><@fields.firstName/></h1></template>
        }
      }

      export class FancyPerson extends Person {
        @field favoriteColor = contains(StringCard);
      }
    `;

    let mod = new ModuleSyntax(src);
    mod.addField(
      { type: 'localName', name: 'Person' },
      'age',
      {
        module: 'https://cardstack.com/base/number',
        name: 'default',
      },
      'contains',
    );

    assert.codeEqual(
      mod.code(),
      `
        import NumberCard from "https://cardstack.com/base/number";
        import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        class Person extends CardDef {
          @field firstName = contains(StringCard);
          @field age = contains(NumberCard);
          static embedded = class Embedded extends Component<typeof this> {
            <template><h1><@fields.firstName/></h1></template>
          }
        }

        export class FancyPerson extends Person {
          @field favoriteColor = contains(StringCard);
        }
      `,
    );
  });

  test('can add a containsMany field', async function (assert) {
    let src = `
      import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends CardDef {
        @field firstName = contains(StringCard);
        static embedded = class Embedded extends Component<typeof this> {
          <template><h1><@fields.firstName/></h1></template>
        }
      }
    `;

    let mod = new ModuleSyntax(src);
    mod.addField(
      { type: 'exportedName', name: 'Person' },
      'aliases',
      {
        module: 'https://cardstack.com/base/string',
        name: 'default',
      },
      'containsMany',
    );

    assert.codeEqual(
      mod.code(),
      `
        import { contains, field, Component, CardDef, containsMany } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Person extends CardDef {
          @field firstName = contains(StringCard);
          @field aliases = containsMany(StringCard);
          static embedded = class Embedded extends Component<typeof this> {
            <template><h1><@fields.firstName/></h1></template>
          }
        }
      `,
    );
    let card = mod.possibleCards.find((c) => c.exportedAs === 'Person');
    let field = card!.possibleFields.get('aliases');
    assert.ok(field, 'new field was added to syntax');
    assert.deepEqual(
      field?.type,
      {
        type: 'external',
        module: 'https://cardstack.com/base/card-api',
        name: 'containsMany',
      },
      'the field type is correct',
    );
  });

  test('can add a linksTo field', async function (assert) {
    let realm = await createRealm(loader, dirSync().name, {
      'pet.gts': `
      import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";
      export class Pet extends CardDef {
        @field petName = contains(StringCard);
      }
    `,
    });
    await realm.ready;

    let src = `
      import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";
      export class Person extends CardDef {
        @field firstName = contains(StringCard);
      }
    `;
    let mod = new ModuleSyntax(src);
    mod.addField(
      { type: 'exportedName', name: 'Person' },
      'pet',
      {
        module: `${testRealm}dir/pet`,
        name: 'Pet',
      },
      'linksTo',
    );

    assert.codeEqual(
      mod.code(),
      `
        import { Pet as PetCard } from "${testRealm}dir/pet";
        import { contains, field, CardDef, linksTo } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        export class Person extends CardDef {
          @field firstName = contains(StringCard);
          @field pet = linksTo(() => PetCard);
        }
      `,
    );
    let card = mod.possibleCards.find((c) => c.exportedAs === 'Person');
    let field = card!.possibleFields.get('pet');
    assert.ok(field, 'new field was added to syntax');
    assert.deepEqual(
      field?.type,
      {
        type: 'external',
        module: 'https://cardstack.com/base/card-api',
        name: 'linksTo',
      },
      'the field type is correct',
    );
  });

  test('can add a linksTo field with the same type as its enclosing card', async function (assert) {
    let src = `
      import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends CardDef {
        @field firstName = contains(StringCard);
      }
    `;
    let mod = new ModuleSyntax(src);
    mod.addField(
      { type: 'exportedName', name: 'Person' },
      'friend',
      {
        module: `${testRealm}dir/person`,
        name: 'Person',
      },
      'linksTo',
    );

    assert.codeEqual(
      mod.code(),
      `
        import { contains, field, CardDef, linksTo } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Person extends CardDef {
          @field firstName = contains(StringCard);
          @field friend = linksTo(() => Person);
        }
      `,
    );
    let card = mod.possibleCards.find((c) => c.exportedAs === 'Person');
    let field = card!.possibleFields.get('friend');
    assert.ok(field, 'new field was added to syntax');
    assert.deepEqual(
      field?.type,
      {
        type: 'external',
        module: 'https://cardstack.com/base/card-api',
        name: 'linksTo',
      },
      'the field type is correct',
    );
  });

  test('can handle field card declaration collisions when adding field', async function (assert) {
    let src = `
      import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      const NumberCard = "don't collide with me";

      export class Person extends CardDef {
        @field firstName = contains(StringCard);
      }
    `;

    let mod = new ModuleSyntax(src);
    mod.addField(
      { type: 'exportedName', name: 'Person' },
      'age',
      {
        module: 'https://cardstack.com/base/number',
        name: 'default',
      },
      'contains',
    );

    assert.codeEqual(
      mod.code(),
      `
        import NumberCard0 from "https://cardstack.com/base/number";
        import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        const NumberCard = "don't collide with me";

        export class Person extends CardDef {
          @field firstName = contains(StringCard);
          @field age = contains(NumberCard0);
        }
      `,
    );
  });

  // At this level, we can only see this specific module. we'll need the
  // upstream caller to perform a field existence check on the card
  // definition to ensure this field does not already exist in the adoption chain
  test('throws when adding a field with a name the card already has', async function (assert) {
    let src = `
      import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends CardDef {
        @field firstName = contains(StringCard);
      }
    `;
    let mod = new ModuleSyntax(src);
    try {
      mod.addField(
        { type: 'exportedName', name: 'Person' },
        'firstName',
        {
          module: 'https://cardstack.com/base/string',
          name: 'default',
        },
        'contains',
      );
      throw new Error('expected error was not thrown');
    } catch (err: any) {
      assert.ok(
        err.message.match(/field "firstName" already exists/),
        'expected error was thrown',
      );
    }
  });

  test('can remove a field from a card', async function (assert) {
    let src = `
      import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends CardDef {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
      }
    `;
    let mod = new ModuleSyntax(src);
    mod.removeField({ type: 'exportedName', name: 'Person' }, 'firstName');

    assert.codeEqual(
      mod.code(),
      `
        import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Person extends CardDef {
          @field lastName = contains(StringCard);
        }
      `,
    );

    let card = mod.possibleCards.find((c) => c.exportedAs === 'Person');
    let field = card!.possibleFields.get('firstName');
    assert.strictEqual(field, undefined, 'field does not exist in syntax');
  });

  test('can remove the last field from a card', async function (assert) {
    let src = `
      import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends CardDef {
        @field firstName = contains(StringCard);
      }
    `;

    let mod = new ModuleSyntax(src);
    mod.removeField({ type: 'exportedName', name: 'Person' }, 'firstName');

    assert.codeEqual(
      mod.code(),
      `
        import { CardDef } from "https://cardstack.com/base/card-api";
        export class Person extends CardDef { }
      `,
    );
  });

  test('can remove a linksTo field with the same type as its enclosing card', async function (assert) {
    let src = `
      import { contains, field, CardDef, linksTo } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Friend extends CardDef {
        @field firstName = contains(StringCard);
        @field friend = linksTo(() => Friend);
      }
    `;
    let mod = new ModuleSyntax(src);
    mod.removeField({ type: 'exportedName', name: 'Friend' }, 'friend');

    assert.codeEqual(
      mod.code(),
      `
        import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Friend extends CardDef {
          @field firstName = contains(StringCard);
        }
      `,
    );

    let card = mod.possibleCards.find((c) => c.exportedAs === 'Friend');
    let field = card!.possibleFields.get('friend');
    assert.strictEqual(field, undefined, 'field does not exist in syntax');
  });

  test('can remove the field from a card that is not exported', async function (assert) {
    let src = `
      import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      class Person extends CardDef {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
      }

      export class FancyPerson extends Person {
        @field favoriteColor = contains(StringCard);
      }
    `;
    let mod = new ModuleSyntax(src);
    mod.removeField({ type: 'localName', name: 'Person' }, 'firstName');

    assert.codeEqual(
      mod.code(),
      `
        import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        class Person extends CardDef {
          @field lastName = contains(StringCard);
        }

        export class FancyPerson extends Person {
          @field favoriteColor = contains(StringCard);
        }
      `,
    );
  });

  test('throws when field to remove does not actually exist', async function (assert) {
    let src = `
      import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends CardDef {
        @field firstName = contains(StringCard);
      }
    `;

    let mod = new ModuleSyntax(src);
    try {
      mod.removeField({ type: 'exportedName', name: 'Person' }, 'foo');
      throw new Error('expected error was not thrown');
    } catch (err: any) {
      assert.ok(
        err.message.match(/field "foo" does not exist/),
        'expected error was thrown',
      );
    }
  });
});
