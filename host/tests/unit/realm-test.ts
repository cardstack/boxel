import { module, test } from 'qunit';
import { isCardDocument } from '@cardstack/runtime-common/search-index';
import { RealmPaths } from '@cardstack/runtime-common/paths';
import { TestRealm, TestRealmAdapter } from '../helpers';

let paths = new RealmPaths('http://test-realm');

module('Unit | realm', function () {
  test('realm can serve card data requests', async function (assert) {
    let adapter = new TestRealmAdapter({
      'dir/empty.json': {
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
    });
    let realm = TestRealm.createWithAdapter(adapter);
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
            module: 'https://cardstack.com/base/card-api',
            name: 'Card',
          },
          lastModified: adapter.lastModified.get(
            paths.fileURL('dir/empty.json').href
          ),
        },
        links: {
          self: 'http://test-realm/dir/empty',
        },
      },
    });
    assert.ok(json.data.meta.lastModified, 'lastModified is populated');
  });

  test('realm can serve create card requests', async function (assert) {
    let adapter = new TestRealmAdapter({});
    let realm = TestRealm.createWithAdapter(adapter);
    await realm.ready;
    {
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
      if (isCardDocument(json)) {
        assert.strictEqual(
          json.data.id,
          'http://test-realm/Card/1',
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
      assert.strictEqual(
        card?.id,
        'http://test-realm/Card/1',
        'found card in index'
      );
      let dirEntries = await searchIndex.directory(
        new URL('http://test-realm/Card/')
      );
      assert.deepEqual(
        dirEntries,
        [{ name: '1.json', kind: 'file' }],
        'found new file in directory entries'
      );
    }

    // create second file
    {
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
      if (isCardDocument(json)) {
        assert.strictEqual(
          json.data.id,
          'http://test-realm/Card/2',
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
      assert.strictEqual(
        card?.id,
        'http://test-realm/Card/2',
        'found card in index'
      );
      let dirEntries = await searchIndex.directory(
        new URL('http://test-realm/Card/')
      );
      assert.deepEqual(
        dirEntries,
        [
          { name: '1.json', kind: 'file' },
          { name: '2.json', kind: 'file' },
        ],
        'found new file in directory entries'
      );
    }
  });

  test('realm can serve patch card requests', async function (assert) {
    let adapter = new TestRealmAdapter({
      'dir/card.json': {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Mango',
            lastName: 'Abdel-Rahman',
          },
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
    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();
    if (isCardDocument(json)) {
      assert.strictEqual(
        json.data.id,
        'http://test-realm/dir/card',
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
        adapter.lastModified.get(paths.fileURL('dir/card.json').href),
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
    assert.strictEqual(
      card?.id,
      'http://test-realm/dir/card',
      'found card in index'
    );
    assert.strictEqual(
      card?.attributes?.firstName,
      'Van Gogh',
      'field value is correct'
    );
    assert.strictEqual(
      card?.attributes?.lastName,
      'Abdel-Rahman',
      'field value is correct'
    );
    let dirEntries = await searchIndex.directory(
      new URL('http://test-realm/dir/')
    );
    assert.deepEqual(
      dirEntries,
      [{ name: 'card.json', kind: 'file' }],
      'directory entries is correct'
    );
  });

  test('realm can serve card source file', async function (assert) {
    let realm = TestRealm.create({
      'dir/person.gts': cardSrc,
    });
    await realm.ready;
    let response = await realm.handle(
      new Request('http://test-realm/dir/person.gts', {
        headers: {
          Accept: 'application/vnd.card+source',
        },
      })
    );
    assert.strictEqual(response.status, 200, '200 HTTP status');
    let responseText = await response.text();
    assert.strictEqual(responseText, cardSrc, 'the card source is correct');
    assert.ok(
      response.headers.get('Last-Modified'),
      'Last-Modified header exists'
    );
  });

  test('realm provide redirect for card source', async function (assert) {
    let realm = TestRealm.create({
      'dir/person.gts': cardSrc,
    });
    await realm.ready;
    let response = await realm.handle(
      new Request('http://test-realm/dir/person', {
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
      new Request('http://test-realm/dir/person', {
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
        new Request('http://test-realm/dir/person.gts', {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.card+source',
          },
          body: cardSrc,
        })
      );

      assert.strictEqual(response.status, 204, 'HTTP status is 204');
      assert.ok(
        response.headers.get('Last-Modified'),
        'Last-Modified header exists'
      );

      let definition = await realm.searchIndex.typeOf({
        type: 'exportedCard',
        module: 'http://test-realm/dir/person.gts',
        name: 'Person',
      });
      assert.deepEqual(
        definition?.id,
        {
          type: 'exportedCard',
          module: 'http://test-realm/dir/person.gts',
          name: 'Person',
        },
        'the definition id is correct'
      );
      assert.deepEqual(
        definition?.super,
        {
          type: 'exportedCard',
          module: 'https://cardstack.com/base/card-api',
          name: 'Card',
        },
        'super is correct'
      );
      let fields = definition?.fields;
      assert.strictEqual(fields?.size, 1, 'number of fields is correct');
      let field = fields?.get('firstName');
      assert.deepEqual(
        field,
        {
          fieldType: 'contains',
          fieldCard: {
            type: 'exportedCard',
            module: 'https://cardstack.com/base/string',
            name: 'default',
          },
        },
        'the field data is correct'
      );
    }
    {
      let response = await realm.handle(
        new Request('http://test-realm/dir/person.gts', {
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

  test('realm can serve compiled js file when requested without file extension ', async function (assert) {
    let realm = TestRealm.create({
      'dir/person.gts': cardSrc,
    });
    await realm.ready;
    let response = await realm.handle(
      new Request('http://test-realm/dir/person')
    );
    assert.strictEqual(response.status, 200, 'HTTP 200 status code');
    let compiledJS = await response.text();
    assert.strictEqual(compiledJS, compiledCard, 'compiled card is correct');
  });

  test('realm can serve compiled js file when requested with file extension ', async function (assert) {
    let realm = TestRealm.create({
      'dir/person.gts': cardSrc,
    });
    await realm.ready;
    let response = await realm.handle(
      new Request('http://test-realm/dir/person.gts')
    );
    assert.strictEqual(response.status, 200, 'HTTP 200 status code');
    let compiledJS = await response.text();
    assert.strictEqual(compiledJS, compiledCard, 'compiled card is correct');
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
      new Request('http://test-realm/dir/index.html')
    );
    assert.strictEqual(response.status, 200, 'HTTP 200 status code');
    let responseText = await response.text();
    assert.strictEqual(responseText, html, 'asset contents are correct');
  });
});

const cardSrc = `
import { contains, field, Component, Card } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';

export class Person extends Card {
  @field firstName = contains(StringCard);
  static isolated = class Isolated extends Component<typeof this> {
    <template><h1><@fields.firstName/></h1></template>
  }
}
`.trim();
const compiledCard = `
var _class, _descriptor, _class2;

import { createTemplateFactory } from "http://externals/@ember/template-factory";
import { setComponentTemplate } from "http://externals/@ember/component";

function _initializerDefineProperty(target, property, descriptor, context) { if (!descriptor) return; Object.defineProperty(target, property, { enumerable: descriptor.enumerable, configurable: descriptor.configurable, writable: descriptor.writable, value: descriptor.initializer ? descriptor.initializer.call(context) : void 0 }); }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function _applyDecoratedDescriptor(target, property, decorators, descriptor, context) { var desc = {}; Object.keys(descriptor).forEach(function (key) { desc[key] = descriptor[key]; }); desc.enumerable = !!desc.enumerable; desc.configurable = !!desc.configurable; if ('value' in desc || desc.initializer) { desc.writable = true; } desc = decorators.slice().reverse().reduce(function (desc, decorator) { return decorator(target, property, desc) || desc; }, desc); if (context && desc.initializer !== void 0) { desc.value = desc.initializer ? desc.initializer.call(context) : void 0; desc.initializer = undefined; } if (desc.initializer === void 0) { Object.defineProperty(target, property, desc); desc = null; } return desc; }

function _initializerWarningHelper(descriptor, context) { throw new Error('Decorating class property failed. Please ensure that ' + 'proposal-class-properties is enabled and runs after the decorators transform.'); }

import { contains, field, Component, Card } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
export let Person = (_class = (_class2 = class Person extends Card {
  constructor(...args) {
    super(...args);

    _initializerDefineProperty(this, "firstName", _descriptor, this);
  }

}, _defineProperty(_class2, "isolated", setComponentTemplate(createTemplateFactory(
/*
  <h1><@fields.firstName/></h1>
*/
{
  "id": null,
  "block": "[[[10,\\"h1\\"],[12],[8,[30,1,[\\"firstName\\"]],null,null,null],[13]],[\\"@fields\\"],false,[]]",
  "moduleName": "(unknown template module)",
  "isStrictMode": true
}), class Isolated extends Component {})), _class2), (_descriptor = _applyDecoratedDescriptor(_class.prototype, "firstName", [field], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: function () {
    return contains(StringCard);
  }
})), _class);
`.trim();
