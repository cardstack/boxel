import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm, Loader } from '@cardstack/runtime-common';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

module('Unit | loader', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);

  let loader: Loader;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'a.js': `
          import { b } from './b';
          export function a() {
            return 'a' + b();
          }
        `,
        'b.js': `
          import { c } from './c';
          export function b() {
            return 'b' + c();
          }
        `,
        'c.js': `
          export function c() {
            return 'c';
          }
        `,
        'd.js': `
          import { a } from './a';
          import { e } from './e';
          export function d() {
            return a() + e();
          }
        `,
        'e.js': `
          throw new Error('intentional error thrown');
        `,
        'f.js': `
          import { b } from './b';
          import { g } from './g';
          export function f() {
            return b() + g();
          }
        `,
        'g.js': `
          export function g() {
            return 'g';
          }
        `,
        'cycle-one.js': `
          import { two } from './cycle-two';
          export function one() {
            return two() - 1;
          }
        `,
        'cycle-two.js': `
          import { one } from './cycle-one';
          export function two() {
            return 2;
          }
          export function three() {
            return one() * 3;
          }
        `,
        'deadlock/a.js': `
          import { b } from './b';
          export function d() {
            return 'd';
          }
          export function a() {
            return 'a' + b();
          }
        `,
        'deadlock/b.js': `
          import { c } from './c';
          export function b() {
            return 'b' + c();
          }
        `,
        'deadlock/c.js': `
          import { d } from './a';
          export function c() {
            return 'c' + d();
          }
        `,
        'person.gts': `
          import { contains, field, CardDef } from 'https://cardstack.com/base/card-api';
          import StringField from 'https://cardstack.com/base/string';
          export class Person extends CardDef {
            static displayName = 'Person';
            @field firstName = contains(StringField);
          }
          export let counter = 0;
          export function increment() {
            counter++;
          }
        `,
        'foo.js': `
          export function checkImportMeta() { return import.meta.url; }
          export function myLoader() { return import.meta.loader; }
        `,
      },
    });
  });

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  test('can dynamically load modules with cycles', async function (assert) {
    let module = await loader.import<{ three(): number }>(
      `${testRealmURL}cycle-two`,
    );
    assert.strictEqual(module.three(), 3);
  });

  test('can resolve multiple import load races against a common dep', async function (assert) {
    let a = loader.import<{ a(): string }>(`${testRealmURL}a`);
    let b = loader.import<{ b(): string }>(`${testRealmURL}b`);
    let [aModule, bModule] = await Promise.all([a, b]);
    assert.strictEqual(aModule.a(), 'abc', 'module executed successfully');
    assert.strictEqual(bModule.b(), 'bc', 'module executed successfully');
  });

  test('can resolve a import deadlock', async function (assert) {
    let a = loader.import<{ a(): string }>(`${testRealmURL}deadlock/a`);
    let b = loader.import<{ b(): string }>(`${testRealmURL}deadlock/b`);
    let c = loader.import<{ c(): string }>(`${testRealmURL}deadlock/c`);
    let [aModule, bModule, cModule] = await Promise.all([a, b, c]);
    assert.strictEqual(aModule.a(), 'abcd', 'module executed successfully');
    assert.strictEqual(bModule.b(), 'bcd', 'module executed successfully');
    assert.strictEqual(cModule.c(), 'cd', 'module executed successfully');
  });

  test('can determine consumed modules', async function (assert) {
    await loader.import(`${testRealmURL}f`);
    assert.deepEqual(await loader.getConsumedModules(`${testRealmURL}f`), [
      `${testRealmURL}b`,
      `${testRealmURL}c`,
      `${testRealmURL}g`,
    ]);
    // assert deps from f don't leak into a's deps (fixes CS-9159)
    await loader.import(`${testRealmURL}a`);
    assert.deepEqual(await loader.getConsumedModules(`${testRealmURL}a`), [
      `${testRealmURL}b`,
      `${testRealmURL}c`,
    ]);
  });

  test('can get consumed modules within a cycle', async function (assert) {
    await loader.import<{ three(): number }>(`${testRealmURL}cycle-two`);
    let modules = await loader.getConsumedModules(`${testRealmURL}cycle-two`);
    assert.deepEqual(modules, [`${testRealmURL}cycle-one`]);
  });

  test('supports identify API', async function (assert) {
    let { Person } = await loader.import<{ Person: unknown }>(
      `${testRealmURL}person`,
    );
    assert.deepEqual(loader.identify(Person), {
      module: `${testRealmURL}person`,
      name: 'Person',
    });
    // The loader knows which loader instance was used to import the card
    assert.deepEqual(Loader.identify(Person), {
      module: `${testRealmURL}person`,
      name: 'Person',
    });
  });

  test('exports cannot be mutated from the outside', async function (assert) {
    let module = await loader.import<{ Person: unknown }>(
      `${testRealmURL}person`,
    );
    assert.throws(() => {
      module.Person = 1;
    }, /TypeError: Failed to set the 'Person' property on 'Module': Cannot assign to read only property 'Person'/);
  });

  test('exports can be mutated from the inside', async function (assert) {
    let module = await loader.import<{
      counter: number;
      increment: () => void;
    }>(`${testRealmURL}person`);
    assert.strictEqual(module.counter, 0);
    module.increment();
    assert.strictEqual(module.counter, 1);
  });

  test('can get a loader used to import a specific card', async function (assert) {
    let module = await loader.import<any>(`${testRealmURL}person`);
    let card = module.Person;
    let testingLoader = Loader.getLoaderFor(card);
    assert.strictEqual(testingLoader, loader, 'the loaders are the same');
  });

  test('supports import.meta', async function (assert) {
    let { checkImportMeta, myLoader } = await loader.import<{
      checkImportMeta: () => string;
      myLoader: () => Loader;
    }>(`${testRealmURL}foo`);
    assert.strictEqual(checkImportMeta(), `${testRealmURL}foo.js`);
    assert.strictEqual(myLoader(), loader, 'the loader instance is correct');
  });

  test('identify preserves original module for reexports', function (assert) {
    let throwIfFetch = new Loader(async () => {
      throw new Error(
        'fetch should not be invoked during shimmed module tests',
      );
    });

    class StringField {}

    throwIfFetch.shimModule(`${baseRealm.url}card-api.gts`, {
      StringField,
    });

    throwIfFetch.shimModule(`${baseRealm.url}string.ts`, {
      default: StringField,
    });

    assert.deepEqual(Loader.identify(StringField), {
      module: `${baseRealm.url}card-api`,
      name: 'StringField',
    });
  });
});
