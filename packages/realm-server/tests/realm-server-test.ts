import { module, test } from 'qunit';
import supertest, { Test, SuperTest } from 'supertest';
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
import {
  localBaseRealm,
  setupCardLogs,
  setupBaseRealmServer,
  runTestRealmServer,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import eventSource from 'eventsource';
import { shimExternals } from '../lib/externals';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import stripScopedCSSGlimmerAttributes from '@cardstack/runtime-common/helpers/strip-scoped-css-glimmer-attributes';

setGracefulCleanup();
const testRealmURL = new URL('http://127.0.0.1:4444/');
const testRealm2URL = new URL('http://127.0.0.1:4445');
const testRealmHref = testRealmURL.href;
const testRealm2Href = testRealm2URL.href;
const distDir = resolve(join(__dirname, '..', '..', 'host', 'dist'));
console.log(`using host dist dir: ${distDir}`);

module('Realm Server', function (hooks) {
  let testRealmServer: Server;
  let testRealmServer2: Server;
  let request: SuperTest<Test>;
  let dir: DirResult;

  let loader = new Loader();
  loader.addURLMapping(new URL(baseRealm.url), new URL(localBaseRealm));
  shimExternals(loader);

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  async function expectEvent<T>(
    assert: Assert,
    expectedContents: Record<string, any>[],
    callback: () => Promise<T>,
  ): Promise<T> {
    let defer = new Deferred<Record<string, any>[]>();
    let events: Record<string, any>[] = [];
    let es = new eventSource(`${testRealmHref}_message`);
    es.addEventListener('index', (ev: MessageEvent) => {
      events.push(JSON.parse(ev.data));
      if (events.length >= expectedContents.length) {
        defer.fulfill(events);
      }
    });
    es.onerror = (err: Event) => defer.reject(err);
    let timeout = setTimeout(() => {
      defer.reject(
        new Error(
          `expectEvent timed out, saw events ${JSON.stringify(events)}`,
        ),
      );
    }, 5000);
    await new Promise((resolve) => es.addEventListener('open', resolve));
    let result = await callback();
    assert.deepEqual(await defer.promise, expectedContents);
    clearTimeout(timeout);
    es.close();
    return result;
  }

  setupBaseRealmServer(hooks, loader);

  hooks.beforeEach(async function () {
    dir = dirSync();
    copySync(join(__dirname, 'cards'), dir.name);

    let testRealmServerLoader = new Loader();
    testRealmServerLoader.addURLMapping(
      new URL(baseRealm.url),
      new URL(localBaseRealm),
    );
    shimExternals(testRealmServerLoader);

    let testRealmServer2Loader = new Loader();
    testRealmServer2Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL(localBaseRealm),
    );
    shimExternals(testRealmServer2Loader);

    testRealmServer = await runTestRealmServer(
      testRealmServerLoader,
      dir.name,
      undefined,
      testRealmURL,
    );
    request = supertest(testRealmServer);

    testRealmServer2 = await runTestRealmServer(
      testRealmServer2Loader,
      dir.name,
      undefined,
      testRealm2URL,
    );
  });

  hooks.afterEach(function () {
    testRealmServer.close();
    testRealmServer2.close();
  });

  test('serves a card GET request', async function (assert) {
    let response = await request
      .get('/person-1')
      .set('Accept', 'application/vnd.card+json');

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    let json = response.body;
    assert.ok(json.data.meta.lastModified, 'lastModified exists');
    delete json.data.meta.lastModified;
    assert.strictEqual(
      response.get('X-boxel-realm-url'),
      testRealmURL.href,
      'realm url header is correct',
    );
    assert.deepEqual(json, {
      data: {
        id: `${testRealmHref}person-1`,
        type: 'card',
        attributes: {
          firstName: 'Mango',
          title: 'Mango',
        },
        meta: {
          adoptsFrom: {
            module: `./person`,
            name: 'Person',
          },
          realmInfo: {
            name: 'Test Realm',
            backgroundURL: null,
            iconURL: null,
          },
          realmURL: testRealmURL.href,
        },
        links: {
          self: `${testRealmHref}person-1`,
        },
      },
    });
  });

  test('serves a card POST request', async function (assert) {
    let expected = [
      {
        type: 'incremental',
        invalidations: [`${testRealmURL}CardDef/1`],
      },
    ];
    let response = await expectEvent(assert, expected, async () => {
      return await request
        .post('/')
        .send({
          data: {
            type: 'card',
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'CardDef',
              },
            },
          },
        })
        .set('Accept', 'application/vnd.card+json');
    });
    assert.strictEqual(response.status, 201, 'HTTP 201 status');
    assert.strictEqual(
      response.get('X-boxel-realm-url'),
      testRealmURL.href,
      'realm url header is correct',
    );
    let json = response.body;

    if (isSingleCardDocument(json)) {
      assert.strictEqual(
        json.data.id,
        `${testRealmHref}CardDef/1`,
        'the id is correct',
      );
      assert.ok(json.data.meta.lastModified, 'lastModified is populated');
      let cardFile = join(dir.name, 'CardDef', '1.json');
      assert.ok(existsSync(cardFile), 'card json exists');
      let card = readJSONSync(cardFile);
      assert.deepEqual(
        card,
        {
          data: {
            attributes: {
              title: null
            },
            type: 'card',
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
        'file contents are correct',
      );
    } else {
      assert.ok(false, 'response body is not a card document');
    }
  });

  test('serves a card PATCH request', async function (assert) {
    let entry = 'person-1.json';
    let expected = [
      {
        type: 'incremental',
        invalidations: [`${testRealmURL}person-1`],
      },
    ];
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
        .set('Accept', 'application/vnd.card+json');
    });

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.strictEqual(
      response.get('X-boxel-realm-url'),
      testRealmURL.href,
      'realm url header is correct',
    );

    let json = response.body;
    assert.ok(json.data.meta.lastModified, 'lastModified exists');
    if (isSingleCardDocument(json)) {
      assert.strictEqual(
        json.data.attributes?.firstName,
        'Van Gogh',
        'the field data is correct',
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
                module: `./person`,
                name: 'Person',
              },
            },
          },
        },
        'file contents are correct',
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
      .set('Accept', 'application/vnd.card+json');

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.strictEqual(response.body.data.length, 1, 'found one card');
  });

  test('serves a card DELETE request', async function (assert) {
    let entry = 'person-1.json';
    let expected = [
      {
        type: 'incremental',
        invalidations: [`${testRealmURL}person-1`],
      },
    ];
    let response = await expectEvent(assert, expected, async () => {
      return await request
        .delete('/person-1')
        .set('Accept', 'application/vnd.card+json');
    });

    assert.strictEqual(response.status, 204, 'HTTP 204 status');
    assert.strictEqual(
      response.get('X-boxel-realm-url'),
      testRealmURL.href,
      'realm url header is correct',
    );
    let cardFile = join(dir.name, entry);
    assert.strictEqual(existsSync(cardFile), false, 'card json does not exist');
  });

  test('serves a card DELETE request with .json extension in the url', async function (assert) {
    let entry = 'person-1.json';
    let expected = [
      {
        type: 'incremental',
        invalidations: [`${testRealmURL}person-1`],
      },
    ];

    let response = await expectEvent(assert, expected, async () => {
      return await request
        .delete('/person-1.json')
        .set('Accept', 'application/vnd.card+json');
    });

    assert.strictEqual(response.status, 204, 'HTTP 204 status');
    assert.strictEqual(
      response.get('X-boxel-realm-url'),
      testRealmURL.href,
      'realm url header is correct',
    );
    let cardFile = join(dir.name, entry);
    assert.strictEqual(existsSync(cardFile), false, 'card json does not exist');
  });

  test('serves a card-source GET request', async function (assert) {
    let response = await request
      .get('/person.gts')
      .set('Accept', 'application/vnd.card+source');

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.strictEqual(
      response.get('X-boxel-realm-url'),
      testRealmURL.href,
      'realm url header is correct',
    );
    let result = response.body.toString().trim();
    assert.strictEqual(result, cardSrc, 'the card source is correct');
    assert.ok(response.headers['last-modified'], 'last-modified header exists');
  });

  test('serves a card-source GET request that results in redirect', async function (assert) {
    let response = await request
      .get('/person')
      .set('Accept', 'application/vnd.card+source');

    assert.strictEqual(response.status, 302, 'HTTP 302 status');
    assert.strictEqual(
      response.get('X-boxel-realm-url'),
      testRealmURL.href,
      'realm url header is correct',
    );
    assert.strictEqual(response.headers['location'], '/person.gts');
  });

  test('serves a card instance GET request with card-source accept header that results in redirect', async function (assert) {
    let response = await request
      .get('/person-1')
      .set('Accept', 'application/vnd.card+source');

    assert.strictEqual(response.status, 302, 'HTTP 302 status');
    assert.strictEqual(
      response.get('X-boxel-realm-url'),
      testRealmURL.href,
      'realm url header is correct',
    );
    assert.strictEqual(response.headers['location'], '/person-1.json');
  });

  test('serves a card instance GET request with a .json extension and json accept header that results in redirect', async function (assert) {
    let response = await request
      .get('/person.json')
      .set('Accept', 'application/vnd.card+json');

    assert.strictEqual(response.status, 302, 'HTTP 302 status');
    assert.strictEqual(
      response.get('X-boxel-realm-url'),
      testRealmURL.href,
      'realm url header is correct',
    );
    assert.strictEqual(response.headers['location'], '/person');
  });

  test('serves a card-source DELETE request', async function (assert) {
    let entry = 'unused-card.gts';
    let expected = [
      {
        type: 'incremental',
        invalidations: [`${testRealmURL}unused-card.gts`],
      },
    ];
    let response = await expectEvent(assert, expected, async () => {
      return await request
        .delete('/unused-card.gts')
        .set('Accept', 'application/vnd.card+source');
    });

    assert.strictEqual(response.status, 204, 'HTTP 204 status');
    assert.strictEqual(
      response.get('X-boxel-realm-url'),
      testRealmURL.href,
      'realm url header is correct',
    );
    let cardFile = join(dir.name, entry);
    assert.strictEqual(
      existsSync(cardFile),
      false,
      'card module does not exist',
    );
  });

  test('serves a card-source DELETE request for a card instance', async function (assert) {
    let entry = 'person-1';
    let expected = [
      {
        type: 'incremental',
        invalidations: [`${testRealmURL}person-1`],
      },
    ];
    let response = await expectEvent(assert, expected, async () => {
      return await request
        .delete('/person-1')
        .set('Accept', 'application/vnd.card+source');
    });

    assert.strictEqual(response.status, 204, 'HTTP 204 status');
    assert.strictEqual(
      response.get('X-boxel-realm-url'),
      testRealmURL.href,
      'realm url header is correct',
    );
    let cardFile = join(dir.name, entry);
    assert.strictEqual(
      existsSync(cardFile),
      false,
      'card instance does not exist',
    );
  });

  test('serves a card-source POST request', async function (assert) {
    let entry = 'unused-card.gts';
    let expected = [
      {
        type: 'incremental',
        invalidations: [`${testRealmURL}unused-card.gts`],
      },
    ];
    let response = await expectEvent(assert, expected, async () => {
      return await request
        .post('/unused-card.gts')
        .set('Accept', 'application/vnd.card+source')
        .send(`//TEST UPDATE\n${cardSrc}`);
    });

    assert.strictEqual(response.status, 204, 'HTTP 204 status');
    assert.strictEqual(
      response.get('X-boxel-realm-url'),
      testRealmURL.href,
      'realm url header is correct',
    );

    let srcFile = join(dir.name, entry);
    assert.ok(existsSync(srcFile), 'card src exists');
    let src = readFileSync(srcFile, { encoding: 'utf8' });
    assert.codeEqual(
      src,
      `//TEST UPDATE
      ${cardSrc}`,
    );
  });

  test('serves a module GET request', async function (assert) {
    let response = await request.get('/person');

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.strictEqual(
      response.get('X-boxel-realm-url'),
      testRealmURL.href,
      'realm URL header is correct',
    );
    let body = response.text.trim();
    let moduleAbsolutePath = resolve(join(__dirname, '..', 'person.gts'));

    // Remove platform-dependent id, from https://github.com/emberjs/babel-plugin-ember-template-compilation/blob/d67cca121cfb3bbf5327682b17ed3f2d5a5af528/__tests__/tests.ts#LL1430C1-L1431C1
    body = stripScopedCSSGlimmerAttributes(
      body.replace(/"id":\s"[^"]+"/, '"id": "<id>"'),
    );

    assert.codeEqual(
      body,
      compiledCard('"<id>"', moduleAbsolutePath),
      'module JS is correct',
    );
  });

  test('serves a directory GET request', async function (assert) {
    let response = await request
      .get('/dir/')
      .set('Accept', 'application/vnd.api+json');

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.strictEqual(
      response.get('X-boxel-realm-url'),
      testRealmURL.href,
      'realm url header is correct',
    );
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
      'the directory response is correct',
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
      .set('Accept', 'application/vnd.card+json');

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.strictEqual(
      response.get('X-boxel-realm-url'),
      testRealmURL.href,
      'realm url header is correct',
    );
    let json = response.body;
    assert.strictEqual(
      json.data.length,
      1,
      'the card is returned in the search results',
    );
    assert.strictEqual(
      json.data[0].id,
      `${testRealmHref}person-1`,
      'card ID is correct',
    );
  });

  test('serves a /_info GET request', async function (assert) {
    let response = await request
      .get(`/_info`)
      .set('Accept', 'application/vnd.api+json');

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.strictEqual(
      response.get('X-boxel-realm-url'),
      testRealmURL.href,
      'realm url header is correct',
    );
    let json = response.body;
    assert.deepEqual(
      json,
      {
        data: {
          id: testRealmHref,
          type: 'realm-info',
          attributes: {
            name: 'Test Realm',
            backgroundURL: null,
            iconURL: null,
          },
        },
      },
      '/_info response is correct',
    );
  });

  test('can dynamically load a card definition from own realm', async function (assert) {
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
    let api = await loader.import<typeof CardAPI>(
      'https://cardstack.com/base/card-api',
    );
    let person = await api.createFromSerialized<any>(
      doc.data,
      doc,
      undefined,
      loader,
    );
    assert.strictEqual(person.firstName, 'Mango', 'card data is correct');
  });

  test('can dynamically load a card definition from a different realm', async function (assert) {
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
    let api = await loader.import<typeof CardAPI>(
      'https://cardstack.com/base/card-api',
    );
    let person = await api.createFromSerialized<any>(
      doc.data,
      doc,
      undefined,
      loader,
    );
    assert.strictEqual(person.firstName, 'Mango', 'card data is correct');
  });

  test('can instantiate a card that uses a code-ref field', async function (assert) {
    let adoptsFrom = {
      module: `${testRealm2Href}code-ref-test`,
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
    let api = await loader.import<typeof CardAPI>(
      'https://cardstack.com/base/card-api',
    );
    let testCard = await api.createFromSerialized<any>(
      doc.data,
      doc,
      undefined,
      loader,
    );
    assert.deepEqual(testCard.ref, ref, 'card data is correct');
  });

  module('BOXEL_HTTP_BASIC_PW env var', function (hooks) {
    hooks.afterEach(function () {
      delete process.env.BOXEL_HTTP_BASIC_PW;
    });

    test('serves a text/html GET request', async function (assert) {
      let response = await request.get('/').set('Accept', 'text/html');
      assert.strictEqual(response.status, 200, 'HTTP 200 status');

      process.env.BOXEL_HTTP_BASIC_PW = '1';

      response = await request.get('/').set('Accept', 'text/html');
      assert.strictEqual(response.status, 401, 'HTTP 401 status');
      assert.strictEqual(
        response.headers['www-authenticate'],
        'Basic realm="Boxel realm server"',
      );

      response = await request
        .get('/')
        .set('Accept', 'text/html')
        .auth('cardstack', 'wrong-password');
      assert.strictEqual(response.status, 401, 'HTTP 401 status');
      assert.strictEqual(
        response.text,
        'Authorization Required',
        'the text returned is correct',
      );
      assert.strictEqual(
        response.headers['www-authenticate'],
        'Basic realm="Boxel realm server"',
      );

      response = await request
        .get('/')
        .set('Accept', 'text/html')
        .auth('cardstack', process.env.BOXEL_HTTP_BASIC_PW);
      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.ok(
        /<script src="\/__boxel\/assets\/vendor.js"><\/script>/.test(
          response.text,
        ),
        'the HTML returned is correct',
      );
    });
  });
});

module('Realm Server serving from root', function (hooks) {
  let testRealmServer: Server;

  let request: SuperTest<Test>;

  let dir: DirResult;

  let loader = new Loader();
  loader.addURLMapping(new URL(baseRealm.url), new URL(localBaseRealm));
  shimExternals(loader);

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  setupBaseRealmServer(hooks, loader);

  hooks.beforeEach(async function () {
    dir = dirSync();
    copySync(join(__dirname, 'cards'), dir.name);

    let testRealmServerLoader = new Loader();
    testRealmServerLoader.addURLMapping(
      new URL(baseRealm.url),
      new URL(localBaseRealm),
    );

    testRealmServer = await runTestRealmServer(
      testRealmServerLoader,
      dir.name,
      undefined,
      testRealmURL,
    );
    request = supertest(testRealmServer);
  });

  hooks.afterEach(function () {
    testRealmServer.close();
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
            'code-ref-test.gts': {
              links: {
                related: `${testRealmHref}code-ref-test.gts`,
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
            'deadlock/': {
              links: {
                related: `${testRealmHref}deadlock/`,
              },
              meta: {
                kind: 'directory',
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
            'home.gts': {
              links: {
                related: `${testRealmHref}home.gts`,
              },
              meta: {
                kind: 'file',
              },
            },
            'index.json': {
              links: {
                related: `${testRealmHref}index.json`,
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
            'person.json': {
              links: {
                related: `${testRealmHref}person.json`,
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
      'the directory response is correct',
    );
  });
});

module('Realm Server serving from a subdirectory', function (hooks) {
  let testRealmServer: Server;

  let request: SuperTest<Test>;

  let dir: DirResult;

  let loader = new Loader();
  loader.addURLMapping(new URL(baseRealm.url), new URL(localBaseRealm));
  shimExternals(loader);

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  setupBaseRealmServer(hooks, loader);

  hooks.beforeEach(async function () {
    dir = dirSync();
    copySync(join(__dirname, 'cards'), dir.name);

    let testRealmServerLoader = new Loader();
    testRealmServerLoader.addURLMapping(
      new URL(baseRealm.url),
      new URL(localBaseRealm),
    );

    testRealmServer = await runTestRealmServer(
      testRealmServerLoader,
      dir.name,
      undefined,
      new URL('http://127.0.0.1:4446/demo/'),
    );

    request = supertest(testRealmServer);
  });

  hooks.afterEach(function () {
    testRealmServer.close();
  });

  test('serves a subdirectory GET request that results in redirect', async function (assert) {
    let response = await request.get('/demo');

    assert.strictEqual(response.status, 302, 'HTTP 302 status');
    assert.strictEqual(
      response.headers['location'],
      'http://127.0.0.1:4446/demo/',
    );
  });

  test('redirection keeps query params intact', async function (assert) {
    let response = await request.get(
      '/demo?operatorModeEnabled=true&operatorModeState=%7B%22stacks%22%3A%5B%7B%22items%22%3A%5B%7B%22card%22%3A%7B%22id%22%3A%22http%3A%2F%2Flocalhost%3A4204%2Findex%22%7D%2C%22format%22%3A%22isolated%22%7D%5D%7D%5D%7D',
    );

    assert.strictEqual(response.status, 302, 'HTTP 302 status');
    assert.strictEqual(
      response.headers['location'],
      'http://127.0.0.1:4446/demo/?operatorModeEnabled=true&operatorModeState=%7B%22stacks%22%3A%5B%7B%22items%22%3A%5B%7B%22card%22%3A%7B%22id%22%3A%22http%3A%2F%2Flocalhost%3A4204%2Findex%22%7D%2C%22format%22%3A%22isolated%22%7D%5D%7D%5D%7D',
    );
  });
});
