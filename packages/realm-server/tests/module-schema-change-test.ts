import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import { rri, type Realm } from '@cardstack/runtime-common';
import { moduleSchemaChanged } from '@cardstack/runtime-common/module-schema-change';
import { setupPermissionedRealmCached } from './helpers/index.ts';

const moduleURL = 'http://127.0.0.1:4444/test/person.gts';

const personGts = `
  import {
    contains,
    containsMany,
    field,
    linksTo,
    serialize,
    CardDef,
    Component,
  } from '@cardstack/base/card-api';
  import StringField from '@cardstack/base/string';
  import { Pet } from './pet';

  export class Person extends CardDef {
    static displayName = 'Person';
    @field firstName = contains(StringField);
    @field pet = linksTo(() => Pet);
    @field title = contains(StringField, {
      computeVia: function (this: Person) {
        return this.firstName;
      },
    });
    get greeting() {
      return 'Hello';
    }
    static isolated = class Isolated extends Component<typeof this> {
      <template><h1>{{@model.firstName}}</h1></template>
    };
  }
`;

function edit(src: string, from: string, to: string): string {
  if (!src.includes(from)) {
    throw new Error(`the fixture does not contain ${JSON.stringify(from)}`);
  }
  return src.replace(from, to);
}

async function changed(before: string | undefined, after: string | undefined) {
  return await moduleSchemaChanged({ url: moduleURL, before, after });
}

module(basename(import.meta.filename), function () {
  module('moduleSchemaChanged', function () {
    test('a change to a template, a method, a static value or a compute function leaves the schema', async function (assert) {
      assert.false(
        await changed(
          personGts,
          edit(personGts, '<h1>{{@model.firstName}}</h1>', '<p>Hi</p>'),
        ),
        'template',
      );
      assert.false(
        await changed(personGts, edit(personGts, "'Hello'", "'Hi there'")),
        'getter body',
      );
      assert.false(
        await changed(personGts, edit(personGts, "'Person'", "'Human'")),
        'display name',
      );
      assert.false(
        await changed(
          personGts,
          edit(
            personGts,
            'return this.firstName;',
            'return `${this.firstName}!`;',
          ),
        ),
        "computed field's function",
      );
      assert.false(
        await changed(
          personGts,
          edit(
            personGts,
            '@field firstName',
            '// the given name\n    @field firstName',
          ),
        ),
        'comment',
      );
    });

    test('a change to the fields a card declares is a schema change', async function (assert) {
      assert.true(
        await changed(
          personGts,
          edit(
            personGts,
            '@field pet',
            '@field lastName = contains(StringField);\n    @field pet',
          ),
        ),
        'field added',
      );
      assert.true(
        await changed(
          personGts,
          edit(personGts, '@field firstName = contains(StringField);', ''),
        ),
        'field removed',
      );
      assert.true(
        await changed(
          personGts,
          edit(personGts, '@field firstName =', '@field givenName ='),
        ),
        'field renamed',
      );
      assert.true(
        await changed(
          personGts,
          edit(
            personGts,
            'firstName = contains(StringField)',
            'firstName = contains(Pet)',
          ),
        ),
        'field type',
      );
      assert.true(
        await changed(
          personGts,
          edit(
            personGts,
            'firstName = contains(StringField)',
            'firstName = containsMany(StringField)',
          ),
        ),
        'contains to containsMany',
      );
      assert.true(
        await changed(
          personGts,
          edit(
            personGts,
            `@field title = contains(StringField, {
      computeVia: function (this: Person) {
        return this.firstName;
      },
    });`,
            '@field title = contains(StringField);',
          ),
        ),
        'computed field made stored',
      );
    });

    test('a change to the classes a module declares or re-exports is a schema change', async function (assert) {
      assert.true(
        await changed(
          personGts,
          edit(personGts, 'Person extends CardDef', 'Person extends Pet'),
        ),
        'superclass',
      );
      assert.true(
        await changed(
          personGts,
          edit(personGts, 'export class Person', 'export class Human'),
        ),
        'class renamed',
      );
      assert.true(
        await changed(
          personGts,
          `${personGts}\nexport { Pet as Animal } from './pet';`,
        ),
        're-export added',
      );
      assert.true(await changed(undefined, personGts), 'module created');
      assert.true(await changed(personGts, undefined), 'module removed');
    });

    test("a change to a class's serialization hook is a schema change", async function (assert) {
      let withHook = edit(
        personGts,
        'get greeting()',
        'static [serialize](value: string) {\n      return value;\n    }\n    get greeting()',
      );
      assert.true(
        await changed(
          withHook,
          edit(withHook, 'return value;', 'return value.trim();'),
        ),
      );
    });

    test('an exported function is part of the schema, since another module can build a field with it', async function (assert) {
      let helper = `export function greet(name: string) { return 'Hello ' + name; }`;
      assert.true(await changed(helper, edit(helper, "'Hello '", "'Hi '")));
    });

    test('a function only a method calls is no part of the schema', async function (assert) {
      let card = (body: string) => `
        import { CardDef, field, contains } from '@cardstack/base/card-api';
        import StringField from '@cardstack/base/string';
        function format(value: string) { ${body} }
        export class P extends CardDef {
          @field a = contains(StringField);
          get formatted() { return format(this.a); }
        }
      `;
      assert.false(
        await changed(card('return value;'), card('return value.trim();')),
      );
    });

    test('a source that does not parse after the write proves no schema change', async function (assert) {
      assert.false(await changed(personGts, `${personGts}\nclass {`));
    });

    test('a broken source between two versions does not hide the schema change across them', async function (assert) {
      let broken = `${personGts}\nclass {`;
      let withLastName = edit(
        personGts,
        '@field pet',
        '@field lastName = contains(StringField);\n    @field pet',
      );
      assert.false(await changed(personGts, broken), 'into the broken source');
      assert.true(
        await changed(broken, withLastName),
        'out of it, into a source that declares a schema',
      );
    });

    test('a field is read however it is spelled', async function (assert) {
      let head = `
        import { CardDef, field, contains, linksTo } from '@cardstack/base/card-api';
        import * as Base from '@cardstack/base/card-api';
        import StringField from '@cardstack/base/string';
        import NumberField from '@cardstack/base/number';
      `;
      assert.true(
        await changed(
          `${head}export class P extends CardDef {}\nclass Pet extends CardDef {}`,
          `${head}export class P extends CardDef { @field pet = linksTo(() => Pet); }\nclass Pet extends CardDef {}`,
        ),
        'a forward reference to a class declared later',
      );
      assert.true(
        await changed(
          `${head}export class P extends Base.CardDef { @field a = contains(StringField); }`,
          `${head}export class P extends Base.FieldDef { @field a = contains(StringField); }`,
        ),
        'a superclass reached through a namespace',
      );
      assert.true(
        await changed(
          `${head}export class P extends CardDef {}`,
          `${head}export class P extends CardDef { @field 'my-field' = contains(StringField); }`,
        ),
        'a string-keyed field',
      );
      assert.true(
        await changed(
          `${head}export const P = class extends CardDef {};`,
          `${head}export const P = class extends CardDef { @field a = contains(StringField); };`,
        ),
        'a class expression',
      );
      assert.true(
        await changed(
          `${head}const S = StringField;\nexport class P extends CardDef { @field a = contains(S); }`,
          `${head}const S = NumberField;\nexport class P extends CardDef { @field a = contains(S); }`,
        ),
        'a local alias of the field class',
      );
      assert.true(
        await changed(
          `${head}export const ActiveField = StringField;`,
          `${head}export const ActiveField = NumberField;`,
        ),
        'an exported alias another module declares a field with',
      );
      assert.true(
        await changed(
          `${head}const opts = {};\nexport class P extends CardDef { @field a = contains(StringField, opts); }`,
          `${head}const opts = { computeVia() { return 'x'; } };\nexport class P extends CardDef { @field a = contains(StringField, opts); }`,
        ),
        'options held in a variable gaining a compute function',
      );
      assert.false(
        await changed(
          `${head}const opts = { computeVia() { return 'x'; } };\nexport class P extends CardDef { @field a = contains(StringField, opts); }`,
          `${head}const opts = { computeVia() { return 'y'; } };\nexport class P extends CardDef { @field a = contains(StringField, opts); }`,
        ),
        'while what that compute function computes is no part of the schema',
      );
      assert.true(
        await changed(
          `${head}export class P extends CardDef { @field a = contains(StringField) }`,
          `${head}export class P extends CardDef { @field a = contains(StringField);\n  @field b = contains(StringField) }`.replace(
            'contains(StringField) }',
            'contains(NumberField)\n  <template>hi</template> }',
          ),
        ),
        'a field with no semicolon ahead of a template in the class body',
      );
      assert.true(
        await changed(
          `${head}export class P extends CardDef { @field a = contains(StringField); }`,
          `${head.replace("'@cardstack/base/string'", "'./my-string'")}export class P extends CardDef { @field a = contains(StringField); }`,
        ),
        'an import the field class resolves through',
      );
    });

    test('a module-level binding is read whatever its value is', async function (assert) {
      let head = `
        import { CardDef, field, contains } from '@cardstack/base/card-api';
        import StringField from '@cardstack/base/string';
        import NumberField from '@cardstack/base/number';
        import BooleanField from '@cardstack/base/boolean';
        import enumField from '@cardstack/base/enum';
      `;
      assert.true(
        await changed(
          `${head}export const Priority = enumField(StringField, { options: [1, 2, 3] });`,
          `${head}export const Priority = enumField(NumberField, { options: [1, 2, 3] });`,
        ),
        "a field factory's base",
      );
      assert.true(
        await changed(
          `${head}const F = StringField as typeof StringField;\nexport class P extends CardDef { @field a = contains(F); }`,
          `${head}const F = BooleanField as typeof StringField;\nexport class P extends CardDef { @field a = contains(F); }`,
        ),
        'a cast',
      );
      assert.true(
        await changed(
          `${head}const { F } = { F: StringField };\nexport class P extends CardDef { @field a = contains(F); }`,
          `${head}const { F } = { F: NumberField };\nexport class P extends CardDef { @field a = contains(F); }`,
        ),
        'a destructure',
      );
      assert.true(
        await changed(
          `${head}function makeOpts(o: object) { return o; }\nconst opts = makeOpts({});\nexport class P extends CardDef { @field a = contains(StringField, opts); }`,
          `${head}function makeOpts(o: object) { return o; }\nconst opts = makeOpts({ query: {} });\nexport class P extends CardDef { @field a = contains(StringField, opts); }`,
        ),
        'options built by a call',
      );
      assert.true(
        await changed(
          `${head}function mk(F: typeof CardDef) { return class extends F {}; }\nexport const P = mk(CardDef);`,
          `${head}function mk(_F: typeof CardDef) { return class extends NumberField {}; }\nexport const P = mk(CardDef);`,
        ),
        'a function an exported class is built with',
      );
      assert.false(
        await changed(
          `${head}const LABEL = 'a';\nexport class P extends CardDef { @field a = contains(StringField); get label() { return LABEL; } }`,
          `${head}const LABEL = 'b';\nexport class P extends CardDef { @field a = contains(StringField); get label() { return LABEL; } }`,
        ),
        'while a constant only a method reads is no part of the schema',
      );
      assert.true(
        await changed(
          `${head}export function statusField() { return enumField(StringField, { options: [1] }); }`,
          `${head}export function statusField() { return enumField(NumberField, { options: [1] }); }`,
        ),
        'an exported function another module builds a field with',
      );
      assert.true(
        await changed(
          `${head}const Base = StringField;\nexport default enumField(Base, { options: [1] });`,
          `${head}const Base = NumberField;\nexport default enumField(Base, { options: [1] });`,
        ),
        'a name a default export is built from',
      );
      assert.false(
        await changed(
          `${head}export default class extends CardDef { @field a = contains(StringField); get x() { return 1; } }`,
          `${head}export default class extends CardDef { @field a = contains(StringField); get x() { return 2; } }`,
        ),
        "while a default-exported class's method body is no part of the schema",
      );
    });

    test('component state and unrelated imports are no part of the schema', async function (assert) {
      let head = `
        import { CardDef, field, contains, Component } from '@cardstack/base/card-api';
        import StringField from '@cardstack/base/string';
        import { tracked } from '@glimmer/tracking';
      `;
      let card = (state: string) =>
        `${head}export class P extends CardDef {
          @field a = contains(StringField);
          static isolated = class extends Component<typeof this> { ${state} };
        }`;
      assert.false(
        await changed(
          card('@tracked open = false;'),
          card('@tracked open = true; @tracked page = 1;'),
        ),
        "a component's tracked state",
      );
      assert.false(
        await changed(
          card(''),
          `import { format } from 'date-fns';\n${card('')}`,
        ),
        'an import nothing in the schema refers to',
      );
    });
  });

  module('module writes at the write-path gate', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/module-schema-gate/');
    let realm: Realm;
    // The modules in each pass the realm enqueued, and whether the pass held
    // the write-path gate, read the moment its enqueue returned. Read there
    // rather than raced against afterwards: a pass settles as fast as the
    // worker runs it.
    let modulePasses: { modules: string[]; holdsGate: boolean }[];

    let petGts = `
      import { contains, field, CardDef } from '@cardstack/base/card-api';
      import StringField from '@cardstack/base/string';
      export class Pet extends CardDef {
        @field name = contains(StringField);
      }
    `;

    setupPermissionedRealmCached(hooks, {
      mode: 'beforeEach',
      realmURL,
      permissions: { '*': ['read', 'write'] },
      fileSystem: {
        'pet.gts': petGts,
        'person.gts': personGts,
        'mango.json': {
          data: {
            type: 'card',
            attributes: { firstName: 'Mango' },
            meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
          },
        },
      },
      onRealmSetup(args: { testRealm: Realm; request: SuperTest<Test> }) {
        realm = args.testRealm;
      },
    });

    hooks.beforeEach(function () {
      modulePasses = [];
      let updater = realm.realmIndexUpdater;
      let enqueueChanges = updater.enqueueChanges.bind(updater);
      (updater as any).enqueueChanges = async (
        ...args: Parameters<typeof updater.enqueueChanges>
      ) => {
        let result = await enqueueChanges(...args);
        let modules = args[0]
          .map(({ url }) => url.href)
          .filter((href) => href.endsWith('.gts'))
          .sort();
        if (modules.length > 0) {
          modulePasses.push({
            modules,
            holdsGate:
              updater.incrementalIndexingAffectingStaging() !== undefined,
          });
        }
        return result;
      };
    });

    hooks.afterEach(function () {
      delete (realm.realmIndexUpdater as any).enqueueChanges;
    });

    test('a module write that leaves the schema does not hold other writers', async function (assert) {
      await realm.write(
        'person.gts',
        edit(personGts, '<h1>{{@model.firstName}}</h1>', '<p>Hi</p>'),
      );
      assert.deepEqual(modulePasses, [
        { modules: [`${realmURL.href}person.gts`], holdsGate: false },
      ]);
    });

    test('a module write whose indexing is deferred does not hold other writers when it leaves the schema', async function (assert) {
      await realm.writeMany(
        new Map([
          [
            'person.gts',
            edit(personGts, '<h1>{{@model.firstName}}</h1>', '<p>Hi</p>'),
          ],
        ]),
        { waitForIndex: false },
      );
      assert.deepEqual(modulePasses, [
        { modules: [`${realmURL.href}person.gts`], holdsGate: false },
      ]);
      await realm.incrementalIndexing();
    });

    test('a batch that writes a module and then an instance runs the module pass outside the gate', async function (assert) {
      await realm.writeMany(
        new Map([
          [
            'person.gts',
            edit(personGts, '<h1>{{@model.firstName}}</h1>', '<p>Hi</p>'),
          ],
          [
            'mango.json',
            JSON.stringify({
              data: {
                type: 'card',
                attributes: { firstName: 'Mango Jr.' },
                meta: {
                  adoptsFrom: { module: rri('./person'), name: 'Person' },
                },
              },
            }),
          ],
        ]),
      );
      assert.deepEqual(
        modulePasses,
        [{ modules: [`${realmURL.href}person.gts`], holdsGate: false }],
        'the pass that flushes the module ahead of the instance',
      );
    });

    test('a module write that changes the schema holds other writers', async function (assert) {
      await realm.write(
        'person.gts',
        edit(
          personGts,
          '@field pet',
          '@field lastName = contains(StringField);\n    @field pet',
        ),
      );
      assert.deepEqual(modulePasses, [
        { modules: [`${realmURL.href}person.gts`], holdsGate: true },
      ]);
    });

    test('in one batch, a module whose schema changed holds the gate for the pass both are in', async function (assert) {
      await realm.writeMany(
        new Map([
          [
            'person.gts',
            edit(personGts, '<h1>{{@model.firstName}}</h1>', '<p>Hi</p>'),
          ],
          [
            'pet.gts',
            edit(
              petGts,
              '@field name',
              '@field nickname = contains(StringField);\n        @field name',
            ),
          ],
        ]),
      );
      assert.deepEqual(
        modulePasses,
        [
          {
            modules: [`${realmURL.href}person.gts`, `${realmURL.href}pet.gts`],
            holdsGate: true,
          },
        ],
        'one pass carries both modules, and the schema change holds it',
      );
    });
  });
});
