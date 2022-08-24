import { module, test } from "qunit";
import { dirSync, setGracefulCleanup } from "tmp";
import {
  Loader,
  baseRealm,
  CardDocument,
  Realm,
} from "@cardstack/runtime-common";
import { createRealm, testRealm } from "./helpers";
import { Unsaved } from "@cardstack/runtime-common/search-index";

setGracefulCleanup();

Loader.addURLMapping(
  new URL(baseRealm.url),
  new URL("http://localhost:4201/base/")
);

// Using the node tests for indexing as it is much easier to support the dynamic
// loading of cards necessary for indexing and the ability to manipulate the
// underlying filesystem in a manner that doesn't leak into other tests (as well
// as to test through loader caching)
module("indexing", function (hooks) {
  let dir: string;
  let realm: Realm;

  hooks.beforeEach(async function () {
    dir = dirSync().name;

    realm = createRealm(dir, {
      "person.gts": `
        import { contains, field, Card } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Person extends Card {
          @field firstName = contains(StringCard);
        }
      `,
      "fancy-person.gts": `
        import { contains, field, Card } from "https://cardstack.com/base/card-api";
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
          id: undefined,
          type: "card",
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
          id: undefined,
          type: "card",
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
      "post-1.json": {
        data: {
          id: undefined,
          type: "card",
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
          id: undefined,
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
    });
    await realm.ready;
  });

  test("can incrementally index updated instance", async function (assert) {
    await realm.write(
      "mango.json",
      JSON.stringify({
        data: {
          id: undefined,
          type: "card",
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
      } as CardDocument<Unsaved>)
    );

    let result = await realm.searchIndex.search({
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
        definitionsBuilt: 0,
        modulesAnalyzed: 0,
        instanceErrors: 0,
        definitionErrors: 0,
      },
      "indexed correct number of files"
    );
  });

  test("can incrementally index deleted instance", async function (assert) {
    await realm.delete("mango.json");

    let result = await realm.searchIndex.search({
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
        definitionsBuilt: 0,
        modulesAnalyzed: 0,
        instanceErrors: 0,
        definitionErrors: 0,
      },
      "index did not touch any files"
    );
  });

  test("can incrementally index updated card source", async function (assert) {
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

    let result = await realm.searchIndex.search({
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
        definitionsBuilt: 1,
        modulesAnalyzed: 1,
        instanceErrors: 0,
        definitionErrors: 0,
      },
      "indexed correct number of files"
    );
  });

  test("can incrementally index updated card source consumed by other card sources", async function (assert) {
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

    let result = await realm.searchIndex.search({
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
        definitionsBuilt: 3,
        modulesAnalyzed: 1,
        instanceErrors: 0,
        definitionErrors: 0,
      },
      "indexed correct number of files"
    );
  });

  test("can incrementally index deleted card source", async function (assert) {
    await realm.delete("post.gts");
    {
      try {
        await realm.searchIndex.search({
          filter: {
            type: { module: `${testRealm}post`, name: "Post" },
          },
        });
        throw new Error(`failed to throw expected exception`);
      } catch (err: any) {
        assert.strictEqual(
          err.message,
          `Your filter refers to nonexistent type: import { Post } from "http://test-realm/post"`
        );
      }
      assert.strictEqual(
        await realm.searchIndex.card(new URL(`${testRealm}post-1`)),
        undefined,
        "card instance does not exist"
      );
      assert.deepEqual(
        realm.searchIndex.stats,
        {
          instancesIndexed: 0,
          definitionsBuilt: 0,
          modulesAnalyzed: 0,
          instanceErrors: 1,
          definitionErrors: 0,
        },
        "indexed correct number of files"
      );
    }

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
      let result = await realm.searchIndex.search({
        filter: {
          on: { module: `${testRealm}post`, name: "Post" },
          eq: { nickName: "Van Gogh-poo" },
        },
      });
      assert.strictEqual(result.length, 1, "found the post instance");
      assert.deepEqual(
        realm.searchIndex.stats,
        {
          instancesIndexed: 1,
          definitionsBuilt: 1,
          modulesAnalyzed: 1,
          instanceErrors: 0,
          definitionErrors: 0,
        },
        "indexed correct number of files"
      );
    }
  });
});
