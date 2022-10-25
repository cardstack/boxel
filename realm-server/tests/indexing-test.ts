import { module, test } from "qunit";
import { dirSync, setGracefulCleanup } from "tmp";
import {
  Loader,
  baseRealm,
  LooseSingleCardDocument,
  Realm,
} from "@cardstack/runtime-common";
import { createRealm, testRealm } from "./helpers";

setGracefulCleanup();

// Using the node tests for indexing as it is much easier to support the dynamic
// loading of cards necessary for indexing and the ability to manipulate the
// underlying filesystem in a manner that doesn't leak into other tests (as well
// as to test through loader caching)
module("indexing", function (hooks) {
  let dir: string;
  let realm: Realm;

  hooks.beforeEach(async function () {
    Loader.destroy();
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL("http://localhost:4201/base/")
    );
    dir = dirSync().name;

    realm = createRealm(dir, {
      "person.gts": `
        import { contains, field, Card } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Person extends Card {
          @field firstName = contains(StringCard);
        }
      `,
      "pet.gts": `
        import { contains, field, Card } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Pet extends Card {
          @field firstName = contains(StringCard);
        }
      `,
      "fancy-person.gts": `
        import { contains, field, Card } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { Person } from "./person";

        export class FancyPerson extends Person {
          @field favoriteColor = contains(StringCard);
        }
      `,
      "post.gts": `
        import { contains, field, Card } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { Person } from "./person";

        export class Post extends Card {
          @field author = contains(Person);
          @field message = contains(StringCard);
        }
      `,
      "mango.json": {
        data: {
          attributes: {
            firstName: "Mango",
          },
          meta: {
            adoptsFrom: {
              module: "./person",
              name: "Person",
            },
          },
        },
      },
      "vangogh.json": {
        data: {
          attributes: {
            firstName: "Van Gogh",
          },
          meta: {
            adoptsFrom: {
              module: "./person",
              name: "Person",
            },
          },
        },
      },
      "ringo.json": {
        data: {
          attributes: {
            firstName: "Ringo",
          },
          meta: {
            adoptsFrom: {
              module: "./pet",
              name: "Pet",
            },
          },
        },
      },
      "post-1.json": {
        data: {
          attributes: {
            author: {
              firstName: "Van Gogh",
            },
            message: "Who wants to fetch?!",
          },
          meta: {
            adoptsFrom: {
              module: "./post",
              name: "Post",
            },
          },
        },
      },
      "empty.json": {
        data: {
          attributes: {},
          meta: {
            adoptsFrom: {
              module: "https://cardstack.com/base/card-api",
              name: "Card",
            },
          },
        },
      },
    });
    await realm.ready;
  });

  test("can incrementally index updated instance", async function (assert) {
    await realm.write(
      "mango.json",
      JSON.stringify({
        data: {
          attributes: {
            firstName: "Mang-Mang",
          },
          meta: {
            adoptsFrom: {
              module: "./person.gts",
              name: "Person",
            },
          },
        },
      } as LooseSingleCardDocument)
    );

    let { data: result } = await realm.searchIndex.search({
      filter: {
        on: { module: `${testRealm}person`, name: "Person" },
        eq: { firstName: "Mang-Mang" },
      },
    });
    assert.strictEqual(result.length, 1, "found updated document");
    assert.deepEqual(
      realm.searchIndex.stats,
      {
        instancesIndexed: 1,
        instanceErrors: 0,
        moduleErrors: 0,
      },
      "indexed correct number of files"
    );
  });

  test("can recover from a card error after error is removed from card source", async function (assert) {
    // introduce errors into 2 cards and observe that invalidation doesn't
    // blindly invalidate all cards are in an error state
    await realm.write(
      "pet.gts",
      `
          import { contains, field, Card } from "https://cardstack.com/base/card-api";
          import StringCard from "https://cardstack.com/base/string";
          export class Pet extends Card {
            @field firstName = contains(StringCard);
          }
          throw new Error('boom!');
        `
    );
    assert.deepEqual(
      realm.searchIndex.stats,
      {
        instancesIndexed: 0,
        instanceErrors: 1,
        moduleErrors: 1,
      },
      "indexed correct number of files"
    );
    await realm.write(
      "person.gts",
      `
          // syntax error
          export class IntentionallyThrownError {
        `
    );
    assert.deepEqual(
      realm.searchIndex.stats,
      {
        instancesIndexed: 0,
        instanceErrors: 3, // 1 post, 2 persons
        moduleErrors: 3, // post, fancy person, person
      },
      "indexed correct number of files"
    );
    let { data: result } = await realm.searchIndex.search({
      filter: {
        type: { module: `${testRealm}person`, name: "Person" },
      },
    });
    assert.deepEqual(
      result,
      [],
      "the broken type results in no instance results"
    );
    await realm.write(
      "person.gts",
      `
          import { contains, field, Card } from "https://cardstack.com/base/card-api";
          import StringCard from "https://cardstack.com/base/string";

          export class Person extends Card {
            @field firstName = contains(StringCard);
          }
        `
    );
    assert.deepEqual(
      realm.searchIndex.stats,
      {
        instancesIndexed: 3, // 1 post and 2 persons
        instanceErrors: 0,
        moduleErrors: 0,
      },
      "indexed correct number of files"
    );
    result = (
      await realm.searchIndex.search({
        filter: {
          type: { module: `${testRealm}person`, name: "Person" },
        },
      })
    ).data;
    assert.strictEqual(
      result.length,
      2,
      "correct number of instances returned"
    );
  });

  test("can incrementally index deleted instance", async function (assert) {
    await realm.delete("mango.json");

    let { data: result } = await realm.searchIndex.search({
      filter: {
        on: { module: `${testRealm}person`, name: "Person" },
        eq: { firstName: "Mango" },
      },
    });
    assert.strictEqual(result.length, 0, "found no documents");
    assert.deepEqual(
      realm.searchIndex.stats,
      {
        instancesIndexed: 0,
        instanceErrors: 0,
        moduleErrors: 0,
      },
      "index did not touch any files"
    );
  });

  test("can incrementally index instance that depends on updated card source", async function (assert) {
    await realm.write(
      "post.gts",
      `
        import { contains, field, Card } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { Person } from "./person";

        export class Post extends Card {
          @field author = contains(Person);
          @field message = contains(StringCard);
          @field nickName = contains(StringCard, {
            computeVia: function() {
              return this.author.firstName + '-poo';
            }
          })
        }
      `
    );

    let { data: result } = await realm.searchIndex.search({
      filter: {
        on: { module: `${testRealm}post`, name: "Post" },
        eq: { nickName: "Van Gogh-poo" },
      },
    });
    assert.strictEqual(result.length, 1, "found updated document");
    assert.deepEqual(
      realm.searchIndex.stats,
      {
        instancesIndexed: 1,
        instanceErrors: 0,
        moduleErrors: 0,
      },
      "indexed correct number of files"
    );
  });

  test("can incrementally index instance that depends on updated card source consumed by other card sources", async function (assert) {
    await realm.write(
      "person.gts",
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field nickName = contains(StringCard, {
          computeVia: function() {
            return this.firstName + '-poo';
          }
        })
      }
    `
    );

    let { data: result } = await realm.searchIndex.search({
      filter: {
        on: { module: `${testRealm}post`, name: "Post" },
        eq: { "author.nickName": "Van Gogh-poo" },
      },
    });
    assert.strictEqual(result.length, 1, "found updated document");
    assert.deepEqual(
      realm.searchIndex.stats,
      {
        instancesIndexed: 3,
        instanceErrors: 0,
        moduleErrors: 0,
      },
      "indexed correct number of files"
    );
  });

  test("can incrementally index instance that depends on deleted card source", async function (assert) {
    await realm.delete("post.gts");
    {
      let { data: result } = await realm.searchIndex.search({
        filter: {
          type: { module: `${testRealm}post`, name: "Post" },
        },
      });
      assert.deepEqual(
        result,
        [],
        "the deleted type results in no card instance results"
      );
    }
    assert.deepEqual(
      await realm.searchIndex.card(new URL(`${testRealm}post-1`)),
      {
        type: "error",
        error: {
          message:
            "unable to fetch http://test-realm/post (TODO include stack trace)",
          errorReferences: ["http://test-realm/post"],
        },
      },
      "card instance is an error document"
    );
    assert.deepEqual(
      realm.searchIndex.stats,
      {
        instancesIndexed: 0,
        instanceErrors: 1,
        moduleErrors: 0,
      },
      "indexed correct number of files"
    );

    // when the definitions is created again, the instance should mend its broken link
    await realm.write(
      "post.gts",
      `
        import { contains, field, Card } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { Person } from "./person";

        export class Post extends Card {
          @field author = contains(Person);
          @field message = contains(StringCard);
          @field nickName = contains(StringCard, {
            computeVia: function() {
              return this.author.firstName + '-poo';
            }
          })
        }
      `
    );
    {
      let { data: result } = await realm.searchIndex.search({
        filter: {
          on: { module: `${testRealm}post`, name: "Post" },
          eq: { nickName: "Van Gogh-poo" },
        },
      });
      assert.strictEqual(result.length, 1, "found the post instance");
    }
    assert.deepEqual(
      realm.searchIndex.stats,
      {
        instancesIndexed: 1,
        instanceErrors: 0,
        moduleErrors: 0,
      },
      "indexed correct number of files"
    );
  });
});
