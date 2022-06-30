import { module, test } from 'qunit';
import { isCardDocument } from '@cardstack/runtime-common/search-index';
import { TestRealm, Dir } from '../helpers';

module('Unit | realm', function () {
  test('realm can serve card data requests', async function (assert) {
    let realm = new TestRealm({
      'dir/empty.json': {
        data: {
          type: 'card',
          attributes: {},
          meta: {
            adoptsFrom: {
              module: '//cardstack.com/base/card-api',
              name: 'Card',
            },
          },
        },
      },
    });
    await realm.ready;

    let response = await realm.handle(
      new Request('http://test-realm/dir/empty', {
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
        id: 'http://test-realm/dir/empty',
        attributes: {},
        meta: {
          adoptsFrom: {
            module: '//cardstack.com/base/card-api',
            name: 'Card',
          },
          lastModified: realm.lastModified.get('/dir/empty.json'),
        },
        links: {
          self: 'http://test-realm/dir/empty',
        },
      },
    });
    assert.ok(json.data.meta.lastModified, 'lastModified is populated');
  });

  test('realm can serve create card requests', async function (assert) {
    let realm = new TestRealm({});
    await realm.ready;
    let response = await realm.handle(
      new Request('http://test-realm/', {
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
                  module: '//cardstack.com/base/card-api',
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
    if (isCardDocument(json)) {
      assert.strictEqual(
        json.data.id,
        'http://test-realm/Card/1',
        'the id is correct'
      );
      assert.ok(json.data.meta.lastModified, 'lastModified is populated');
      assert.deepEqual(
        JSON.parse((realm.files?.Card as Dir)?.['1.json'] as string),
        {
          data: {
            type: 'card',
            attributes: {},
            meta: {
              adoptsFrom: {
                module: '//cardstack.com/base/card-api',
                name: 'Card',
              },
            },
          },
        }
      );
    } else {
      assert.ok(false, 'response body is not a card document');
    }

    // try adding a second file after we support incremental search index
    // updates and assert that the new card is created as /Card/2.json

    // TODO also assert that search index is updated
  });

  test('realm can serve patch card requests', async function (assert) {
    let realm = new TestRealm({
      'dir/card.json': {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Mango',
            lastName: 'Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: '//cardstack.com/base/card-api',
              name: 'Card',
            },
          },
        },
      },
    });
    await realm.ready;
    let response = await realm.handle(
      new Request('http://test-realm/dir/card', {
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
                  module: '//cardstack.com/base/card-api',
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
    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();
    if (isCardDocument(json)) {
      assert.strictEqual(
        json.data.id,
        'http://test-realm/dir/card',
        'the id is correct'
      );
      assert.strictEqual(json.data.attributes?.firstName, 'Van Gogh');
      assert.strictEqual(json.data.attributes?.lastName, 'Abdel-Rahman');
      assert.ok(json.data.meta.lastModified, 'lastModified is populated');
      assert.deepEqual(
        JSON.parse((realm.files?.dir as Dir)?.['card.json'] as string),
        {
          data: {
            type: 'card',
            attributes: {
              firstName: 'Van Gogh',
              lastName: 'Abdel-Rahman',
            },
            meta: {
              adoptsFrom: {
                module: '//cardstack.com/base/card-api',
                name: 'Card',
              },
            },
          },
        }
      );
    } else {
      assert.ok(false, 'response body is not a card document');
    }

    // TODO also assert that search index is updated
  });
});
