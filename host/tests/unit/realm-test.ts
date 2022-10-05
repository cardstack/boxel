import { module, test } from 'qunit';
import {
  CardRef,
  isCardSingleResourceDocument,
} from '@cardstack/runtime-common/search-index';
import {
  cardSrc,
  compiledCard,
} from '@cardstack/runtime-common/etc/test-fixtures';
import { TestRealm, TestRealmAdapter, testRealmURL } from '../helpers';
import { stringify } from 'qs';
import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

module('Unit | realm', function (hooks) {
  hooks.before(async function () {
    Loader.destroy();
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
  });

  test('realm can serve card data requests', async function (assert) {
    let adapter = new TestRealmAdapter({
      'dir/empty.json': {
        data: {
          attributes: {},
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/card-api',
              name: 'Card',
            },
          },
        },
      },
    });
    let realm = TestRealm.createWithAdapter(adapter);
    await realm.ready;

    let response = await realm.handle(
      new Request(`${testRealmURL}dir/empty`, {
        headers: {
          Accept: 'application/vnd.api+json',
        },
      })
    );

    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();
    assert.deepEqual(json, {
      data: {
        type: 'card',
        id: `${testRealmURL}dir/empty`,
        attributes: {},
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/card-api',
            name: 'Card',
          },
          lastModified: adapter.lastModified.get(
            `${testRealmURL}dir/empty.json`
          ),
        },
        links: {
          self: `${testRealmURL}dir/empty`,
        },
      },
    });
    assert.ok(json.data.meta.lastModified, 'lastModified is populated');
  });

  test("realm can route requests correctly when mounted in the origin's subdir", async function (assert) {
    let realm = TestRealm.create(
      {
        'dir/empty.json': {
          data: {
            attributes: {},
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'Card',
              },
            },
          },
        },
      },
      `${testRealmURL}root/`
    );
    await realm.ready;
    {
      let response = await realm.handle(
        new Request(`${testRealmURL}root/dir/empty`, {
          headers: {
            Accept: 'application/vnd.api+json',
          },
        })
      );
      assert.strictEqual(response.status, 200, 'successful http status');
      let json = await response.json();
      assert.strictEqual(
        json.data.id,
        `${testRealmURL}root/dir/empty`,
        'card ID is correct'
      );
    }
    {
      let response = await realm.handle(
        new Request(`${testRealmURL}root/_search`, {
          headers: {
            Accept: 'application/vnd.api+json',
          },
        })
      );
      let json = await response.json();
      assert.strictEqual(
        json.data.length,
        1,
        'the card is returned in the search results'
      );
      assert.strictEqual(
        json.data[0].id,
        `${testRealmURL}root/dir/empty`,
        'card ID is correct'
      );
    }
  });

  test('realm can serve create card requests', async function (assert) {
    let adapter = new TestRealmAdapter({});
    let realm = TestRealm.createWithAdapter(adapter);
    await realm.ready;
    {
      let response = await realm.handle(
        new Request(testRealmURL, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.api+json',
          },
          body: JSON.stringify(
            {
              data: {
                type: 'card',
                attributes: {},
                meta: {
                  adoptsFrom: {
                    module: 'https://cardstack.com/base/card-api',
                    name: 'Card',
                  },
                },
              },
            },
            null,
            2
          ),
        })
      );
      assert.strictEqual(response.status, 201, 'successful http status');
      let json = await response.json();
      if (isCardSingleResourceDocument(json)) {
        assert.strictEqual(
          json.data.id,
          `${testRealmURL}Card/1`,
          'the id is correct'
        );
        assert.ok(json.data.meta.lastModified, 'lastModified is populated');
        let fileRef = await adapter.openFile('Card/1.json');
        if (!fileRef) {
          throw new Error('file not found');
        }
        assert.deepEqual(
          JSON.parse(fileRef.content as string),
          {
            data: {
              type: 'card',
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: 'https://cardstack.com/base/card-api',
                  name: 'Card',
                },
              },
            },
          },
          'file contents are correct'
        );
      } else {
        assert.ok(false, 'response body is not a card document');
      }

      let searchIndex = realm.searchIndex;
      let card = await searchIndex.card(new URL(json.data.links.self));
      if (card?.type === 'error') {
        throw new Error(
          `unexpected error when getting card from index: ${card.error.message}`
        );
      }
      assert.strictEqual(
        card?.entry.resource.id,
        `${testRealmURL}Card/1`,
        'found card in index'
      );
    }

    // create second file
    {
      let response = await realm.handle(
        new Request(testRealmURL, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.api+json',
          },
          body: JSON.stringify(
            {
              data: {
                type: 'card',
                attributes: {},
                meta: {
                  adoptsFrom: {
                    module: 'https://cardstack.com/base/card-api',
                    name: 'Card',
                  },
                },
              },
            },
            null,
            2
          ),
        })
      );
      assert.strictEqual(response.status, 201, 'successful http status');
      let json = await response.json();
      if (isCardSingleResourceDocument(json)) {
        assert.strictEqual(
          json.data.id,
          `${testRealmURL}Card/2`,
          'the id is correct'
        );
        assert.ok(
          (await adapter.openFile('Card/2.json'))?.content,
          'file contents exist'
        );
      } else {
        assert.ok(false, 'response body is not a card document');
      }

      let searchIndex = realm.searchIndex;
      let card = await searchIndex.card(new URL(json.data.links.self));
      if (card?.type === 'error') {
        throw new Error(
          `unexpected error when getting card from index: ${card.error.message}`
        );
      }
      assert.strictEqual(
        card?.entry.resource.id,
        `${testRealmURL}Card/2`,
        'found card in index'
      );
    }
  });

  test('realm can serve patch card requests', async function (assert) {
    let adapter = new TestRealmAdapter({
      'dir/card.json': {
        data: {
          attributes: {
            firstName: 'Mango',
            lastName: 'Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4201/test/person',
              name: 'Person',
            },
          },
        },
      },
    });
    let realm = TestRealm.createWithAdapter(adapter);
    await realm.ready;
    let response = await realm.handle(
      new Request(`${testRealmURL}dir/card`, {
        method: 'PATCH',
        headers: {
          Accept: 'application/vnd.api+json',
        },
        body: JSON.stringify(
          {
            data: {
              type: 'card',
              attributes: {
                firstName: 'Van Gogh',
              },
              meta: {
                adoptsFrom: {
                  module: 'http://localhost:4201/test/person',
                  name: 'Person',
                },
              },
            },
          },
          null,
          2
        ),
      })
    );
    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();
    if (isCardSingleResourceDocument(json)) {
      assert.strictEqual(
        json.data.id,
        `${testRealmURL}dir/card`,
        'the id is correct'
      );
      assert.strictEqual(
        json.data.attributes?.firstName,
        'Van Gogh',
        'field value is correct'
      );
      assert.strictEqual(
        json.data.attributes?.lastName,
        'Abdel-Rahman',
        'field value is correct'
      );
      assert.strictEqual(
        json.data.meta.lastModified,
        adapter.lastModified.get(`${testRealmURL}dir/card.json`),
        'lastModified is correct'
      );
      let fileRef = await adapter.openFile('dir/card.json');
      if (!fileRef) {
        throw new Error('file not found');
      }
      assert.deepEqual(
        JSON.parse(fileRef.content as string),
        {
          data: {
            type: 'card',
            attributes: {
              firstName: 'Van Gogh',
              lastName: 'Abdel-Rahman',
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4201/test/person',
                name: 'Person',
              },
            },
          },
        },
        'file contents are correct'
      );
    } else {
      assert.ok(false, 'response body is not a card document');
    }

    let searchIndex = realm.searchIndex;
    let card = await searchIndex.card(new URL(json.data.links.self));
    if (card?.type === 'error') {
      throw new Error(
        `unexpected error when getting card from index: ${card.error.message}`
      );
    }
    assert.strictEqual(
      card?.entry.resource.id,
      `${testRealmURL}dir/card`,
      'found card in index'
    );
    assert.strictEqual(
      card?.entry.resource.attributes?.firstName,
      'Van Gogh',
      'field value is correct'
    );
    assert.strictEqual(
      card?.entry.resource.attributes?.lastName,
      'Abdel-Rahman',
      'field value is correct'
    );

    let cards = await searchIndex.search({
      filter: {
        on: { module: `http://localhost:4201/test/person`, name: 'Person' },
        eq: { firstName: 'Van Gogh' },
      },
    });

    assert.strictEqual(cards.length, 1, 'search finds updated value');
  });

  test('realm can serve delete card requests', async function (assert) {
    let adapter = new TestRealmAdapter({
      'cards/1.json': {
        data: {
          attributes: {},
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/card-api',
              name: 'Card',
            },
          },
        },
      },
      'cards/2.json': {
        data: {
          attributes: {},
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/card-api',
              name: 'Card',
            },
          },
        },
      },
    });
    let realm = TestRealm.createWithAdapter(adapter);
    await realm.ready;

    let searchIndex = realm.searchIndex;

    let cards = await searchIndex.search({});
    assert.strictEqual(cards.length, 2, 'two cards found');

    let card = await searchIndex.card(new URL(`${testRealmURL}cards/2`));
    if (card?.type === 'error') {
      throw new Error(
        `unexpected error when getting card from index: ${card.error.message}`
      );
    }
    assert.strictEqual(
      card?.entry.resource.id,
      `${testRealmURL}cards/2`,
      'found card in index'
    );

    let response = await realm.handle(
      new Request(`${testRealmURL}cards/2`, {
        method: 'DELETE',
        headers: {
          Accept: 'application/vnd.api+json',
        },
      })
    );
    assert.strictEqual(response.status, 204, 'status was 204');

    card = await searchIndex.card(new URL(`${testRealmURL}cards/2`));
    assert.strictEqual(card, undefined, 'card was deleted');

    card = await searchIndex.card(new URL(`${testRealmURL}cards/1`));
    if (card?.type === 'error') {
      throw new Error(
        `unexpected error when getting card from index: ${card.error.message}`
      );
    }
    assert.strictEqual(
      card?.entry.resource.id,
      `${testRealmURL}cards/1`,
      'card 1 is still there'
    );

    cards = await searchIndex.search({});
    assert.strictEqual(cards.length, 1, 'only one card remains');
  });

  test('realm can serve card source file', async function (assert) {
    let realm = TestRealm.create({
      'dir/person.gts': cardSrc,
    });
    await realm.ready;
    let response = await realm.handle(
      new Request(`${testRealmURL}dir/person.gts`, {
        headers: {
          Accept: 'application/vnd.card+source',
        },
      })
    );
    assert.strictEqual(response.status, 200, '200 HTTP status');
    let responseText = await response.text();
    assert.strictEqual(responseText, cardSrc, 'the card source is correct');
    assert.ok(
      response.headers.get('last-modified'),
      'last-modified header exists'
    );
  });

  test('realm provide redirect for card source', async function (assert) {
    let realm = TestRealm.create({
      'dir/person.gts': cardSrc,
    });
    await realm.ready;
    let response = await realm.handle(
      new Request(`${testRealmURL}dir/person`, {
        headers: {
          Accept: 'application/vnd.card+source',
        },
      })
    );
    assert.strictEqual(response.status, 302, '302 HTTP status');
    assert.strictEqual(
      response.headers.get('Location'),
      '/dir/person.gts',
      'Location header is correct'
    );
  });

  test('realm returns 404 when no card source can be found', async function (assert) {
    let realm = TestRealm.create({});
    await realm.ready;
    let response = await realm.handle(
      new Request(`${testRealmURL}dir/person`, {
        headers: {
          Accept: 'application/vnd.card+source',
        },
      })
    );
    assert.strictEqual(response.status, 404, '404 HTTP status');
  });

  test('realm can serve card source post request', async function (assert) {
    let adapter = new TestRealmAdapter({});
    let realm = TestRealm.createWithAdapter(adapter);
    await realm.ready;

    {
      let response = await realm.handle(
        new Request(`${testRealmURL}dir/person.gts`, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.card+source',
          },
          body: cardSrc,
        })
      );

      assert.strictEqual(response.status, 204, 'HTTP status is 204');
      assert.ok(
        response.headers.get('last-modified'),
        'last-modified header exists'
      );
    }
    {
      let response = await realm.handle(
        new Request(`${testRealmURL}dir/person.gts`, {
          headers: {
            Accept: 'application/vnd.card+source',
          },
        })
      );
      assert.strictEqual(response.status, 200, '200 HTTP status');
      let responseText = await response.text();
      assert.strictEqual(responseText, cardSrc, 'the card source is correct');
    }
  });

  test('realm can serve card source delete request', async function (assert) {
    let realm = TestRealm.create({
      'person.gts': `
        import { contains, field, Card } from 'https://cardstack.com/base/card-api';
        import StringCard from 'https://cardstack.com/base/string';

        export class Person extends Card {
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
        }
      `,
    });
    await realm.ready;

    let response = await realm.handle(
      new Request(`${testRealmURL}person`, {
        headers: {
          Accept: 'application/vnd.card+source',
        },
      })
    );
    assert.strictEqual(response.status, 302, 'file exists');

    response = await realm.handle(
      new Request(`${testRealmURL}person`, {
        method: 'DELETE',
        headers: {
          Accept: 'application/vnd.card+source',
        },
      })
    );
    assert.strictEqual(response.status, 204, 'file is deleted');

    response = await realm.handle(
      new Request(`${testRealmURL}person`, {
        headers: {
          Accept: 'application/vnd.card+source',
        },
      })
    );
    assert.strictEqual(response.status, 404, 'file no longer exists');
  });

  test('realm can serve compiled js file when requested without file extension ', async function (assert) {
    let realm = TestRealm.create({
      'dir/person.gts': cardSrc,
    });
    await realm.ready;
    let response = await realm.handle(new Request(`${testRealmURL}dir/person`));
    assert.strictEqual(response.status, 200, 'HTTP 200 status code');
    let compiledJS = await response.text();
    assert.strictEqual(compiledJS, compiledCard(), 'compiled card is correct');
  });

  test('realm can serve compiled js file when requested with file extension ', async function (assert) {
    let realm = TestRealm.create({
      'dir/person.gts': cardSrc,
    });
    await realm.ready;
    let response = await realm.handle(
      new Request(`${testRealmURL}dir/person.gts`)
    );
    assert.strictEqual(response.status, 200, 'HTTP 200 status code');
    let compiledJS = await response.text();
    assert.strictEqual(compiledJS, compiledCard(), 'compiled card is correct');
  });

  test('realm can serve file asset (not card source, not js, not JSON-API)', async function (assert) {
    let html = `
      <html>
        <body>
          <h1>Hello World</h1>
        </body>
      </html>
    `.trim();
    let realm = TestRealm.create({
      'dir/index.html': html,
    });
    await realm.ready;
    let response = await realm.handle(
      new Request(`${testRealmURL}dir/index.html`)
    );
    assert.strictEqual(response.status, 200, 'HTTP 200 status code');
    let responseText = await response.text();
    assert.strictEqual(responseText, html, 'asset contents are correct');
  });

  test('realm can serve search requests', async function (assert) {
    let realm = TestRealm.create({
      'dir/empty.json': {
        data: {
          attributes: {},
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/card-api',
              name: 'Card',
            },
          },
        },
      },
    });
    await realm.ready;
    let response = await realm.handle(
      new Request(`${testRealmURL}_search`, {
        headers: {
          Accept: 'application/vnd.api+json',
        },
      })
    );
    let json = await response.json();
    assert.strictEqual(
      json.data.length,
      1,
      'the card is returned in the search results'
    );
    assert.strictEqual(
      json.data[0].id,
      `${testRealmURL}dir/empty`,
      'card ID is correct'
    );
  });

  test('realm can serve directory requests', async function (assert) {
    let realm = TestRealm.create({
      'dir/empty.json': {
        data: {
          attributes: {},
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/card-api',
              name: 'Card',
            },
          },
        },
      },
      'dir/subdir/file.txt': '',
    });
    await realm.ready;
    let response = await realm.handle(
      new Request(`${testRealmURL}dir/`, {
        headers: {
          Accept: 'application/vnd.api+json',
        },
      })
    );
    assert.strictEqual(response.status, 200, 'HTTP 200 status code');
    let json = await response.json();
    assert.deepEqual(
      json,
      {
        data: {
          id: `${testRealmURL}dir/`,
          type: 'directory',
          relationships: {
            'subdir/': {
              links: {
                related: `${testRealmURL}dir/subdir/`,
              },
              meta: {
                kind: 'directory',
              },
            },
            'empty.json': {
              links: {
                related: `${testRealmURL}dir/empty.json`,
              },
              meta: {
                kind: 'file',
              },
            },
          },
        },
      },
      'the directory response is correct'
    );
  });

  test('requests do not contain entries that match patterns in ignore files', async function (assert) {
    const cardSource = `
      import { Card } from 'https://cardstack.com/base/card-api';
      export class Post extends Card {}
    `;

    let realm = TestRealm.create({
      'sample-post.json': '',
      'posts/1.json': '',
      'posts/nested.gts': cardSource,
      'posts/ignore-me.gts': cardSource,
      'posts/2.json': '',
      'post.gts': cardSource,
      'dir/card.gts': cardSource,
      '.gitignore': `
*.json
/dir
posts/ignore-me.gts
`,
    });
    await realm.ready;

    {
      let response = await realm.handle(
        new Request(
          `${testRealmURL}_typeOf?${stringify({
            type: 'exportedCard',
            module: 'posts/ignore-me.gts',
            name: 'Post',
          } as CardRef)}`,
          {
            headers: {
              Accept: 'application/vnd.api+json',
            },
          }
        )
      );

      assert.strictEqual(response.status, 404, 'HTTP 404 response');
    }
    {
      let response = await realm.handle(
        new Request(`${testRealmURL}dir/`, {
          headers: {
            Accept: 'application/vnd.api+json',
          },
        })
      );
      assert.strictEqual(response.status, 404, 'HTTP 404 response');
    }
    {
      let response = await realm.handle(
        new Request(testRealmURL, {
          headers: {
            Accept: 'application/vnd.api+json',
          },
        })
      );

      let json = await response.json();
      assert.deepEqual(
        Object.keys(json.data.relationships).sort(),
        ['.gitignore', 'post.gts', 'posts/'],
        'top level entries are correct'
      );
    }
    {
      let response = await realm.handle(
        new Request(`${testRealmURL}posts/`, {
          headers: {
            Accept: 'application/vnd.api+json',
          },
        })
      );

      let json = await response.json();
      assert.deepEqual(
        Object.keys(json.data.relationships).sort(),
        ['nested.gts'],
        'nested entries are correct'
      );
    }
  });
});
