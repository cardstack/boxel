import { module, test } from 'qunit';
import { dirSync, setGracefulCleanup } from 'tmp';
import {
  Loader,
  baseRealm,
  LooseSingleCardDocument,
  Realm,
} from '@cardstack/runtime-common';
import {
  createRealm,
  testRealm,
  setupCardLogs,
  setupBaseRealmServer,
  runTestRealmServer,
} from './helpers';
import isEqual from 'lodash/isEqual';
import { shimExternals } from '../lib/externals';
import stripScopedCSSAttributes from '@cardstack/runtime-common/helpers/strip-scoped-css-attributes';

function cleanWhiteSpace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function trimCardContainer(text: string) {
  return cleanWhiteSpace(text).replace(
    /<div .*? data-test-field-component-card>\s?[<!---->]*? (.*?) <\/div>/g,
    '$1',
  );
}

setGracefulCleanup();
// Using the node tests for indexing as it is much easier to support the dynamic
// loading of cards necessary for indexing and the ability to manipulate the
// underlying filesystem in a manner that doesn't leak into other tests (as well
// as to test through loader caching)
module('indexing', function (hooks) {
  let loader = new Loader();
  loader.addURLMapping(
    new URL(baseRealm.url),
    new URL('http://localhost:4201/base/'),
  );
  shimExternals(loader);

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let dir: string;
  let realm: Realm;

  setupBaseRealmServer(hooks, loader);

  hooks.beforeEach(async function () {
    let testRealmLoader = new Loader();
    testRealmLoader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/'),
    );
    shimExternals(testRealmLoader);

    dir = dirSync().name;
    realm = await createRealm(testRealmLoader, dir, {
      'person.gts': `
        import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Person extends CardDef {
          @field firstName = contains(StringCard);
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <h1><@fields.firstName/></h1>
            </template>
          }
        }
      `,
      'pet.gts': `
        import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Pet extends CardDef {
          @field firstName = contains(StringCard);
        }
      `,
      'fancy-person.gts': `
        import { contains, field } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { Person } from "./person";

        export class FancyPerson extends Person {
          @field favoriteColor = contains(StringCard);
        }
      `,
      'post.gts': `
        import { contains, field, linksTo, CardDef, Component } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { Person } from "./person";

        export class Post extends CardDef {
          @field author = linksTo(Person);
          @field message = contains(StringCard);
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <h1><@fields.message/></h1>
              <h2><@fields.author/></h2>
            </template>
          }
        }
      `,
      'boom.gts': `
        import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Boom extends CardDef {
          @field firstName = contains(StringCard);
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <h1><@fields.firstName/>{{this.boom}}</h1>
            </template>
            get boom() {
              throw new Error('intentional error');
            }
          }
        }
      `,
      'mango.json': {
        data: {
          attributes: {
            firstName: 'Mango',
          },
          meta: {
            adoptsFrom: {
              module: './person',
              name: 'Person',
            },
          },
        },
      },
      'vangogh.json': {
        data: {
          attributes: {
            firstName: 'Van Gogh',
          },
          meta: {
            adoptsFrom: {
              module: './person',
              name: 'Person',
            },
          },
        },
      },
      'ringo.json': {
        data: {
          attributes: {
            firstName: 'Ringo',
          },
          meta: {
            adoptsFrom: {
              module: './pet',
              name: 'Pet',
            },
          },
        },
      },
      'post-1.json': {
        data: {
          attributes: {
            message: 'Who wants to fetch?!',
          },
          relationships: {
            author: {
              links: {
                self: './vangogh',
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: './post',
              name: 'Post',
            },
          },
        },
      },
      'boom.json': {
        data: {
          attributes: {
            firstName: 'Boom!',
          },
          meta: {
            adoptsFrom: {
              module: './boom',
              name: 'Boom',
            },
          },
        },
      },
      'empty.json': {
        data: {
          attributes: {},
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/card-api',
              name: 'CardDef',
            },
          },
        },
      },
    });
    await realm.ready;
  });

  test('can store card pre-rendered html in the index', async function (assert) {
    let entry = await realm.searchIndex.searchEntry(
      new URL(`${testRealm}mango`),
    );
    assert.strictEqual(
      trimCardContainer(stripScopedCSSAttributes(entry!.html!)),
      cleanWhiteSpace(`<h1> Mango </h1>`),
      'pre-rendered html is correct',
    );
  });

  test('can recover from rendering a card that has a template error', async function (assert) {
    {
      let entry = await realm.searchIndex.card(new URL(`${testRealm}boom`));
      if (entry?.type === 'error') {
        assert.strictEqual(
          entry.error.detail,
          'Encountered error rendering HTML for card: intentional error',
        );
        assert.deepEqual(entry.error.deps, [`${testRealm}boom`]);
      } else {
        assert.ok('false', 'expected search entry to be an error document');
      }
    }
    {
      let entry = await realm.searchIndex.card(new URL(`${testRealm}vangogh`));
      if (entry?.type === 'doc') {
        assert.deepEqual(entry.doc.data.attributes?.firstName, 'Van Gogh');
        let { html } =
          (await realm.searchIndex.searchEntry(
            new URL(`${testRealm}vangogh`),
          )) ?? {};
        assert.strictEqual(
          trimCardContainer(stripScopedCSSAttributes(html!)),
          cleanWhiteSpace(`<h1> Van Gogh </h1>`),
        );
      } else {
        assert.ok(
          false,
          `expected search entry to be a document but was: ${entry?.error.detail}`,
        );
      }
    }
  });

  test('can incrementally index updated instance', async function (assert) {
    await realm.write(
      'mango.json',
      JSON.stringify({
        data: {
          attributes: {
            firstName: 'Mang-Mang',
          },
          meta: {
            adoptsFrom: {
              module: './person.gts',
              name: 'Person',
            },
          },
        },
      } as LooseSingleCardDocument),
    );

    let { data: result } = await realm.searchIndex.search({
      filter: {
        on: { module: `${testRealm}person`, name: 'Person' },
        eq: { firstName: 'Mang-Mang' },
      },
    });
    assert.strictEqual(result.length, 1, 'found updated document');
    assert.ok(
      // assert.deepEqual returns false because despite having the same shape, the constructors are different
      isEqual(realm.searchIndex.stats, {
        instancesIndexed: 1,
        instanceErrors: 0,
        moduleErrors: 0,
      }),
      'indexed correct number of files',
    );
  });

  test('can recover from a card error after error is removed from card source', async function (assert) {
    // introduce errors into 2 cards and observe that invalidation doesn't
    // blindly invalidate all cards are in an error state
    await realm.write(
      'pet.gts',
      `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import StringCard from "https://cardstack.com/base/string";
          export class Pet extends CardDef {
            @field firstName = contains(StringCard);
          }
          throw new Error('boom!');
        `,
    );
    assert.ok(
      // assert.deepEqual returns false because despite having the same shape, the constructors are different
      isEqual(realm.searchIndex.stats, {
        instancesIndexed: 0,
        instanceErrors: 1,
        moduleErrors: 1,
      }),
      'indexed correct number of files',
    );
    await realm.write(
      'person.gts',
      `
          // syntax error
          export class IntentionallyThrownError {
        `,
    );
    assert.ok(
      // assert.deepEqual returns false because despite having the same shape, the constructors are different
      isEqual(realm.searchIndex.stats, {
        instancesIndexed: 0,
        instanceErrors: 3, // 1 post, 2 persons
        moduleErrors: 3, // post, fancy person, person
      }),
      'indexed correct number of files',
    );
    let { data: result } = await realm.searchIndex.search({
      filter: {
        type: { module: `${testRealm}person`, name: 'Person' },
      },
    });
    assert.deepEqual(
      result,
      [],
      'the broken type results in no instance results',
    );
    await realm.write(
      'person.gts',
      `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import StringCard from "https://cardstack.com/base/string";

          export class Person extends CardDef {
            @field firstName = contains(StringCard);
          }
        `,
    );
    assert.ok(
      // assert.deepEqual returns false because despite having the same shape, the constructors are different
      isEqual(realm.searchIndex.stats, {
        instancesIndexed: 3, // 1 post and 2 persons
        instanceErrors: 0,
        moduleErrors: 0,
      }),
      'indexed correct number of files',
    );
    result = (
      await realm.searchIndex.search({
        filter: {
          type: { module: `${testRealm}person`, name: 'Person' },
        },
      })
    ).data;
    assert.strictEqual(
      result.length,
      2,
      'correct number of instances returned',
    );
  });

  test('can incrementally index deleted instance', async function (assert) {
    await realm.delete('mango.json');

    let { data: result } = await realm.searchIndex.search({
      filter: {
        on: { module: `${testRealm}person`, name: 'Person' },
        eq: { firstName: 'Mango' },
      },
    });
    assert.strictEqual(result.length, 0, 'found no documents');
    assert.ok(
      // assert.deepEqual returns false because despite having the same shape, the constructors are different
      isEqual(realm.searchIndex.stats, {
        instancesIndexed: 0,
        instanceErrors: 0,
        moduleErrors: 0,
      }),
      'index did not touch any files',
    );
  });

  test('can incrementally index instance that depends on updated card source', async function (assert) {
    await realm.write(
      'post.gts',
      `
        import { contains, linksTo, field, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { Person } from "./person";

        export class Post extends CardDef {
          @field author = linksTo(Person);
          @field message = contains(StringCard);
          @field nickName = contains(StringCard, {
            computeVia: function() {
              return this.author.firstName + '-poo';
            }
          })
        }
      `,
    );

    let { data: result } = await realm.searchIndex.search({
      filter: {
        on: { module: `${testRealm}post`, name: 'Post' },
        eq: { nickName: 'Van Gogh-poo' },
      },
    });
    assert.strictEqual(result.length, 1, 'found updated document');
    assert.ok(
      // assert.deepEqual returns false because despite having the same shape, the constructors are different
      isEqual(realm.searchIndex.stats, {
        instancesIndexed: 1,
        instanceErrors: 0,
        moduleErrors: 0,
      }),
      'indexed correct number of files',
    );
  });

  test('can incrementally index instance that depends on updated card source consumed by other card sources', async function (assert) {
    await realm.write(
      'person.gts',
      `
          import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
          import StringCard from "https://cardstack.com/base/string";

          export class Person extends CardDef {
            @field firstName = contains(StringCard);
            @field nickName = contains(StringCard, {
              computeVia: function() {
                return this.firstName + '-poo';
              }
            })
            static embedded = class Embedded extends Component<typeof this> {
              <template><@fields.firstName/> (<@fields.nickName/>)</template>
            }
          }
        `,
    );

    let { data: result } = await realm.searchIndex.search({
      filter: {
        on: { module: `${testRealm}post`, name: 'Post' },
        eq: { 'author.nickName': 'Van Gogh-poo' },
      },
    });
    assert.strictEqual(result.length, 1, 'found updated document');
    assert.ok(
      // assert.deepEqual returns false because despite having the same shape, the constructors are different
      isEqual(realm.searchIndex.stats, {
        instancesIndexed: 3,
        instanceErrors: 0,
        moduleErrors: 0,
      }),
      'indexed correct number of files',
    );
  });

  test('can incrementally index instance that depends on deleted card source', async function (assert) {
    await realm.delete('post.gts');
    {
      let { data: result } = await realm.searchIndex.search({
        filter: {
          type: { module: `${testRealm}post`, name: 'Post' },
        },
      });
      assert.deepEqual(
        result,
        [],
        'the deleted type results in no card instance results',
      );
    }
    let actual = await realm.searchIndex.card(new URL(`${testRealm}post-1`));
    if (actual?.type === 'error') {
      assert.ok(actual.error.stack, 'stack trace is included');
      delete actual.error.stack;
      assert.ok(
        // assert.deepEqual returns false because despite having the same shape, the constructors are different
        isEqual(await realm.searchIndex.card(new URL(`${testRealm}post-1`)), {
          type: 'error',
          error: {
            isCardError: true,
            additionalErrors: null,
            detail: 'http://test-realm/post not found',
            source: undefined,
            status: 404,
            title: 'Not Found',
            deps: ['http://test-realm/post'],
            responseText: undefined,
          },
        }),
        'card instance is an error document',
      );
    } else {
      assert.ok(false, 'search index entry is not an error document');
    }
    assert.ok(
      // assert.deepEqual returns false because despite having the same shape, the constructors are different
      isEqual(realm.searchIndex.stats, {
        instancesIndexed: 0,
        instanceErrors: 1,
        moduleErrors: 0,
      }),
      'indexed correct number of files',
    );

    // when the definitions is created again, the instance should mend its broken link
    await realm.write(
      'post.gts',
      `
        import { contains, linksTo, field, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { Person } from "./person";

        export class Post extends CardDef {
          @field author = linksTo(Person);
          @field message = contains(StringCard);
          @field nickName = contains(StringCard, {
            computeVia: function() {
              return this.author.firstName + '-poo';
            }
          })
        }
      `,
    );
    {
      let { data: result } = await realm.searchIndex.search({
        filter: {
          on: { module: `${testRealm}post`, name: 'Post' },
          eq: { nickName: 'Van Gogh-poo' },
        },
      });
      assert.strictEqual(result.length, 1, 'found the post instance');
    }
    assert.ok(
      // assert.deepEqual returns false because despite having the same shape, the constructors are different
      isEqual(realm.searchIndex.stats, {
        instancesIndexed: 1,
        instanceErrors: 0,
        moduleErrors: 0,
      }),
      'indexed correct number of files',
    );
  });

  // eslint-disable-next-line qunit/no-only
  test('will get an authorization error when trying to index a card from another realm without permissions', async function (assert) {
    let privateTestRealmLoader = new Loader();
    privateTestRealmLoader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/'),
    );
    shimExternals(privateTestRealmLoader);

    await runTestRealmServer(
      privateTestRealmLoader,
      dirSync().name,
      {
        'secret.gts': `
          import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
          import StringCard from "https://cardstack.com/base/string";

          export class Secret extends CardDef {
            @field value = contains(StringCard);
          }
      `,
      },
      new URL('http://127.0.0.1:4445/test'),
      { nobody: ['read', 'write'] },
      {
        url: new URL(`http://localhost:8008`),
        username: 'test_realm',
        password: 'password',
      },
    );

    privateTestRealmLoader.registerURLHandler(realm.maybeHandle.bind(realm));

    await realm.write(
      'secret-retriever.gts',
      `
          import { contains, field, CardDef, linksTo } from "https://cardstack.com/base/card-api";
          import { Secret as SecretCard } from "http://127.0.0.1:4445/test";

          export class SecretRetriever extends CardDef {
            @field secretValue = linksTo(SecretCard);
          }
        `,
    );

    assert.ok(
      isEqual(realm.searchIndex.stats, {
        instancesIndexed: 0,
        instanceErrors: 0,
        moduleErrors: 1,
      }),
      'has a module error',
    );

    let { data: result } = await realm.searchIndex.search({});
  });
});
