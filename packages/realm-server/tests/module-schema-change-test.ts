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

    test('a module that declares no card or field has no schema to change', async function (assert) {
      let helper = `export function greet(name: string) { return 'Hello ' + name; }`;
      assert.false(
        await changed(helper, edit(helper, "'Hello '", "'Hi '")),
        'helper edited',
      );
      assert.false(await changed(undefined, helper), 'helper created');
    });

    test('a source that does not parse proves no schema change', async function (assert) {
      assert.false(await changed(personGts, `${personGts}\nclass {`));
      assert.false(await changed(`${personGts}\nclass {`, personGts));
    });
  });

  module('module writes at the write-path gate', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/module-schema-gate/');
    let realm: Realm;
    // Whether each pass the realm enqueued for a module held the write-path
    // gate, read the moment its enqueue returned. Read there rather than raced
    // against afterwards: a pass settles as fast as the worker runs it.
    let modulePasses: { url: string; holdsGate: boolean }[];

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
        for (let { url } of args[0]) {
          if (url.href.endsWith('.gts')) {
            modulePasses.push({
              url: url.href,
              holdsGate:
                updater.incrementalIndexingAffectingStaging() !== undefined,
            });
          }
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
        { url: `${realmURL.href}person.gts`, holdsGate: false },
      ]);
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
        { url: `${realmURL.href}person.gts`, holdsGate: true },
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
        modulePasses.map(({ holdsGate }) => holdsGate),
        [true, true],
        'one pass carries both modules, and the schema change holds it',
      );
    });
  });
});
