import { module, test } from "qunit";
import supertest, { Test, SuperTest } from "supertest";
import { createRealmServer } from "../server";
import { join } from "path";
import { Server } from "http";
import { dirSync, setGracefulCleanup, DirResult } from "tmp";
import { copySync, existsSync, readFileSync, readJSONSync } from "fs-extra";
import {
  cardSrc,
  compiledCard,
} from "@cardstack/runtime-common/etc/test-fixtures";
import {
  CardRef,
  isCardDocument,
  Realm,
  Loader,
} from "@cardstack/runtime-common";
import { stringify } from "qs";
import { NodeRealm } from "../node-realm";

setGracefulCleanup();
const testRealmURL = new URL("http://127.0.0.1:4444/");
const testRealmHref = testRealmURL.href;
const testRealm2Href = "http://localhost:4202/node-test/";

module("Realm Server", function (hooks) {
  let server: Server;
  let request: SuperTest<Test>;
  let dir: DirResult;

  hooks.beforeEach(function () {
    dir = dirSync();
    copySync(join(__dirname, "cards"), dir.name);

    server = createRealmServer(
      [{ path: dir.name, realmURL: testRealmHref }],
      "http://localhost:4201/base/"
    );
    server.listen(testRealmURL.port);
    request = supertest(server);
  });

  hooks.afterEach(function () {
    server.close();
  });

  test("serves a card GET request", async function (assert) {
    let response = await request
      .get("/person-1")
      .set("Accept", "application/vnd.api+json");

    assert.strictEqual(response.status, 200, "HTTP 200 status");
    let json = response.body;
    assert.ok(json.data.meta.lastModified, "lastModified exists");
    delete json.data.meta.lastModified;
    assert.deepEqual(json, {
      data: {
        id: `${testRealmHref}person-1`,
        type: "card",
        attributes: {
          firstName: "Mango",
        },
        meta: {
          adoptsFrom: {
            module: "./person.gts",
            name: "Person",
          },
        },
        links: {
          self: `${testRealmHref}person-1`,
        },
      },
    });
  });

  test("serves a card POST request", async function (assert) {
    let response = await request
      .post("/")
      .send({
        data: {
          type: "card",
          attributes: {},
          meta: {
            adoptsFrom: {
              module: "https://cardstack.com/base/card-api",
              name: "Card",
            },
          },
        },
      })
      .set("Accept", "application/vnd.api+json");
    assert.strictEqual(response.status, 201, "HTTP 201 status");
    let json = response.body;

    if (isCardDocument(json)) {
      assert.strictEqual(
        json.data.id,
        `${testRealmHref}Card/1`,
        "the id is correct"
      );
      assert.ok(json.data.meta.lastModified, "lastModified is populated");
      let cardFile = join(dir.name, "Card", "1.json");
      assert.ok(existsSync(cardFile), "card json exists");
      let card = readJSONSync(cardFile);
      assert.deepEqual(
        card,
        {
          data: {
            type: "card",
            attributes: {},
            meta: {
              adoptsFrom: {
                module: "https://cardstack.com/base/card-api",
                name: "Card",
              },
            },
          },
        },
        "file contents are correct"
      );
    } else {
      assert.ok(false, "response body is not a card document");
    }
  });

  test("serves a card PATCH request", async function (assert) {
    let response = await request
      .patch("/person-1")
      .send({
        data: {
          type: "card",
          attributes: {
            firstName: "Van Gogh",
          },
          meta: {
            adoptsFrom: {
              module: "./person.gts",
              name: "Person",
            },
          },
        },
      })
      .set("Accept", "application/vnd.api+json");

    assert.strictEqual(response.status, 200, "HTTP 200 status");
    let json = response.body;
    assert.ok(json.data.meta.lastModified, "lastModified exists");
    if (isCardDocument(json)) {
      assert.strictEqual(
        json.data.attributes?.firstName,
        "Van Gogh",
        "the field data is correct"
      );
      assert.ok(json.data.meta.lastModified, "lastModified is populated");
      delete json.data.meta.lastModified;
      let cardFile = join(dir.name, "person-1.json");
      assert.ok(existsSync(cardFile), "card json exists");
      let card = readJSONSync(cardFile);
      assert.deepEqual(
        card,
        {
          data: {
            type: "card",
            attributes: {
              firstName: "Van Gogh",
            },
            meta: {
              adoptsFrom: {
                module: "./person.gts",
                name: "Person",
              },
            },
          },
        },
        "file contents are correct"
      );
    } else {
      assert.ok(false, "response body is not a card document");
    }

    response = await request
      .get("/_search?filter[eq][firstName]=Van+Gogh")
      .set("Accept", "application/vnd.api+json");

    assert.strictEqual(response.status, 200, "HTTP 200 status");
    assert.strictEqual(response.body.data.length, 1, "found one card");
  });

  test("serves a card DELETE request", async function (assert) {
    let response = await request
      .delete("/person-1")
      .set("Accept", "application/vnd.api+json");

    assert.strictEqual(response.status, 204, "HTTP 204 status");
    let cardFile = join(dir.name, "person-1.json");
    assert.strictEqual(existsSync(cardFile), false, "card json does not exist");
  });

  test("serves a card-source GET request", async function (assert) {
    let response = await request
      .get("/person.gts")
      .set("Accept", "application/vnd.card+source");

    assert.strictEqual(response.status, 200, "HTTP 200 status");
    let result = response.text.trim();
    assert.strictEqual(result, cardSrc, "the card source is correct");
    assert.ok(response.headers["last-modified"], "last-modified header exists");
  });

  test("serves a card-source GET request that results in redirect", async function (assert) {
    let response = await request
      .get("/person")
      .set("Accept", "application/vnd.card+source");

    assert.strictEqual(response.status, 302, "HTTP 302 status");
    assert.ok(response.headers["location"], "/person.gts");
  });

  test("serves a card-source DELETE request", async function (assert) {
    let response = await request
      .delete("/person.gts")
      .set("Accept", "application/vnd.card+source");

    assert.strictEqual(response.status, 204, "HTTP 204 status");
    let cardFile = join(dir.name, "person.gts");
    assert.strictEqual(
      existsSync(cardFile),
      false,
      "card module does not exist"
    );
  });

  test("serves a card-source POST request", async function (assert) {
    let response = await request
      .post("/person.gts")
      .set("Accept", "application/vnd.card+source")
      .send(`//TEST UPDATE ${cardSrc}`);
    assert.strictEqual(response.status, 204, "HTTP 204 status");

    let srcFile = join(dir.name, "person.gts");
    assert.ok(existsSync(srcFile), "card src exists");
    let src = readFileSync(srcFile, { encoding: "utf8" });
    assert.strictEqual(
      src,
      `//TEST UPDATE ${cardSrc}`,
      "file contents are correct"
    );
  });

  test("serves a module GET request", async function (assert) {
    let response = await request.get("/person");

    assert.strictEqual(response.status, 200, "HTTP 200 status");
    let body = response.text.trim();
    assert.strictEqual(
      body,
      compiledCard(`"bM7Gc0dx"` /* id that glimmer assigns for the block */),
      "module JS is correct"
    );
  });

  test("serves a directory GET request", async function (assert) {
    let response = await request
      .get("/dir/")
      .set("Accept", "application/vnd.api+json");

    assert.strictEqual(response.status, 200, "HTTP 200 status");
    let json = response.body;
    assert.deepEqual(
      json,
      {
        data: {
          id: `${testRealmHref}dir/`,
          type: "directory",
          relationships: {
            "bar.txt": {
              links: {
                related: `${testRealmHref}dir/bar.txt`,
              },
              meta: {
                kind: "file",
              },
            },
            "foo.txt": {
              links: {
                related: `${testRealmHref}dir/foo.txt`,
              },
              meta: {
                kind: "file",
              },
            },
            "subdir/": {
              links: {
                related: `${testRealmHref}dir/subdir/`,
              },
              meta: {
                kind: "directory",
              },
            },
          },
        },
      },
      "the directory response is correct"
    );
  });

  test("serves a /_cardsOf GET request", async function (assert) {
    let response = await request
      .get(`/_cardsOf?${stringify({ module: `${testRealmHref}person` })}`)
      .set("Accept", "application/vnd.api+json");

    assert.strictEqual(response.status, 200, "HTTP 200 status");
    let json = response.body;
    assert.deepEqual(
      json,
      {
        data: {
          type: "module",
          id: `${testRealmHref}person`,
          attributes: {
            cardExports: [
              {
                type: "exportedCard",
                module: `${testRealmHref}person`,
                name: "Person",
              },
            ],
          },
        },
      },
      "cardsOf response is correct"
    );
  });

  test("serves a /_typeOf GET request", async function (assert) {
    let response = await request
      .get(
        `/_typeOf?${stringify({
          type: "exportedCard",
          module: `${testRealmHref}person`,
          name: "Person",
        } as CardRef)}`
      )
      .set("Accept", "application/vnd.api+json");

    assert.strictEqual(response.status, 200, "HTTP 200 status");
    let json = response.body;
    assert.deepEqual(
      json,
      {
        data: {
          id: `${testRealmHref}person/Person`,
          type: "card-definition",
          attributes: {
            cardRef: {
              type: "exportedCard",
              module: `${testRealmHref}person`,
              name: "Person",
            },
          },
          relationships: {
            _super: {
              links: {
                related:
                  "https://cardstack.com/base/_typeOf?type=exportedCard&module=https%3A%2F%2Fcardstack.com%2Fbase%2Fcard-api&name=Card",
              },
              meta: {
                type: "super",
                ref: {
                  type: "exportedCard",
                  module: "https://cardstack.com/base/card-api",
                  name: "Card",
                },
              },
            },
            firstName: {
              links: {
                related:
                  "https://cardstack.com/base/_typeOf?type=exportedCard&module=https%3A%2F%2Fcardstack.com%2Fbase%2Fstring&name=default",
              },
              meta: {
                type: "contains",
                ref: {
                  type: "exportedCard",
                  module: "https://cardstack.com/base/string",
                  name: "default",
                },
              },
            },
          },
        },
      },
      "typeOf response is correct"
    );
  });

  test("serves a /_search GET request", async function (assert) {
    let response = await request
      .get(`/_search?filter[eq][firstName]=Mango`)
      .set("Accept", "application/vnd.api+json");

    assert.strictEqual(response.status, 200, "HTTP 200 status");
    let json = response.body;
    assert.strictEqual(
      json.data.length,
      1,
      "the card is returned in the search results"
    );
    assert.strictEqual(
      json.data[0].id,
      `${testRealmHref}person-1`,
      "card ID is correct"
    );
  });

  test("can dynamically load a card from own realm", async function (assert) {
    let nodeRealm = new NodeRealm(dir.name);
    let realm = new Realm(
      "http://test-realm/",
      nodeRealm,
      "http://localhost:4201/base/"
    );
    await realm.ready;

    let module = await realm.loader.load<Record<string, any>>(
      `${testRealmHref}person`
    );
    let Person = module["Person"];
    let person = Person.fromSerialized({ firstName: "Mango" });
    assert.strictEqual(person.firstName, "Mango", "card data is correct");
  });

  test("can dynamically load a card from a different realm", async function (assert) {
    let module = await Loader.getLoader().load<Record<string, any>>(
      `${testRealm2Href}person`
    );
    let Person = module["Person"];
    let person = Person.fromSerialized({ firstName: "Mango" });
    assert.strictEqual(person.firstName, "Mango", "card data is correct");
  });

  test("can dynamically modules with cycles", async function (assert) {
    let module = await Loader.getLoader().load<{ three(): number }>(
      `${testRealm2Href}cycle-two`
    );
    assert.strictEqual(module.three(), 3);
  });

  test("can instantiate a card that uses a card-ref field", async function (assert) {
    let module = await Loader.getLoader().load<Record<string, any>>(
      `${testRealm2Href}card-ref-test`
    );
    let TestCard = module["TestCard"];
    let ref = { module: `${testRealm2Href}person`, name: "Person " };
    let testCard = TestCard.fromSerialized({ ref });
    assert.deepEqual(testCard.ref, ref, "card data is correct");
  });
});
