import { module, test } from "qunit";
import { Loader } from "@cardstack/runtime-common/loader";

module("loader", function () {
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
