import { module, test } from 'qunit';
import supertest, { Test, SuperTest } from 'supertest';
import { createRealmServer } from '../server';
import { join, resolve } from 'path';
import { Server } from 'http';
import { dirSync, setGracefulCleanup, DirResult } from 'tmp';
import { copySync, existsSync, readFileSync, readJSONSync } from 'fs-extra';
import {
  cardSrc,
  compiledCard,
} from '@cardstack/runtime-common/etc/test-fixtures';
import {
  isSingleCardDocument,
  Loader,
  baseRealm,
  loadCard,
  Deferred,
} from '@cardstack/runtime-common';
import { stringify } from 'qs';
import { Query } from '@cardstack/runtime-common/query';
import { setupCardLogs, createRealm } from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { shimExternals } from '@cardstack/runtime-common/externals-global';
import eventSource from 'eventsource';

setGracefulCleanup();
const testRealmURL = new URL('http://127.0.0.1:4444/');
const testRealmHref = testRealmURL.href;
const testRealm2Href = 'http://localhost:4202/node-test/';
const distDir = resolve(join(__dirname, '..', '..', 'host', 'dist'));
console.log(`using host dist dir: ${distDir}`);

module('Realm Server', function (hooks) {
  let server: Server;
  let request: SuperTest<Test>;
  let dir: DirResult;
  setupCardLogs(
    hooks,
    async () => await Loader.import(`${baseRealm.url}card-api`)
  );

  async function expectEvent<
    T
  >(assert: Assert, expectedContents: string[], callback: () => Promise<T>): Promise<T> {
    let defer = new Deferred<string[]>();
    let events: string[] = [];
    let es = new eventSource(`${testRealmHref}_message`);
    es.addEventListener('update', (ev: MessageEvent) => {
      events.push(ev.data);
      if (events.length >= expectedContents.length) {
        defer.fulfill(events);
      }
    });
    es.onerror = (err: Event) => defer.reject(err);
    let timeout = setTimeout(() => {
      defer.reject(
        new Error(`expectEvent timed out, saw events ${JSON.stringify(events)}`)
      );
    }, 3000);
    await new Promise((resolve) => es.addEventListener('open', resolve));
    let result = await callback();
    assert.deepEqual(await defer.promise, expectedContents);
    clearTimeout(timeout);
    es.close();
    return result;
  }

  hooks.beforeEach(async function () {
    Loader.destroy();
    shimExternals();
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    dir = dirSync();
    copySync(join(__dirname, 'cards'), dir.name);

    let testRealm = createRealm(dir.name, undefined, testRealmHref);
    await testRealm.ready;
    server = createRealmServer([testRealm]);
    server.listen(testRealmURL.port);
    request = supertest(server);
  });

  hooks.afterEach(function () {
    server.close();
  });

  test('serves a card GET request', async function (assert) {
    let response = await request
      .get('/person-1')
      .set('Accept', 'application/vnd.api+json');

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    let json = response.body;
    assert.ok(json.data.meta.lastModified, 'lastModified exists');
    delete json.data.meta.lastModified;
    assert.deepEqual(json, {
      data: {
        id: `${testRealmHref}person-1`,
        type: 'card',
        attributes: {
          firstName: 'Mango',
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}person`,
            name: 'Person',
          },
        },
        links: {
          self: `${testRealmHref}person-1`,
        },
      },
    });
  });

  test('serves a card POST request', async function (assert) {
    let expected = ['added: Card', 'added: Card/1.json'];
    let response = await expectEvent(assert, expected, async () => {
      return await request
        .post('/')
        .send({
          data: {
            type: 'card',
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'Card',
              },
            },
          },
        })
        .set('Accept', 'application/vnd.api+json');
    });
    assert.strictEqual(response.status, 201, 'HTTP 201 status');
    let json = response.body;

    if (isSingleCardDocument(json)) {
      assert.strictEqual(
        json.data.id,
        `${testRealmHref}Card/1`,
        'the id is correct'
      );
      assert.ok(json.data.meta.lastModified, 'lastModified is populated');
      let cardFile = join(dir.name, 'Card', '1.json');
      assert.ok(existsSync(cardFile), 'card json exists');
      let card = readJSONSync(cardFile);
      assert.deepEqual(
        card,
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
  });

  test('serves a card PATCH request', async function (assert) {
    let entry = 'person-1.json';
    let expected = [`changed: ${entry}`];
    let response = await expectEvent(assert, expected, async () => {
      return await request
        .patch('/person-1')
        .send({
          data: {
            type: 'card',
            attributes: {
              firstName: 'Van Gogh',
            },
            meta: {
              adoptsFrom: {
                module: './person.gts',
                name: 'Person',
              },
            },
          },
        })
        .set('Accept', 'application/vnd.api+json');
    });

    assert.strictEqual(response.status, 200, 'HTTP 200 status');

    let json = response.body;
    assert.ok(json.data.meta.lastModified, 'lastModified exists');
    if (isSingleCardDocument(json)) {
      assert.strictEqual(
        json.data.attributes?.firstName,
        'Van Gogh',
        'the field data is correct'
      );
      assert.ok(json.data.meta.lastModified, 'lastModified is populated');
      delete json.data.meta.lastModified;
      let cardFile = join(dir.name, entry);
      assert.ok(existsSync(cardFile), 'card json exists');
      let card = readJSONSync(cardFile);
      assert.deepEqual(
        card,
        {
          data: {
            type: 'card',
            attributes: {
              firstName: 'Van Gogh',
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmHref}person`,
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

    let query: Query = {
      filter: {
        on: {
          module: `${testRealmHref}person`,
          name: 'Person',
        },
        eq: {
          firstName: 'Van Gogh',
        },
      },
    };

    response = await request
      .get(`/_search?${stringify(query)}`)
      .set('Accept', 'application/vnd.api+json');

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.strictEqual(response.body.data.length, 1, 'found one card');
  });

  test('serves a card DELETE request', async function (assert) {
    let entry = 'person-1.json';
    let expected = [`removed: ${entry}`];
    let response = await expectEvent(assert, expected, async () => {
      return await request
        .delete('/person-1')
        .set('Accept', 'application/vnd.api+json');
    });

    assert.strictEqual(response.status, 204, 'HTTP 204 status');
    let cardFile = join(dir.name, entry);
    assert.strictEqual(existsSync(cardFile), false, 'card json does not exist');
  });

  test('serves a card-source GET request', async function (assert) {
    let response = await request
      .get('/person.gts')
      .set('Accept', 'application/vnd.card+source');

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    let result = response.text.trim();
    assert.strictEqual(result, cardSrc, 'the card source is correct');
    assert.ok(response.headers['last-modified'], 'last-modified header exists');
  });

  test('serves a card-source GET request that results in redirect', async function (assert) {
    let response = await request
      .get('/person')
      .set('Accept', 'application/vnd.card+source');

    assert.strictEqual(response.status, 302, 'HTTP 302 status');
    assert.ok(response.headers['location'], '/person.gts');
  });

  test('serves a card-source DELETE request', async function (assert) {
    let entry = 'unused-card.gts';
    let expected = [`removed: ${entry}`];
    let response = await expectEvent(assert, expected, async () => {
      return await request
        .delete('/unused-card.gts')
        .set('Accept', 'application/vnd.card+source');
    });

    assert.strictEqual(response.status, 204, 'HTTP 204 status');
    let cardFile = join(dir.name, entry);
    assert.strictEqual(
      existsSync(cardFile),
      false,
      'card module does not exist'
    );
  });

  test('serves a card-source POST request', async function (assert) {
    let entry = 'unused-card.gts';
    let expected = [`changed: ${entry}`];
    let response = await expectEvent(assert, expected, async () => {
      return await request
        .post('/unused-card.gts')
        .set('Accept', 'application/vnd.card+source')
        .send(`//TEST UPDATE\n${cardSrc}`);
    });

    assert.strictEqual(response.status, 204, 'HTTP 204 status');

    let srcFile = join(dir.name, entry);
    assert.ok(existsSync(srcFile), 'card src exists');
    let src = readFileSync(srcFile, { encoding: 'utf8' });
    assert.codeEqual(
      src,
      `//TEST UPDATE
      ${cardSrc}`
    );
  });

  test('serves a module GET request', async function (assert) {
    let response = await request.get('/person');

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    let body = response.text.trim();
    assert.codeEqual(
      body,
      compiledCard(`"PRwgdZFk"` /* id that glimmer assigns for the block */),
      'module JS is correct'
    );
  });

  test('serves a directory GET request', async function (assert) {
    let response = await request
      .get('/dir/')
      .set('Accept', 'application/vnd.api+json');

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    let json = response.body;
    assert.deepEqual(
      json,
      {
        data: {
          id: `${testRealmHref}dir/`,
          type: 'directory',
          relationships: {
            'bar.txt': {
              links: {
                related: `${testRealmHref}dir/bar.txt`,
              },
              meta: {
                kind: 'file',
              },
            },
            'foo.txt': {
              links: {
                related: `${testRealmHref}dir/foo.txt`,
              },
              meta: {
                kind: 'file',
              },
            },
            'subdir/': {
              links: {
                related: `${testRealmHref}dir/subdir/`,
              },
              meta: {
                kind: 'directory',
              },
            },
          },
        },
      },
      'the directory response is correct'
    );
  });

  test('serves a /_search GET request', async function (assert) {
    let query: Query = {
      filter: {
        on: {
          module: `${testRealmHref}person`,
          name: 'Person',
        },
        eq: {
          firstName: 'Mango',
        },
      },
    };

    let response = await request
      .get(`/_search?${stringify(query)}`)
      .set('Accept', 'application/vnd.api+json');

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    let json = response.body;
    assert.strictEqual(
      json.data.length,
      1,
      'the card is returned in the search results'
    );
    assert.strictEqual(
      json.data[0].id,
      `${testRealmHref}person-1`,
      'card ID is correct'
    );
  });

  test('can dynamically load a card definition from own realm', async function (assert) {
    let loader = Loader.createLoaderFromGlobal();
    let ref = {
      module: `${testRealmHref}person`,
      name: 'Person',
    };
    await loadCard(ref, { loader });
    let doc = {
      data: {
        attributes: { firstName: 'Mango' },
        meta: { adoptsFrom: ref },
      },
    };
    let api = await loader.import<any>('https://cardstack.com/base/card-api');
    let person = await api.createFromSerialized(doc.data, doc, undefined, {
      loader,
    });
    assert.strictEqual(person.firstName, 'Mango', 'card data is correct');
  });

  test('can dynamically load a card definition from a different realm', async function (assert) {
    let loader = Loader.createLoaderFromGlobal();
    let ref = {
      module: `${testRealm2Href}person`,
      name: 'Person',
    };
    await loadCard(ref, { loader });
    let doc = {
      data: {
        attributes: { firstName: 'Mango' },
        meta: { adoptsFrom: ref },
      },
    };
    let api = await loader.import<any>('https://cardstack.com/base/card-api');
    let person = await api.createFromSerialized(doc.data, doc, undefined, {
      loader,
    });
    assert.strictEqual(person.firstName, 'Mango', 'card data is correct');
  });

  test('can instantiate a card that uses a card-ref field', async function (assert) {
    let loader = Loader.createLoaderFromGlobal();
    let adoptsFrom = {
      module: `${testRealm2Href}card-ref-test`,
      name: 'TestCard',
    };
    await loadCard(adoptsFrom, { loader });
    let ref = { module: `${testRealm2Href}person`, name: 'Person' };
    let doc = {
      data: {
        attributes: { ref },
        meta: { adoptsFrom },
      },
    };
    let api = await loader.import<any>('https://cardstack.com/base/card-api');
    let testCard = await api.createFromSerialized(doc.data, doc, undefined, {
      loader,
    });
    assert.deepEqual(testCard.ref, ref, 'card data is correct');
  });
});

module('Realm Server serving from root', function (hooks) {
  let server: Server;
  let request: SuperTest<Test>;
  let dir: DirResult;
  setupCardLogs(
    hooks,
    async () => await Loader.import(`${baseRealm.url}card-api`)
  );

  hooks.beforeEach(async function () {
    Loader.destroy();
    shimExternals();
    Loader.addURLMapping(
      new URL(baseRealm.url),
      // Note that in order to really support a base realm that is served from
      // the server's origin this will require an update of the host app's
      // ember-cli-build.js, as that has been updated so that the chunk.js files
      // are served from the base realm's /base path.
      new URL('http://localhost:4203/')
    );
    dir = dirSync();
    copySync(join(__dirname, 'cards'), dir.name);

    let testRealm = createRealm(dir.name, undefined, testRealmHref);
    await testRealm.ready;
    server = createRealmServer([testRealm]);
    server.listen(testRealmURL.port);
    request = supertest(server);
  });

  hooks.afterEach(function () {
    server.close();
  });

  test('serves a root directory GET request', async function (assert) {
    let response = await request
      .get('/')
      .set('Accept', 'application/vnd.api+json');

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    let json = response.body;
    assert.deepEqual(
      json,
      {
        data: {
          id: testRealmHref,
          type: 'directory',
          relationships: {
            'a.js': {
              links: {
                related: `${testRealmHref}a.js`,
              },
              meta: {
                kind: 'file',
              },
            },
            'b.js': {
              links: {
                related: `${testRealmHref}b.js`,
              },
              meta: {
                kind: 'file',
              },
            },
            'c.js': {
              links: {
                related: `${testRealmHref}c.js`,
              },
              meta: {
                kind: 'file',
              },
            },
            'card-ref-test.gts': {
              links: {
                related: `${testRealmHref}card-ref-test.gts`,
              },
              meta: {
                kind: 'file',
              },
            },
            'cycle-one.js': {
              links: {
                related: `${testRealmHref}cycle-one.js`,
              },
              meta: {
                kind: 'file',
              },
            },
            'cycle-two.js': {
              links: {
                related: `${testRealmHref}cycle-two.js`,
              },
              meta: {
                kind: 'file',
              },
            },
            'd.js': {
              links: {
                related: `${testRealmHref}d.js`,
              },
              meta: {
                kind: 'file',
              },
            },
            'dir/': {
              links: {
                related: `${testRealmHref}dir/`,
              },
              meta: {
                kind: 'directory',
              },
            },
            'e.js': {
              links: {
                related: `${testRealmHref}e.js`,
              },
              meta: {
                kind: 'file',
              },
            },
            'person-1.json': {
              links: {
                related: `${testRealmHref}person-1.json`,
              },
              meta: {
                kind: 'file',
              },
            },
            'person-2.json': {
              links: {
                related: `${testRealmHref}person-2.json`,
              },
              meta: {
                kind: 'file',
              },
            },
            'person.gts': {
              links: {
                related: `${testRealmHref}person.gts`,
              },
              meta: {
                kind: 'file',
              },
            },
            'unused-card.gts': {
              links: {
                related: `${testRealmHref}unused-card.gts`,
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
});
