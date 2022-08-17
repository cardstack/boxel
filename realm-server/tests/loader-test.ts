import { module, test } from "qunit";
import { createRealmServer } from "../server";
import { join, resolve } from "path";
import { Server } from "http";
import { dirSync, setGracefulCleanup } from "tmp";
import { copySync } from "fs-extra";
import { Realm, Loader, baseRealm } from "@cardstack/runtime-common";
import { NodeAdapter } from "../node-realm";

setGracefulCleanup();
const testRealmURL = new URL("http://127.0.0.1:4444/");
const testRealmHref = testRealmURL.href;
const testRealm2Href = "http://localhost:4202/node-test/";

Loader.addURLMapping(
  new URL(baseRealm.url),
  new URL("http://localhost:4201/base/")
);

module("loader", function (hooks) {
  let server: Server;

  hooks.beforeEach(async function () {
    let dir = dirSync();
    copySync(join(__dirname, "cards"), dir.name);

    let testRealm = new Realm(
      testRealmHref,
      new NodeAdapter(resolve(dir.name))
    );
    await testRealm.ready;
    server = createRealmServer([testRealm]);
    server.listen(testRealmURL.port);
  });

  hooks.afterEach(function () {
    server.close();
  });

  test("can dynamically load a card from own realm", async function (assert) {
    let loader = Loader.createLoaderFromGlobal();
    let module = await loader.import<Record<string, any>>(
      `${testRealmHref}person`
    );
    let Person = module["Person"];
    let person = Person.fromSerialized({ firstName: "Mango" });
    assert.strictEqual(person.firstName, "Mango", "card data is correct");
  });

  test("can dynamically load a card from a different realm", async function (assert) {
    let loader = Loader.createLoaderFromGlobal();
    let module = await loader.import<Record<string, any>>(
      `${testRealm2Href}person`
    );
    let Person = module["Person"];
    let person = Person.fromSerialized({ firstName: "Mango" });
    assert.strictEqual(person.firstName, "Mango", "card data is correct");
  });

  test("can dynamically modules with cycles", async function (assert) {
    let loader = Loader.createLoaderFromGlobal();
    let module = await loader.import<{ three(): number }>(
      `${testRealm2Href}cycle-two`
    );
    assert.strictEqual(module.three(), 3);
  });

  // this reflects a real world issue where we discovered leaky async in the
  // loader--both catalog-entry and card-ref have an interior dep on card-api
  // that was not always being registered before it was evaluated
  test("can resolve multiple import load races against a common dep", async function (assert) {
    let loader = Loader.createLoaderFromGlobal();
    let catalogEntry = loader.import(
      "https://cardstack.com/base/catalog-entry"
    );
    let cardRef = loader.import("https://cardstack.com/base/card-ref");
    let [catalogEntryModule, cardRefModule] = await Promise.all([
      catalogEntry,
      cardRef,
    ]);
    assert.ok(
      "CatalogEntry" in catalogEntryModule,
      "catalog entry module loaded"
    );
    assert.ok("default" in cardRefModule, "card-ref module loaded");
  });

  test("can instantiate a card that uses a card-ref field", async function (assert) {
    let loader = Loader.createLoaderFromGlobal();
    let module = await loader.import<Record<string, any>>(
      `${testRealm2Href}card-ref-test`
    );
    let TestCard = module["TestCard"];
    let ref = { module: `${testRealm2Href}person`, name: "Person " };
    let testCard = TestCard.fromSerialized({ ref });
    assert.deepEqual(testCard.ref, ref, "card data is correct");
  });

  test("supports import.meta", async function (assert) {
    let loader = new Loader();
    loader.addFileLoader(
      new URL("http://example.com/"),
      async (_localPath) =>
        `export function checkImportMeta() { return import.meta.url }`
    );
    let { checkImportMeta } = await loader.import("http://example.com/foo");
    assert.strictEqual(checkImportMeta(), "http://example.com/foo");
  });
});
