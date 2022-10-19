import { module, test } from "qunit";
import { Loader } from "@cardstack/runtime-common";
import { dirSync, setGracefulCleanup } from "tmp";
import { createRealm } from "./helpers";

setGracefulCleanup();

const testRealm = "http://localhost:4202/node-test/";

module("loader", function (hooks) {
  let dir: string;
  hooks.beforeEach(async function () {
    dir = dirSync().name;
  });

  test("can dynamically load modules with cycles", async function (assert) {
    let loader = new Loader();
    let module = await loader.import<{ three(): number }>(
      `${testRealm}cycle-two`
    );
    assert.strictEqual(module.three(), 3);
  });

  test("can resolve multiple import load races against a common dep", async function (assert) {
    let loader = new Loader();
    let a = loader.import<{ a(): string }>(`${testRealm}a`);
    let b = loader.import<{ b(): string }>(`${testRealm}b`);
    let [aModule, bModule] = await Promise.all([a, b]);
    assert.strictEqual(aModule.a(), "abc", "module executed successfully");
    assert.strictEqual(bModule.b(), "bc", "module executed successfully");
  });

  test("supports import.meta", async function (assert) {
    let loader = new Loader();
    let realm = createRealm(
      dir,
      {
        "foo.js": `
          export function checkImportMeta() { return import.meta.url; }
          export function myLoader() { return import.meta.loader; }
        `,
      },
      "http://example.com/"
    );
    await realm.ready;
    loader.registerRealm(realm);

    let { checkImportMeta, myLoader } = await loader.import<{
      checkImportMeta: () => string;
      myLoader: () => Loader;
    }>("http://example.com/foo");
    assert.strictEqual(checkImportMeta(), "http://example.com/foo");
    assert.strictEqual(myLoader(), loader, "the loader instance is correct");
  });

  test("can determine consumed modules", async function (assert) {
    let loader = new Loader();
    await loader.import<{ a(): string }>(`${testRealm}a`);
    assert.deepEqual(await loader.getConsumedModules(`${testRealm}a`), [
      `${testRealm}a`,
      `${testRealm}b`,
      `${testRealm}c`,
    ]);
  });

  test("can determine consumed modules when an error is encountered during loading", async function (assert) {
    let loader = new Loader();
    try {
      await loader.import<{ d(): string }>(`${testRealm}d`);
      throw new Error(`expected error was not thrown`);
    } catch (e) {
      assert.strictEqual(e.message, "intentional error thrown");
      assert.deepEqual(await loader.getConsumedModules(`${testRealm}d`), [
        `${testRealm}d`,
        `${testRealm}a`,
        `${testRealm}b`,
        `${testRealm}c`,
        `${testRealm}e`,
      ]);
    }
  });

  test("can get consumed modules within a cycle", async function (assert) {
    let loader = new Loader();
    await loader.import<{ three(): number }>(`${testRealm}cycle-two`);
    let modules = await loader.getConsumedModules(`${testRealm}cycle-two`);
    assert.deepEqual(modules, [
      `${testRealm}cycle-two`,
      `${testRealm}cycle-one`,
    ]);
  });

  test("supports identify API", async function (assert) {
    let loader = new Loader();
    let { Person } = await loader.import<{ Person: unknown }>(
      `${testRealm}person`
    );
    assert.deepEqual(loader.identify(Person), {
      module: `${testRealm}person`,
      name: "Person",
    });
    // The loader knows which loader instance was used to import the card
    assert.deepEqual(Loader.identify(Person), {
      module: `${testRealm}person`,
      name: "Person",
    });
  });

  test("exports cannot be mutated", async function (assert) {
    let loader = new Loader();
    let module = await loader.import<{ Person: unknown }>(`${testRealm}person`);
    assert.throws(() => {
      module.Person = 1;
    }, /modules are read only/);
  });

  test("can get a loader used to import a specific card", async function (assert) {
    let loader = new Loader();
    let module = await loader.import<any>(`${testRealm}person`);
    let card = module.Person;
    let testingLoader = Loader.getLoaderFor(card);
    assert.strictEqual(testingLoader, loader, "the loaders are the same");
  });
});
