import { module, test } from 'qunit';
import { isSingleCardDocument } from '@cardstack/runtime-common/card-document';
import {
  cardSrc,
  compiledCard,
} from '@cardstack/runtime-common/etc/test-fixtures';
import {
  TestRealm,
  TestRealmAdapter,
  testRealmURL,
  setupCardLogs,
  setupMockLocalRealm,
} from '../helpers';
import { setupRenderingTest } from 'ember-qunit';
import { stringify } from 'qs';
import { baseRealm, CardRef, Realm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { shimExternals } from '@cardstack/host/lib/externals';
import { Deferred } from '@cardstack/runtime-common/deferred';

module('Integration | realm', function (hooks) {
  setupRenderingTest(hooks);
  setupMockLocalRealm(hooks);
  setupCardLogs(
    hooks,
    async () => await Loader.import(`${baseRealm.url}card-api`)
  );

  function getUpdateData(message: string) {
    let [type, data] = message.split('\n');
    if (type.trim().split(':')[1].trim() === 'update') {
      return data.split('data:')[1].trim();
    }
    return;
  }

  async function expectEvent<
    T
  >(assert: Assert, realm: Realm, adapter: TestRealmAdapter, expectedContents: string[], callback: () => Promise<T>) {
    let defer = new Deferred<string[]>();
    let events: string[] = [];
    let response = await realm.handle(
      new Request(`${testRealmURL}_message`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
        },
      })
    );
    if (!response.ok) {
      throw new Error(`failed to connect to realm: ${response.status}`);
    }
    let reader = response.body!.getReader();
    let timeout = setTimeout(() => {
      defer.reject(
        new Error(`expectEvent timed out, saw events ${JSON.stringify(events)}`)
      );
    }, 3000);
    let result = await callback();
    let decoder = new TextDecoder();
    while (events.length < expectedContents.length) {
      let { done, value } = await reader.read();
      if (done) {
        throw new Error('expected more events');
      }
      if (value) {
        let data = getUpdateData(decoder.decode(value, { stream: true }));
        if (data) {
          events.push(data);
        }
      }
    }
    assert.deepEqual(events, expectedContents, 'sse response is correct');
    clearTimeout(timeout);
    adapter.unsubscribe();
    return result;
  }

  hooks.beforeEach(async function () {
    Loader.destroy();
    shimExternals();
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
  });

  test('realm can serve GET card requests', async function (assert) {
    let adapter = new TestRealmAdapter({
      'dir/empty.json': {
        data: {
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/card-api',
              name: 'Card',
            },
          },
        },
      },
    });
    let realm = await TestRealm.createWithAdapter(adapter, this.owner);
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

  test('realm can serve GET card requests with linksTo relationships', async function (assert) {
    let adapter = new TestRealmAdapter({
      'dir/owner.json': {
        data: {
          id: `${testRealmURL}dir/owner`,
          attributes: {
            firstName: 'Hassan',
            lastName: 'Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/person',
              name: 'Person',
            },
          },
        },
      },
      'dir/mango.json': {
        data: {
          id: `${testRealmURL}dir/mango`,
          attributes: {
            firstName: 'Mango',
          },
          relationships: {
            owner: {
              links: {
                self: `${testRealmURL}dir/owner`,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/pet',
              name: 'Pet',
            },
          },
        },
      },
    });
    let realm = await TestRealm.createWithAdapter(adapter, this.owner);
    await realm.ready;

    let response = await realm.handle(
      new Request(`${testRealmURL}dir/mango`, {
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
        id: `${testRealmURL}dir/mango`,
        attributes: {
          firstName: 'Mango',
        },
        relationships: {
          owner: {
            links: {
              self: `${testRealmURL}dir/owner`,
            },
            data: {
              type: 'card',
              id: `${testRealmURL}dir/owner`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: 'http://localhost:4202/test/pet',
            name: 'Pet',
          },
          lastModified: adapter.lastModified.get(
            `${testRealmURL}dir/mango.json`
          ),
        },
        links: {
          self: `${testRealmURL}dir/mango`,
        },
      },
      included: [
        {
          type: 'card',
          id: `${testRealmURL}dir/owner`,
          attributes: {
            firstName: 'Hassan',
            lastName: 'Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/person',
              name: 'Person',
            },
            lastModified: adapter.lastModified.get(
              `${testRealmURL}dir/owner.json`
            ),
          },
          links: {
            self: `${testRealmURL}dir/owner`,
          },
        },
      ],
    });
  });

  test('realm can serve GET card requests with linksTo relationships to other realms', async function (assert) {
    let adapter = new TestRealmAdapter({
      'dir/mango.json': {
        data: {
          id: `${testRealmURL}dir/mango`,
          attributes: {
            firstName: 'Mango',
          },
          relationships: {
            owner: {
              links: {
                self: `http://localhost:4202/test/hassan`,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/pet',
              name: 'Pet',
            },
          },
        },
      },
    });
    let realm = await TestRealm.createWithAdapter(adapter, this.owner);
    await realm.ready;

    let response = await realm.handle(
      new Request(`${testRealmURL}dir/mango`, {
        headers: {
          Accept: 'application/vnd.api+json',
        },
      })
    );
    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();
    let { included = [] } = json;
    delete included[0]?.meta.lastModified;
    assert.deepEqual(json, {
      data: {
        type: 'card',
        id: `${testRealmURL}dir/mango`,
        attributes: {
          firstName: 'Mango',
        },
        relationships: {
          owner: {
            links: {
              self: `http://localhost:4202/test/hassan`,
            },
            data: {
              type: 'card',
              id: `http://localhost:4202/test/hassan`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: 'http://localhost:4202/test/pet',
            name: 'Pet',
          },
          lastModified: adapter.lastModified.get(
            `${testRealmURL}dir/mango.json`
          ),
        },
        links: {
          self: `${testRealmURL}dir/mango`,
        },
      },
      included: [
        {
          type: 'card',
          id: `http://localhost:4202/test/hassan`,
          attributes: {
            firstName: 'Hassan',
            lastName: 'Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/person',
              name: 'Person',
            },
          },
          links: {
            self: `http://localhost:4202/test/hassan`,
          },
        },
      ],
    });
  });

  test("realm can route requests correctly when mounted in the origin's subdir", async function (assert) {
    let realm = await TestRealm.create(
      {
        'dir/empty.json': {
          data: {
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'Card',
              },
            },
          },
        },
      },
      this.owner,
      {
        realmURL: `${testRealmURL}root/`,
      }
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
    let realm = await TestRealm.createWithAdapter(adapter, this.owner);
    await realm.ready;
    let expected = ['added: Card/1.json', 'added: Card/2.json'];
    await expectEvent(assert, realm, adapter, expected, async () => {
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
        if (isSingleCardDocument(json)) {
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
        let result = await searchIndex.card(new URL(json.data.links.self));
        if (result?.type === 'error') {
          throw new Error(
            `unexpected error when getting card from index: ${result.error.detail}`
          );
        }
        assert.strictEqual(
          result?.doc.data.id,
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
        if (isSingleCardDocument(json)) {
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
        let result = await searchIndex.card(new URL(json.data.links.self));
        if (result?.type === 'error') {
          throw new Error(
            `unexpected error when getting card from index: ${result.error.detail}`
          );
        }
        assert.strictEqual(
          result?.doc.data.id,
          `${testRealmURL}Card/2`,
          'found card in index'
        );
      }
    });
  });

  test('realm can serve POST requests that include linksTo fields', async function (assert) {
    let adapter = new TestRealmAdapter({
      'dir/owner.json': {
        data: {
          id: `${testRealmURL}dir/owner`,
          attributes: {
            firstName: 'Hassan',
            lastName: 'Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/person',
              name: 'Person',
            },
          },
        },
      },
    });
    let realm = await TestRealm.createWithAdapter(adapter, this.owner);
    await realm.ready;
    let response = await realm.handle(
      new Request(testRealmURL, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.api+json',
        },
        body: JSON.stringify(
          {
            data: {
              attributes: {
                firstName: 'Mango',
              },
              relationships: {
                owner: {
                  links: {
                    self: `${testRealmURL}dir/owner`,
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  module: 'http://localhost:4202/test/pet',
                  name: 'Pet',
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
    assert.deepEqual(json, {
      data: {
        type: 'card',
        id: `${testRealmURL}Pet/1`,
        attributes: {
          firstName: 'Mango',
        },
        relationships: {
          owner: {
            links: {
              self: `${testRealmURL}dir/owner`,
            },
            data: {
              type: 'card',
              id: `${testRealmURL}dir/owner`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: 'http://localhost:4202/test/pet',
            name: 'Pet',
          },
          lastModified: adapter.lastModified.get(`${testRealmURL}Pet/1.json`),
        },
        links: {
          self: `${testRealmURL}Pet/1`,
        },
      },
      included: [
        {
          type: 'card',
          id: `${testRealmURL}dir/owner`,
          attributes: {
            firstName: 'Hassan',
            lastName: 'Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/person',
              name: 'Person',
            },
            lastModified: adapter.lastModified.get(
              `${testRealmURL}dir/owner.json`
            ),
          },
          links: {
            self: `${testRealmURL}dir/owner`,
          },
        },
      ],
    });
    let fileRef = await adapter.openFile('Pet/1.json');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      JSON.parse(fileRef.content as string),
      {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Mango',
          },
          relationships: {
            owner: {
              links: {
                self: `${testRealmURL}dir/owner`,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/pet',
              name: 'Pet',
            },
          },
        },
      },
      'file contents are correct'
    );
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
              module: 'http://localhost:4202/test/person',
              name: 'Person',
            },
          },
        },
      },
    });
    let realm = await TestRealm.createWithAdapter(adapter, this.owner);
    await realm.ready;
    let expected = ['updated: dir/card.json'];
    let response = await expectEvent(
      assert,
      realm,
      adapter,
      expected,
      async () => {
        return await realm.handle(
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
                      module: 'http://localhost:4202/test/person',
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
      }
    );
    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();
    if (isSingleCardDocument(json)) {
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
                module: 'http://localhost:4202/test/person',
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
    let result = await searchIndex.card(new URL(json.data.links.self));
    if (result?.type === 'error') {
      throw new Error(
        `unexpected error when getting card from index: ${result.error.detail}`
      );
    }
    assert.strictEqual(
      result?.doc.data.id,
      `${testRealmURL}dir/card`,
      'found card in index'
    );
    assert.strictEqual(
      result?.doc.data.attributes?.firstName,
      'Van Gogh',
      'field value is correct'
    );
    assert.strictEqual(
      result?.doc.data.attributes?.lastName,
      'Abdel-Rahman',
      'field value is correct'
    );

    let { data: cards } = await searchIndex.search({
      filter: {
        on: { module: `http://localhost:4202/test/person`, name: 'Person' },
        eq: { firstName: 'Van Gogh' },
      },
    });

    assert.strictEqual(cards.length, 1, 'search finds updated value');
  });

  test('realm can remove item from containsMany field via PATCH request', async function (assert) {
    let adapter = new TestRealmAdapter({
      'ski-trip.json': {
        data: {
          attributes: {
            title: 'Gore Mountain Ski Trip',
            venue: 'Gore Mountain',
            startTime: '2023-02-18T10:00:00.000Z',
            endTime: '2023-02-19T02:00:00.000Z',
            hosts: [{ firstName: 'Hassan' }, { firstName: 'Mango' }],
            sponsors: ['Burton', 'Spy Optics'],
            posts: [],
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/booking',
              name: 'Booking',
            },
          },
        },
      },
    });
    let realm = await TestRealm.createWithAdapter(adapter, this.owner);
    await realm.ready;
    let response = await realm.handle(
      new Request(`${testRealmURL}ski-trip`, {
        method: 'PATCH',
        headers: {
          Accept: 'application/vnd.api+json',
        },
        body: JSON.stringify(
          {
            data: {
              type: 'card',
              attributes: {
                hosts: [{ firstName: 'Hassan' }],
                sponsors: ['Burton'],
              },
              meta: {
                adoptsFrom: {
                  module: 'http://localhost:4202/test/booking',
                  name: 'Booking',
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
    assert.deepEqual(json, {
      data: {
        type: 'card',
        id: `${testRealmURL}ski-trip`,
        links: {
          self: `${testRealmURL}ski-trip`,
        },
        attributes: {
          title: 'Gore Mountain Ski Trip',
          venue: 'Gore Mountain',
          startTime: '2023-02-18T10:00:00.000Z',
          endTime: '2023-02-19T02:00:00.000Z',
          hosts: [
            {
              firstName: 'Hassan',
            },
          ],
          sponsors: ['Burton'],
          posts: [],
        },
        meta: {
          adoptsFrom: {
            module: 'http://localhost:4202/test/booking',
            name: 'Booking',
          },
          lastModified: adapter.lastModified.get(
            `${testRealmURL}ski-trip.json`
          ),
        },
      },
    });
    let fileRef = await adapter.openFile('ski-trip.json');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      JSON.parse(fileRef.content as string),
      {
        data: {
          type: 'card',
          attributes: {
            title: 'Gore Mountain Ski Trip',
            venue: 'Gore Mountain',
            startTime: '2023-02-18T10:00:00.000Z',
            endTime: '2023-02-19T02:00:00.000Z',
            hosts: [{ firstName: 'Hassan' }],
            sponsors: ['Burton'],
            posts: [],
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/booking',
              name: 'Booking',
            },
          },
        },
      },
      'file contents are correct'
    );
  });

  test('realm can serve PATCH requests that include linksTo fields', async function (assert) {
    let adapter = new TestRealmAdapter({
      'dir/hassan.json': {
        data: {
          id: `${testRealmURL}dir/hassan`,
          attributes: {
            firstName: 'Hassan',
            lastName: 'Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/person',
              name: 'Person',
            },
          },
        },
      },
      'dir/mariko.json': {
        data: {
          id: `${testRealmURL}dir/mariko`,
          attributes: {
            firstName: 'Mariko',
            lastName: 'Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/person',
              name: 'Person',
            },
          },
        },
      },
      'dir/mango.json': {
        data: {
          id: `${testRealmURL}dir/mango`,
          attributes: {
            firstName: 'Mango',
          },
          relationships: {
            owner: {
              links: {
                self: `${testRealmURL}dir/hassan`,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/pet',
              name: 'Pet',
            },
          },
        },
      },
    });
    let realm = await TestRealm.createWithAdapter(adapter, this.owner);
    await realm.ready;
    let response = await realm.handle(
      new Request(`${testRealmURL}dir/mango`, {
        method: 'PATCH',
        headers: {
          Accept: 'application/vnd.api+json',
        },
        body: JSON.stringify(
          {
            data: {
              type: 'card',
              relationships: {
                owner: {
                  links: {
                    self: `${testRealmURL}dir/mariko`,
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  module: 'http://localhost:4202/test/person',
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
    assert.deepEqual(json, {
      data: {
        type: 'card',
        id: `${testRealmURL}dir/mango`,
        attributes: {
          firstName: 'Mango',
        },
        relationships: {
          owner: {
            links: {
              self: `${testRealmURL}dir/mariko`,
            },
            data: {
              type: 'card',
              id: `${testRealmURL}dir/mariko`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: 'http://localhost:4202/test/pet',
            name: 'Pet',
          },
          lastModified: adapter.lastModified.get(
            `${testRealmURL}dir/mango.json`
          ),
        },
        links: {
          self: `${testRealmURL}dir/mango`,
        },
      },
      included: [
        {
          type: 'card',
          id: `${testRealmURL}dir/mariko`,
          attributes: {
            firstName: 'Mariko',
            lastName: 'Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/person',
              name: 'Person',
            },
            lastModified: adapter.lastModified.get(
              `${testRealmURL}dir/mariko.json`
            ),
          },
          links: {
            self: `${testRealmURL}dir/mariko`,
          },
        },
      ],
    });
    let fileRef = await adapter.openFile('dir/mango.json');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      JSON.parse(fileRef.content as string),
      {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Mango',
          },
          relationships: {
            owner: {
              links: {
                self: `${testRealmURL}dir/mariko`,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/pet',
              name: 'Pet',
            },
          },
        },
      },
      'file contents are correct'
    );
  });

  test('realm can serve delete card requests', async function (assert) {
    let adapter = new TestRealmAdapter({
      'cards/1.json': {
        data: {
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
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/card-api',
              name: 'Card',
            },
          },
        },
      },
    });
    let realm = await TestRealm.createWithAdapter(adapter, this.owner);
    await realm.ready;

    let searchIndex = realm.searchIndex;

    let { data: cards } = await searchIndex.search({});
    assert.strictEqual(cards.length, 2, 'two cards found');

    let result = await searchIndex.card(new URL(`${testRealmURL}cards/2`));
    if (result?.type === 'error') {
      throw new Error(
        `unexpected error when getting card from index: ${result.error.detail}`
      );
    }
    assert.strictEqual(
      result?.doc.data.id,
      `${testRealmURL}cards/2`,
      'found card in index'
    );

    let expected = ['removed: cards/2.json'];
    let response = await expectEvent(
      assert,
      realm,
      adapter,
      expected,
      async () => {
        return await realm.handle(
          new Request(`${testRealmURL}cards/2`, {
            method: 'DELETE',
            headers: {
              Accept: 'application/vnd.api+json',
            },
          })
        );
      }
    );
    assert.strictEqual(response.status, 204, 'status was 204');

    result = await searchIndex.card(new URL(`${testRealmURL}cards/2`));
    assert.strictEqual(result, undefined, 'card was deleted');

    result = await searchIndex.card(new URL(`${testRealmURL}cards/1`));
    if (result?.type === 'error') {
      throw new Error(
        `unexpected error when getting card from index: ${result.error.detail}`
      );
    }
    assert.strictEqual(
      result?.doc.data.id,
      `${testRealmURL}cards/1`,
      'card 1 is still there'
    );

    cards = (await searchIndex.search({})).data;
    assert.strictEqual(cards.length, 1, 'only one card remains');
  });

  test('realm can serve card source file', async function (assert) {
    let realm = await TestRealm.create(
      {
        'dir/person.gts': cardSrc,
      },
      this.owner
    );
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
    let realm = await TestRealm.create(
      {
        'dir/person.gts': cardSrc,
      },
      this.owner
    );
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
      '/test/dir/person.gts',
      'Location header is correct'
    );
  });

  test('realm returns 404 when no card source can be found', async function (assert) {
    let realm = await TestRealm.create({}, this.owner);
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
    let realm = await TestRealm.createWithAdapter(adapter, this.owner);
    await realm.ready;

    {
      let expected = ['added: dir/person.gts'];
      let response = await expectEvent(
        assert,
        realm,
        adapter,
        expected,
        async () => {
          return await realm.handle(
            new Request(`${testRealmURL}dir/person.gts`, {
              method: 'POST',
              headers: {
                Accept: 'application/vnd.card+source',
              },
              body: cardSrc,
            })
          );
        }
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
    let adapter = new TestRealmAdapter({
      'person.gts': `
      import { contains, field, Card } from 'https://cardstack.com/base/card-api';
      import StringCard from 'https://cardstack.com/base/string';

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
      }
    `,
    });
    let realm = await TestRealm.createWithAdapter(adapter, this.owner);
    await realm.ready;

    let expected = ['removed: person.gts'];
    let response = await expectEvent(
      assert,
      realm,
      adapter,
      expected,
      async () => {
        let response = await realm.handle(
          new Request(`${testRealmURL}person`, {
            headers: {
              Accept: 'application/vnd.card+source',
            },
          })
        );
        assert.strictEqual(response.status, 302, 'file exists');

        return await realm.handle(
          new Request(`${testRealmURL}person`, {
            method: 'DELETE',
            headers: {
              Accept: 'application/vnd.card+source',
            },
          })
        );
      }
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
    let realm = await TestRealm.create(
      {
        'dir/person.gts': cardSrc,
      },
      this.owner
    );
    await realm.ready;
    let response = await realm.handle(new Request(`${testRealmURL}dir/person`));
    assert.strictEqual(response.status, 200, 'HTTP 200 status code');
    let compiledJS = await response.text();
    assert.codeEqual(compiledJS, compiledCard(), 'compiled card is correct');
  });

  test('realm can serve compiled js file when requested with file extension ', async function (assert) {
    let realm = await TestRealm.create(
      {
        'dir/person.gts': cardSrc,
      },
      this.owner
    );
    await realm.ready;
    let response = await realm.handle(
      new Request(`${testRealmURL}dir/person.gts`)
    );
    assert.strictEqual(response.status, 200, 'HTTP 200 status code');
    let compiledJS = await response.text();
    assert.codeEqual(compiledJS, compiledCard(), 'compiled card is correct');
  });

  test('realm can serve file asset (not card source, not js, not JSON-API)', async function (assert) {
    let html = `
      <html>
        <body>
          <h1>Hello World</h1>
        </body>
      </html>
    `.trim();
    let realm = await TestRealm.create(
      {
        'dir/index.html': html,
      },
      this.owner
    );
    await realm.ready;
    let response = await realm.handle(
      new Request(`${testRealmURL}dir/index.html`)
    );
    assert.strictEqual(response.status, 200, 'HTTP 200 status code');
    let responseText = await response.text();
    assert.strictEqual(responseText, html, 'asset contents are correct');
  });

  test('realm can serve search requests', async function (assert) {
    let realm = await TestRealm.create(
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
      this.owner
    );
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

  test('realm can serve search requests whose results have linksTo fields', async function (assert) {
    let adapter = new TestRealmAdapter({
      'dir/mariko.json': {
        data: {
          id: `${testRealmURL}dir/mariko`,
          attributes: {
            firstName: 'Mariko',
            lastName: 'Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/person',
              name: 'Person',
            },
          },
        },
      },
      'dir/mango.json': {
        data: {
          id: `${testRealmURL}dir/mango`,
          attributes: {
            firstName: 'Mango',
          },
          relationships: {
            owner: {
              links: {
                self: `${testRealmURL}dir/mariko`,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/pet',
              name: 'Pet',
            },
          },
        },
      },
      'dir/vanGogh.json': {
        data: {
          id: `${testRealmURL}dir/vanGogh`,
          attributes: {
            firstName: 'Van Gogh',
          },
          relationships: {
            owner: {
              links: {
                self: `http://localhost:4202/test/hassan`,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/pet',
              name: 'Pet',
            },
          },
        },
      },
    });
    let realm = await TestRealm.createWithAdapter(adapter, this.owner);
    await realm.ready;

    let response = await realm.handle(
      new Request(
        `${testRealmURL}_search?${stringify({
          sort: [
            {
              by: 'id',
              on: { module: `${baseRealm.url}card-api`, name: 'Card' },
            },
          ],
        })}`,
        {
          headers: {
            Accept: 'application/vnd.api+json',
          },
        }
      )
    );
    let json = await response.json();
    delete json.included?.[0].meta.lastModified;
    assert.deepEqual(json, {
      data: [
        {
          type: 'card',
          id: `${testRealmURL}dir/mango`,
          attributes: {
            firstName: 'Mango',
          },
          relationships: {
            owner: {
              links: {
                self: `${testRealmURL}dir/mariko`,
              },
              data: {
                type: 'card',
                id: `${testRealmURL}dir/mariko`,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/pet',
              name: 'Pet',
            },
            lastModified: adapter.lastModified.get(
              `${testRealmURL}dir/mango.json`
            ),
          },
          links: {
            self: `${testRealmURL}dir/mango`,
          },
        },
        {
          type: 'card',
          id: `${testRealmURL}dir/mariko`,
          attributes: {
            firstName: 'Mariko',
            lastName: 'Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/person',
              name: 'Person',
            },
            lastModified: adapter.lastModified.get(
              `${testRealmURL}dir/mariko.json`
            ),
          },
          links: {
            self: `${testRealmURL}dir/mariko`,
          },
        },
        {
          type: 'card',
          id: `${testRealmURL}dir/vanGogh`,
          attributes: {
            firstName: 'Van Gogh',
          },
          relationships: {
            owner: {
              links: {
                self: `http://localhost:4202/test/hassan`,
              },
              data: {
                type: 'card',
                id: `http://localhost:4202/test/hassan`,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/pet',
              name: 'Pet',
            },
            lastModified: adapter.lastModified.get(
              `${testRealmURL}dir/vanGogh.json`
            ),
          },
          links: {
            self: `${testRealmURL}dir/vanGogh`,
          },
        },
      ],
      included: [
        {
          type: 'card',
          id: `http://localhost:4202/test/hassan`,
          attributes: {
            firstName: 'Hassan',
            lastName: 'Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/person',
              name: 'Person',
            },
          },
          links: {
            self: `http://localhost:4202/test/hassan`,
          },
        },
      ],
    });
  });

  test('realm can serve directory requests', async function (assert) {
    let realm = await TestRealm.create(
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
        'dir/subdir/file.txt': '',
      },
      this.owner
    );
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

    let realm = await TestRealm.create(
      {
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
      },
      this.owner
    );
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
