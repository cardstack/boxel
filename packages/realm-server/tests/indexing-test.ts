import { module, test } from 'qunit';
import { dirSync, setGracefulCleanup } from 'tmp';
import {
  baseRealm,
  fetcher,
  Loader,
  LooseSingleCardDocument,
  maybeHandleScopedCSSRequest,
  Realm,
  RealmPermissions,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  createRealm,
  localBaseRealm,
  testRealm,
  setupCardLogs,
  setupBaseRealmServer,
  setupDB,
  runTestRealmServer,
  runBaseRealmServer,
} from './helpers';
import isEqual from 'lodash/isEqual';
import { shimExternals } from '../lib/externals';
import stripScopedCSSAttributes from '@cardstack/runtime-common/helpers/strip-scoped-css-attributes';
import { Server } from 'http';

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
  let virtualNetwork = new VirtualNetwork();
  virtualNetwork.addURLMapping(new URL(baseRealm.url), new URL(localBaseRealm));
  shimExternals(virtualNetwork);

  let fetch = fetcher(virtualNetwork.fetch, [
    async (req, next) => {
      return (await maybeHandleScopedCSSRequest(req)) || next(req);
    },
  ]);
  let loader = new Loader(fetch, virtualNetwork.resolveImport);

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let dir: string;
  let realm: Realm;

  setupBaseRealmServer(hooks, virtualNetwork);

  setupDB(hooks, {
    beforeEach: async (dbAdapter, queue) => {
      dir = dirSync().name;
      realm = await createRealm({
        dir,
        virtualNetwork,
        dbAdapter,
        queue,
        fileSystem: {
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
              static embedded = class Isolated extends Component<typeof this> {
                <template>
                  <h1> Embedded Card Person: <@fields.firstName/></h1>

                  <style>
                    h1 { color: red }
                  </style>
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
            import { contains, field, Component } from "https://cardstack.com/base/card-api";
            import StringCard from "https://cardstack.com/base/string";
            import { Person } from "./person";

            export class FancyPerson extends Person {
              @field favoriteColor = contains(StringCard);

              static embedded = class Embedded extends Component<typeof this> {
                <template>
                  <h1> Embedded Card Fancy Person: <@fields.firstName/></h1>

                  <style>
                    h1 { color: pink }
                  </style>
                </template>
              }
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
          'bad-link.json': {
            data: {
              attributes: {
                message: 'I have a bad link',
              },
              relationships: {
                author: {
                  links: {
                    self: 'http://localhost:9000/this-is-a-link-to-nowhere',
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
        },
      });
      await realm.start();
    },
  });

  test('can store card pre-rendered html in the index', async function (assert) {
    let entry = await realm.realmIndexQueryEngine.instance(
      new URL(`${testRealm}mango`),
    );
    if (entry?.type === 'instance') {
      assert.strictEqual(
        trimCardContainer(stripScopedCSSAttributes(entry!.isolatedHtml!)),
        cleanWhiteSpace(`<h1> Mango </h1>`),
        'pre-rendered isolated format html is correct',
      );
      assert.strictEqual(
        trimCardContainer(
          stripScopedCSSAttributes(
            entry!.embeddedHtml![`${testRealm}person/Person`],
          ),
        ),
        cleanWhiteSpace(`<h1> Embedded Card Person: Mango </h1>`),
        'pre-rendered embedded format html is correct',
      );
    } else {
      assert.ok(false, 'expected index entry not to be an error');
    }
  });

  test('can recover from rendering a card that has a template error', async function (assert) {
    {
      let entry = await realm.realmIndexQueryEngine.cardDocument(
        new URL(`${testRealm}boom`),
      );
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
      let entry = await realm.realmIndexQueryEngine.cardDocument(
        new URL(`${testRealm}vangogh`),
      );
      if (entry?.type === 'doc') {
        assert.deepEqual(entry.doc.data.attributes?.firstName, 'Van Gogh');
        let item = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}vangogh`),
        );
        if (item?.type === 'instance') {
          assert.strictEqual(
            trimCardContainer(stripScopedCSSAttributes(item.isolatedHtml!)),
            cleanWhiteSpace(`<h1> Van Gogh </h1>`),
          );
          assert.strictEqual(
            trimCardContainer(
              stripScopedCSSAttributes(
                item.embeddedHtml![`${testRealm}person/Person`]!,
              ),
            ),
            cleanWhiteSpace(`<h1> Embedded Card Person: Van Gogh </h1>`),
          );
        } else {
          assert.ok(false, 'expected index entry not to be an error');
        }
      } else {
        assert.ok(
          false,
          `expected search entry to be a document but was: ${entry?.error.detail}`,
        );
      }
    }
  });

  test('can make an error doc for a card that has a link to a URL that is not a card', async function (assert) {
    let entry = await realm.realmIndexQueryEngine.cardDocument(
      new URL(`${testRealm}bad-link`),
    );
    if (entry?.type === 'error') {
      assert.strictEqual(
        entry.error.detail,
        'unable to fetch http://localhost:9000/this-is-a-link-to-nowhere: fetch failed for http://localhost:9000/this-is-a-link-to-nowhere',
      );
      assert.deepEqual(entry.error.deps, [
        `${testRealm}post`,
        `http://localhost:9000/this-is-a-link-to-nowhere`,
      ]);
    } else {
      assert.ok('false', 'expected search entry to be an error document');
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

    let { data: result } = await realm.realmIndexQueryEngine.search({
      filter: {
        on: { module: `${testRealm}person`, name: 'Person' },
        eq: { firstName: 'Mang-Mang' },
      },
    });
    assert.strictEqual(result.length, 1, 'found updated document');
    assert.ok(
      // assert.deepEqual returns false because despite having the same shape, the constructors are different
      isEqual(realm.realmIndexUpdater.stats, {
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
      isEqual(realm.realmIndexUpdater.stats, {
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
      isEqual(realm.realmIndexUpdater.stats, {
        instancesIndexed: 0,
        instanceErrors: 4, // 1 post, 2 persons, 1 bad-link post
        moduleErrors: 3, // post, fancy person, person
      }),
      'indexed correct number of files',
    );
    let { data: result } = await realm.realmIndexQueryEngine.search({
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
      isEqual(realm.realmIndexUpdater.stats, {
        instancesIndexed: 3, // 1 post and 2 persons
        instanceErrors: 1,
        moduleErrors: 0,
      }),
      'indexed correct number of files',
    );
    result = (
      await realm.realmIndexQueryEngine.search({
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

    let { data: result } = await realm.realmIndexQueryEngine.search({
      filter: {
        on: { module: `${testRealm}person`, name: 'Person' },
        eq: { firstName: 'Mango' },
      },
    });
    assert.strictEqual(result.length, 0, 'found no documents');
    assert.ok(
      // assert.deepEqual returns false because despite having the same shape, the constructors are different
      isEqual(realm.realmIndexUpdater.stats, {
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

    let { data: result } = await realm.realmIndexQueryEngine.search({
      filter: {
        on: { module: `${testRealm}post`, name: 'Post' },
        eq: { nickName: 'Van Gogh-poo' },
      },
    });
    assert.strictEqual(result.length, 1, 'found updated document');
    assert.ok(
      // assert.deepEqual returns false because despite having the same shape, the constructors are different
      isEqual(realm.realmIndexUpdater.stats, {
        instancesIndexed: 1,
        instanceErrors: 1,
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

    let { data: result } = await realm.realmIndexQueryEngine.search({
      filter: {
        on: { module: `${testRealm}post`, name: 'Post' },
        eq: { 'author.nickName': 'Van Gogh-poo' },
      },
    });
    assert.strictEqual(result.length, 1, 'found updated document');
    assert.ok(
      // assert.deepEqual returns false because despite having the same shape, the constructors are different
      isEqual(realm.realmIndexUpdater.stats, {
        instancesIndexed: 3,
        instanceErrors: 1,
        moduleErrors: 0,
      }),
      'indexed correct number of files',
    );
  });

  test('can incrementally index instance that depends on deleted card source', async function (assert) {
    await realm.delete('post.gts');
    {
      let { data: result } = await realm.realmIndexQueryEngine.search({
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
    let actual = await realm.realmIndexQueryEngine.cardDocument(
      new URL(`${testRealm}post-1`),
    );
    if (actual?.type === 'error') {
      assert.ok(actual.error.stack, 'stack trace is included');
      delete actual.error.stack;
      assert.ok(
        // assert.deepEqual returns false because despite having the same shape, the constructors are different
        isEqual(actual, {
          type: 'error',
          error: {
            isCardError: true,
            additionalErrors: null,
            detail: 'http://test-realm/post not found',
            status: 404,
            title: 'Not Found',
            deps: ['http://test-realm/post'],
          },
        }),
        'card instance is an error document',
      );
    } else {
      assert.ok(false, 'search index entry is not an error document');
    }
    assert.ok(
      // assert.deepEqual returns false because despite having the same shape, the constructors are different
      isEqual(realm.realmIndexUpdater.stats, {
        instancesIndexed: 0,
        instanceErrors: 2,
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
      let { data: result } = await realm.realmIndexQueryEngine.search({
        filter: {
          on: { module: `${testRealm}post`, name: 'Post' },
          eq: { nickName: 'Van Gogh-poo' },
        },
      });
      assert.strictEqual(result.length, 1, 'found the post instance');
    }
    assert.ok(
      // assert.deepEqual returns false because despite having the same shape, the constructors are different
      isEqual(realm.realmIndexUpdater.stats, {
        instancesIndexed: 1,
        instanceErrors: 1,
        moduleErrors: 0,
      }),
      'indexed correct number of files',
    );
  });

  test('sets urls containing encoded CSS for deps for a module', async function (assert) {
    let entry = (await realm.realmIndexQueryEngine.module(
      new URL('http://test-realm/fancy-person.gts'),
    )) as { deps: string[] };

    let assertCssDependency = (
      deps: string[],
      pattern: RegExp,
      fileName: string,
    ) => {
      assert.true(
        !!deps.find((dep) => pattern.test(dep)),
        `css for ${fileName} is in the deps`,
      );
    };

    let dependencies = [
      {
        pattern: /fancy-person\.gts.*\.glimmer-scoped\.css$/,
        fileName: 'fancy-person.gts',
      },
      {
        pattern: /test-realm\/person\.gts.*\.glimmer-scoped\.css$/,
        fileName: 'person.gts',
      },
      {
        pattern: /cardstack.com\/base\/card-api\.gts.*\.glimmer-scoped\.css$/,
        fileName: 'card-api.gts',
      },
      {
        pattern:
          /cardstack.com\/base\/links-to-many-component.gts.*\.glimmer-scoped\.css$/,
        fileName: 'links-to-many-component.gts',
      },
      {
        pattern:
          /cardstack.com\/base\/links-to-editor.gts.*\.glimmer-scoped\.css$/,
        fileName: 'links-to-editor.gts',
      },
      {
        pattern:
          /cardstack.com\/base\/contains-many-component.gts.*\.glimmer-scoped\.css$/,
        fileName: 'contains-many-component.gts',
      },
      {
        pattern:
          /cardstack.com\/base\/field-component.gts.*\.glimmer-scoped\.css$/,
        fileName: 'field-component.gts',
      },
    ];

    dependencies.forEach(({ pattern, fileName }) => {
      assertCssDependency(entry.deps, pattern, fileName);
    });
  });
});

module('permissioned realm', function (hooks) {
  let testRealm1URL = new URL('http://127.0.0.1:4447/');
  let testRealm2URL = new URL('http://127.0.0.1:4448/');

  let testRealm2: Realm;
  let testRealmServer1: Server;
  let testRealmServer2: Server;
  let baseRealmServer: Server;
  let virtualNetwork: VirtualNetwork;

  hooks.beforeEach(async function () {
    virtualNetwork = new VirtualNetwork();
    virtualNetwork.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/'),
    );
  });

  function setupRealms(
    hooks: NestedHooks,
    permissions: {
      consumer: RealmPermissions;
      provider: RealmPermissions;
    },
  ) {
    setupDB(hooks, {
      beforeEach: async (dbAdapter, queue) => {
        baseRealmServer = await runBaseRealmServer(
          virtualNetwork,
          queue,
          dbAdapter,
        );
        ({ testRealmServer: testRealmServer1 } = await runTestRealmServer({
          virtualNetwork,
          dir: dirSync().name,
          realmURL: testRealm1URL,
          fileSystem: {
            'article.gts': `
              import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
              import StringCard from "https://cardstack.com/base/string";
              export class Article extends CardDef {
                @field title = contains(StringCard);
              }
            `,
          },
          permissions: permissions.provider,
          matrixConfig: {
            url: new URL(`http://localhost:8008`),
            username: matrixUser1,
            password: 'password',
          },
          dbAdapter,
          queue,
        }));
        ({ testRealmServer: testRealmServer2, testRealm: testRealm2 } =
          await runTestRealmServer({
            virtualNetwork,
            dir: dirSync().name,
            realmURL: testRealm2URL,
            fileSystem: {
              'website.gts': `
                import { contains, field, CardDef, linksTo } from "https://cardstack.com/base/card-api";
                import { Article } from "${testRealm1URL.href}article" // importing from another realm;
                export class Website extends CardDef {
                  @field linkedArticle = linksTo(Article);
                }`,
              'website-1.json': {
                data: {
                  attributes: {},
                  meta: {
                    adoptsFrom: {
                      module: './website',
                      name: 'Website',
                    },
                  },
                },
              },
            },
            permissions: permissions.consumer,
            matrixConfig: {
              url: new URL(`http://localhost:8008`),
              username: matrixUser2,
              password: 'password',
            },
            dbAdapter,
            queue,
          }));
      },
      afterEach: async () => {
        testRealmServer1.close();
        testRealmServer2.close();
        baseRealmServer.close();
      },
    });
  }

  // We want 2 different realm users to test authorization between them - these
  // names are selected because they are already available in the test
  // environment (via register-realm-users.ts)
  let matrixUser1 = 'test_realm';
  let matrixUser2 = 'node-test_realm';

  module('readable realm', function (hooks) {
    setupRealms(hooks, {
      provider: {
        '@node-test_realm:localhost': ['read'],
      },
      consumer: {
        '*': ['read', 'write'],
      },
    });

    test('has no module errors when trying to index a card from another realm when it has permission to read', async function (assert) {
      assert.ok(
        isEqual(testRealm2.realmIndexUpdater.stats, {
          instancesIndexed: 1,
          instanceErrors: 0,
          moduleErrors: 0,
        }),
        'has no module errors',
      );
    });
  });

  module('un-readable realm', function (hooks) {
    setupRealms(hooks, {
      provider: {
        nobody: ['read', 'write'], // Consumer's matrix user not authorized to read from provider
      },
      consumer: {
        '*': ['read', 'write'],
      },
    });

    test('has a module error when trying to index a module from another realm when it has no permission to read', async function (assert) {
      // Error during indexing will be: "Authorization error: Insufficient
      // permissions to perform this action"
      assert.ok(
        isEqual(testRealm2.realmIndexUpdater.stats, {
          instanceErrors: 1,
          instancesIndexed: 0,
          moduleErrors: 1,
        }),
        'has a module error',
      );
    });
  });
});
