import { module, test } from "qunit";
import { Loader } from "@cardstack/runtime-common";

const testRealm = "http://localhost:4202/node-test/";

module("loader", function () {
  test("can dynamically modules with cycles", async function (assert) {
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
    loader.addFileLoader(
      new URL("http://example.com/"),
      async (_localPath) =>
        `export function checkImportMeta() { return import.meta.url }`
    );
    let { checkImportMeta } = await loader.import("http://example.com/foo");
    assert.strictEqual(checkImportMeta(), "http://example.com/foo");
  });
});
