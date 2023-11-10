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

    let mod = new ModuleSyntax(src, new URL(testRealm));
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

    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/person.gts`));
    mod.addField(
      { module: `${testRealm}dir/person.gts`, name: 'Person' },
      'age',
      {
        module: 'https://cardstack.com/base/number',
        name: 'default',
      },
      'contains',
      undefined,
      undefined,
      undefined,
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

    let card = mod.possibleCardsOrFields.find((c) => c.exportedAs === 'Person');
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
      { module: `${testRealm}dir/person.gts`, name: 'Person' },
      'lastName',
      {
        module: 'https://cardstack.com/base/string',
        name: 'default',
      },
      'contains',
      undefined,
      undefined,
      undefined,
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

  test('can add a field to a card when the module url is relative', async function (assert) {
    let src = `
      import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";
      export class Pet extends CardDef {
        @field petName = contains(StringCard);
      }
    `;

    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/pet.gts`));

    mod.addField(
      { module: `${testRealm}dir/pet`, name: 'Pet' }, // Card we want to add to
      'bestFriend',
      {
        module: '../person',
        name: 'Person',
      },
      'linksTo',
      new URL(`http://localhost:4202/node-test/catalog-entry/1`), // hypothethical catalog entry that lives at this id
      new URL('http://localhost:4202/node-test/pet'), // outgoing card
      new URL('http://localhost:4202/node-test/'), // the realm that the catalog entry lives in
    );

    assert.codeEqual(
      mod.code(),
      `
        import { Person as PersonCard } from "./person";
        import { contains, field, CardDef, linksTo } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        export class Pet extends CardDef {
          @field petName = contains(StringCard);
          @field bestFriend = linksTo(() => PersonCard);
        }
      `,
    );
  });

  test('can add a field to a card when the module url is from another realm', async function (assert) {
    let src = `
      import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";
      export class Pet extends CardDef {
        @field petName = contains(StringCard);
      }
    `;

    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/pet.gts`));

    mod.addField(
      { module: `${testRealm}dir/pet`, name: 'Pet' }, // card we want to add to
      'bestFriend',
      {
        module: '../person', // the other realm (will be from the /test realm not the /node-test)
        name: 'Person',
      },
      'linksTo',
      new URL(`http://localhost:4202/test/catalog-entry/1`), // hypothethical catalog entry that lives at this id
      new URL('http://localhost:4202/node-test/pet'), // outgoing card
      new URL('http://localhost:4202/node-test/'), // the realm that the catalog entry lives in
    );

    assert.codeEqual(
      mod.code(),
      `
        import { Person as PersonCard } from "http://localhost:4202/test/person";
        import { contains, field, CardDef, linksTo } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        export class Pet extends CardDef {
          @field petName = contains(StringCard);
          @field bestFriend = linksTo(() => PersonCard);
        }
      `,
    );
  });

  test("can add a field to a card that doesn't have any fields", async function (assert) {
    let src = `
        import { CardDef } from "https://cardstack.com/base/card-api";

        export class Person extends CardDef { }
      `;

    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/person`));
    mod.addField(
      { module: `${testRealm}dir/person`, name: 'Person' },
      'firstName',
      {
        module: 'https://cardstack.com/base/string',
        name: 'default',
      },
      'contains',
      undefined,
      undefined,
      undefined,
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

  test('can add a field to an interior card that is the field of card that is exported', async function (assert) {
    let src = `
      import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      class Details extends CardDef {
        @field favoriteColor = contains(StringCard);
      }

      export class Person extends CardDef {
        @field firstName = contains(StringCard);
        @field details = contains(Details);
        static embedded = class Embedded extends Component<typeof this> {
          <template><h1><@fields.firstName/></h1></template>
        }
      }
    `;

    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/person`));
    mod.addField(
      {
        type: 'fieldOf',
        field: 'details',
        card: { module: `${testRealm}dir/person`, name: 'Person' },
      },
      'age',
      {
        module: 'https://cardstack.com/base/number',
        name: 'default',
      },
      'contains',
      undefined,
      undefined,
      undefined,
    );

    assert.codeEqual(
      mod.code(),
      `
        import NumberCard from "https://cardstack.com/base/number";
        import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        class Details extends CardDef {
          @field favoriteColor = contains(StringCard);
          @field age = contains(NumberCard);
        }

        export class Person extends CardDef {
          @field firstName = contains(StringCard);
          @field details = contains(Details);
          static embedded = class Embedded extends Component<typeof this> {
            <template><h1><@fields.firstName/></h1></template>
          }
        }
      `,
    );
  });

  test('can add a field to an interior card that is the ancestor of card that is exported', async function (assert) {
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

    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/person`));
    mod.addField(
      {
        type: 'ancestorOf',
        card: { module: `${testRealm}dir/person`, name: 'FancyPerson' },
      },
      'age',
      {
        module: 'https://cardstack.com/base/number',
        name: 'default',
      },
      'contains',
      undefined,
      undefined,
      undefined,
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

  test('can add a field to an interior card within a module that also has non card declarations', async function (assert) {
    let src = `
      import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Foo {}

      class Details extends CardDef {
        @field favoriteColor = contains(StringCard);
      }

      export class Person extends CardDef {
        @field firstName = contains(StringCard);
        @field details = contains(Details);
        static embedded = class Embedded extends Component<typeof this> {
          <template><h1><@fields.firstName/></h1></template>
        }
      }
    `;

    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/person`));
    mod.addField(
      {
        type: 'fieldOf',
        field: 'details',
        card: { module: `${testRealm}dir/person`, name: 'Person' },
      },
      'age',
      {
        module: 'https://cardstack.com/base/number',
        name: 'default',
      },
      'contains',
      undefined,
      undefined,
      undefined,
    );

    assert.codeEqual(
      mod.code(),
      `
        import NumberCard from "https://cardstack.com/base/number";
        import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Foo {}

        class Details extends CardDef {
          @field favoriteColor = contains(StringCard);
          @field age = contains(NumberCard);
        }

        export class Person extends CardDef {
          @field firstName = contains(StringCard);
          @field details = contains(Details);
          static embedded = class Embedded extends Component<typeof this> {
            <template><h1><@fields.firstName/></h1></template>
          }
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

    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/person`));
    mod.addField(
      { module: `${testRealm}dir/person`, name: 'Person' },
      'aliases',
      {
        module: 'https://cardstack.com/base/string',
        name: 'default',
      },
      'containsMany',
      undefined,
      undefined,
      undefined,
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
    let card = mod.possibleCardsOrFields.find((c) => c.exportedAs === 'Person');
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
    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/person`));
    mod.addField(
      { module: `${testRealm}dir/person`, name: 'Person' },
      'pet',
      {
        module: `${testRealm}dir/pet`,
        name: 'Pet',
      },
      'linksTo',
      undefined,
      undefined,
      undefined,
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
    let card = mod.possibleCardsOrFields.find((c) => c.exportedAs === 'Person');
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
    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/person`));
    mod.addField(
      { module: `${testRealm}dir/person`, name: 'Person' },
      'friend',
      {
        module: `${testRealm}dir/person`,
        name: 'Person',
      },
      'linksTo',
      undefined,
      undefined,
      undefined,
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
    let card = mod.possibleCardsOrFields.find((c) => c.exportedAs === 'Person');
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

    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/person`));
    mod.addField(
      { module: `${testRealm}dir/person`, name: 'Person' },
      'age',
      {
        module: 'https://cardstack.com/base/number',
        name: 'default',
      },
      'contains',
      undefined,
      undefined,
      undefined,
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
    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/person`));
    try {
      mod.addField(
        { module: `${testRealm}dir/person`, name: 'Person' },
        'firstName',
        {
          module: 'https://cardstack.com/base/string',
          name: 'default',
        },
        'contains',
        undefined,
        undefined,
        undefined,
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
    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/person`));
    mod.removeField(
      { module: `${testRealm}dir/person`, name: 'Person' },
      'firstName',
    );

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

    let card = mod.possibleCardsOrFields.find((c) => c.exportedAs === 'Person');
    let field = card!.possibleFields.get('firstName');
    assert.strictEqual(field, undefined, 'field does not exist in syntax');
  });

  test('can use remove & add a field to achieve edit in place', async function (assert) {
    let src = `
      import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends CardDef {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
        @field artistName = contains(StringCard);
        @field streetName = contains(StringCard);
      }
    `;

    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/person`));
    let fieldIndex = mod.removeField(
      { module: `${testRealm}dir/person`, name: 'Person' },
      'artistName',
    );

    mod.addField(
      { module: `${testRealm}dir/person`, name: 'Person' },
      'artistNames',
      {
        module: 'https://cardstack.com/base/string',
        name: 'default',
      },
      'containsMany',
      undefined,
      undefined,
      undefined,
      fieldIndex,
    );

    assert.codeEqual(
      mod.code(),
      `
        import { contains, field, CardDef, containsMany } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Person extends CardDef {
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
          @field artistNames = containsMany(StringCard);
          @field streetName = contains(StringCard);
        }
      `,
    );
  });

  test('can use remove & add a field to achieve edit in place - when field is at the beginning', async function (assert) {
    let src = `
      import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends CardDef {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
        @field artistName = contains(StringCard);
        @field streetName = contains(StringCard);
      }
    `;

    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/person`));
    let fieldIndex = mod.removeField(
      { module: `${testRealm}dir/person`, name: 'Person' },
      'firstName',
    );

    mod.addField(
      { module: `${testRealm}dir/person`, name: 'Person' },
      'firstNameAdjusted',
      {
        module: 'https://cardstack.com/base/string',
        name: 'default',
      },
      'contains',
      undefined,
      undefined,
      undefined,
      fieldIndex,
    );

    assert.codeEqual(
      mod.code(),
      `
        import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Person extends CardDef {
          @field firstNameAdjusted = contains(StringCard);
          @field lastName = contains(StringCard);
          @field artistName = contains(StringCard);
          @field streetName = contains(StringCard);
        }
      `,
    );
  });

  test('can use remove & add a field to achieve edit in place - when field is at the end', async function (assert) {
    let src = `
      import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends CardDef {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
        @field artistName = contains(StringCard);
        @field streetName = contains(StringCard);
      }
    `;

    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/person`));
    let fieldIndex = mod.removeField(
      { module: `${testRealm}dir/person`, name: 'Person' },
      'streetName',
    );

    mod.addField(
      { module: `${testRealm}dir/person`, name: 'Person' },
      'streetNameAdjusted',
      {
        module: 'https://cardstack.com/base/string',
        name: 'default',
      },
      'contains',
      undefined,
      undefined,
      undefined,
      fieldIndex,
    );

    assert.codeEqual(
      mod.code(),
      `
        import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Person extends CardDef {
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
          @field artistName = contains(StringCard);
          @field streetNameAdjusted = contains(StringCard);
        }
      `,
    );
  });

  test('can remove the last field from a card', async function (assert) {
    let src = `
      import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends CardDef {
        @field firstName = contains(StringCard);
      }
    `;

    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/person`));
    mod.removeField(
      { module: `${testRealm}dir/person`, name: 'Person' },
      'firstName',
    );

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
    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/person`));
    mod.removeField(
      { module: `${testRealm}dir/person`, name: 'Friend' },
      'friend',
    );

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

    let card = mod.possibleCardsOrFields.find((c) => c.exportedAs === 'Friend');
    let field = card!.possibleFields.get('friend');
    assert.strictEqual(field, undefined, 'field does not exist in syntax');
  });

  test('can remove the field of an interior card that is the ancestor of a card that is exported', async function (assert) {
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
    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/person`));
    mod.removeField(
      {
        type: 'ancestorOf',
        card: { module: `${testRealm}dir/person`, name: 'FancyPerson' },
      },
      'firstName',
    );

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

  test('can remove the field of an interior card that is the field of a card that is exported', async function (assert) {
    let src = `
      import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      class Details extends CardDef {
        @field nickName = contains(StringCard);
        @field favoriteColor = contains(StringCard);
      }

      export class Person extends CardDef {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
        @field details = contains(Details);
      }
    `;
    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/person`));
    mod.removeField(
      {
        type: 'fieldOf',
        field: 'details',
        card: { module: `${testRealm}dir/person`, name: 'Person' },
      },
      'nickName',
    );

    assert.codeEqual(
      mod.code(),
      `
        import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        class Details extends CardDef {
          @field favoriteColor = contains(StringCard);
        }

        export class Person extends CardDef {
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
          @field details = contains(Details);
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

    let mod = new ModuleSyntax(src, new URL(`${testRealm}dir/person`));
    try {
      mod.removeField(
        { module: `${testRealm}dir/person`, name: 'Person' },
        'foo',
      );
      throw new Error('expected error was not thrown');
    } catch (err: any) {
      assert.ok(
        err.message.match(/field "foo" does not exist/),
        'expected error was thrown',
      );
    }
  });
});
