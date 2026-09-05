import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import type { Type } from '@cardstack/host/services/card-type-service';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

import type { BaseDef } from '@cardstack/base/card-api';

const COLORISH_FIELD_COUNT = 8;

module('Integration | services | card-type-service', function (hooks) {
  let requestLog: string[] = [];
  // When set, the recorder answers the next request whose URL starts with this
  // prefix with a 500 instead of passing it through.
  let failNextRequestTo: string | undefined;

  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });
  setupBaseRealm(hooks);

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'colorish.gts': `
          import StringField from 'https://cardstack.com/base/string';
          export default class ColorishField extends StringField {
            static displayName = 'Colorish';
          }
        `,
        'theme.gts': `
          import { contains, field, FieldDef } from 'https://cardstack.com/base/card-api';
          import ColorishField from './colorish';
          export class ThemeField extends FieldDef {
            static displayName = 'Theme';
            @field background = contains(ColorishField);
            @field foreground = contains(ColorishField);
            @field primary = contains(ColorishField);
            @field secondary = contains(ColorishField);
            @field accent = contains(ColorishField);
            @field muted = contains(ColorishField);
            @field border = contains(ColorishField);
            @field ring = contains(ColorishField);
          }
        `,
        // Two cards in one module that link to each other. The module inspector
        // assembles every declaration in a module concurrently, so these two
        // become concurrent roots whose traversals reference one another.
        'linked.gts': `
          import { field, linksTo, linksToMany, CardDef } from 'https://cardstack.com/base/card-api';
          export class Post extends CardDef {
            static displayName = 'Post';
            @field author = linksTo(() => Author);
          }
          export class Author extends CardDef {
            static displayName = 'Author';
            @field posts = linksToMany(() => Post);
          }
        `,
      },
    });
  });

  // Registered last so the recorder is in place for the measured call and not
  // for the realm setup above, whose own requests are of no interest here.
  // `NetworkService.virtualNetwork` is an instance field and each test gets its
  // own owner, so this records one test's traffic and cannot carry into the
  // next. It does not survive `NetworkService.resetState()`, which replaces the
  // whole VirtualNetwork — hence the positive controls below, which fail rather
  // than pass silently if the recorder is no longer on the network in use.
  hooks.beforeEach(function () {
    let { virtualNetwork } = getService('network');
    let inner = virtualNetwork.fetch;
    virtualNetwork.fetch = ((...args: Parameters<typeof inner>) => {
      let [input] = args;
      let url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      requestLog.push(url);
      let fail = failNextRequestTo;
      if (fail && url.startsWith(fail)) {
        failNextRequestTo = undefined;
        return Promise.resolve(
          new Response('boom', { status: 500, statusText: 'Server Error' }),
        );
      }
      return inner(...args);
    }) as typeof inner;
  });

  hooks.afterEach(function () {
    requestLog = [];
    failNextRequestTo = undefined;
  });

  function requestsFor(prefix: string) {
    return requestLog.filter((url) => url.startsWith(prefix));
  }

  // Always the loader the service will itself use, read at call time: the
  // service resolves `loader-service.loader` on every assembly, and a loader
  // captured earlier in setup can since have been replaced.
  function currentLoader() {
    return getService('loader-service').loader;
  }

  async function importTheme() {
    let { ThemeField } = (await currentLoader().import(
      `${testRealmURL}theme`,
    )) as {
      ThemeField: typeof BaseDef;
    };
    let cardTypeService = getService('card-type-service');
    cardTypeService.invalidateAllCaches();
    requestLog.length = 0;
    return { ThemeField, cardTypeService };
  }

  // Forces the module-info fallback by hiding what the loader knows about
  // where its modules came from, so the tests below that are about the
  // fallback exercise it rather than the in-memory path.
  function hideLoaderModuleURLs() {
    currentLoader().canonicalURLFor = () => undefined;
  }

  // Sends one request of known shape through the network the service uses and
  // reports whether the recorder saw it. Lets a test that asserts no requests
  // were made distinguish that from a recorder that stopped listening.
  async function recorderIsLive() {
    let sentinel = `${testRealmURL}__recorder-probe__`;
    let before = requestLog.length;
    await getService('network')
      .virtualNetwork.fetch(sentinel)
      .catch(() => undefined);
    let saw = requestLog.slice(before).includes(sentinel);
    requestLog.length = before;
    return saw;
  }

  test('assembling a type reads the extension the loader already resolved, without asking the realm', async function (assert) {
    let { ThemeField, cardTypeService } = await importTheme();

    let type: Type = await cardTypeService.assembleType(ThemeField);

    // Half the witness for the absence assertions below: the extension and the
    // whole field list were produced, so nothing was skipped. The other half is
    // `recorderIsLive` — these assertions read the assembled type rather than
    // the request log, so on their own they would still hold if the recorder
    // had been detached and the log were empty for that reason instead.
    assert.strictEqual(
      type.moduleInfo.extension,
      '.gts',
      'the extension was resolved',
    );
    assert.strictEqual(
      type.fields.length,
      COLORISH_FIELD_COUNT,
      'every field was assembled',
    );
    assert.deepEqual(
      [...new Set(type.fields.map((f) => (f.card as Type).displayName))],
      ['Colorish'],
      'the fields all resolved to the shared field type',
    );

    assert.deepEqual(
      requestsFor(`${testRealmURL}colorish`),
      [],
      'the module the loader has already placed was not re-requested',
    );
    assert.deepEqual(
      requestLog.filter((url) => url.endsWith('/_info')),
      [],
      'nothing about an assembled type depends on realm info',
    );
    // The other half of the witness. `NetworkService.resetState()` swaps the
    // whole VirtualNetwork, which would silently detach the recorder and leave
    // both assertions above true for a reason that has nothing to do with the
    // service. A request that is known to have happened has to show up.
    assert.true(
      await recorderIsLive(),
      'the recorder was still attached to the network under test',
    );
  });

  test('the fields sharing a type resolve to one traversal between them', async function (assert) {
    let { ThemeField, cardTypeService } = await importTheme();

    let type: Type = await cardTypeService.assembleType(ThemeField);
    let resolved = type.fields.map((f) => f.card as Type);

    assert.strictEqual(
      new Set(resolved).size,
      1,
      `all ${COLORISH_FIELD_COUNT} fields share one assembled type, rather than each building its own (got ${new Set(resolved).size} distinct)`,
    );
  });

  test('the fallback fetches a shared module once for all the fields that share it', async function (assert) {
    let { ThemeField, cardTypeService } = await importTheme();
    hideLoaderModuleURLs();

    let type: Type = await cardTypeService.assembleType(ThemeField);
    assert.strictEqual(
      type.moduleInfo.extension,
      '.gts',
      'the fallback resolved the extension',
    );

    let colorishRequests = requestsFor(`${testRealmURL}colorish`);
    assert.strictEqual(
      colorishRequests.length,
      1,
      `the shared field type's module was requested once, not once per field (got ${colorishRequests.length}: ${colorishRequests.join(', ')})`,
    );
  });

  test('a failed fallback fetch is not cached, so the next assembly retries', async function (assert) {
    let { ThemeField, cardTypeService } = await importTheme();
    hideLoaderModuleURLs();

    failNextRequestTo = `${testRealmURL}colorish`;
    await assert.rejects(
      cardTypeService.assembleType(ThemeField),
      /status 500/,
      'the transient failure surfaces to the caller',
    );
    assert.strictEqual(
      failNextRequestTo,
      undefined,
      'the one-shot failure was actually served',
    );

    // Without eviction the rejected promise stays in the cache and every later
    // assembly for this loader replays that one failure.
    let type: Type = await cardTypeService.assembleType(ThemeField);
    assert.deepEqual(
      [...new Set(type.fields.map((f) => (f.card as Type).displayName))],
      ['Colorish'],
      'the retry assembles the type it failed to assemble before',
    );
  });

  test('concurrent roots in one module share a single fallback fetch for it', async function (assert) {
    let { Post, Author } = (await currentLoader().import(
      `${testRealmURL}linked`,
    )) as {
      Post: typeof BaseDef;
      Author: typeof BaseDef;
    };
    let cardTypeService = getService('card-type-service');
    cardTypeService.invalidateAllCaches();
    requestLog.length = 0;
    hideLoaderModuleURLs();

    // Two roots over the same module is the one shape that reaches the
    // module-info cache with a second caller while the first is still in
    // flight: within a single root the per-node memo collapses the siblings
    // before they ever get there.
    await Promise.all([
      cardTypeService.assembleType(Post),
      cardTypeService.assembleType(Author),
    ]);

    let linkedRequests = requestsFor(`${testRealmURL}linked`);
    assert.strictEqual(
      linkedRequests.length,
      1,
      `both roots shared one fetch of their module (got ${linkedRequests.length}: ${linkedRequests.join(', ')})`,
    );
  });

  test('mutually-referencing declarations in one module assemble concurrently', async function (assert) {
    let { Post, Author } = (await currentLoader().import(
      `${testRealmURL}linked`,
    )) as {
      Post: typeof BaseDef;
      Author: typeof BaseDef;
    };
    let cardTypeService = getService('card-type-service');
    cardTypeService.invalidateAllCaches();

    // How the module inspector assembles a module: one root per declaration,
    // all at once. `Post` references `Author` and `Author` references `Post`,
    // so each root's traversal reaches the other. Sharing in-flight type
    // promises across roots would leave these two awaiting each other and this
    // would never settle.
    let [postType, authorType] = (await Promise.all([
      cardTypeService.assembleType(Post),
      cardTypeService.assembleType(Author),
    ])) as [Type, Type];

    assert.strictEqual(postType.displayName, 'Post', 'the Post root settled');
    assert.strictEqual(
      authorType.displayName,
      'Author',
      'the Author root settled',
    );
    assert.ok(
      postType.fields.some((f) => f.name === 'author'),
      'the Post root resolved its link to Author',
    );
    assert.ok(
      authorType.fields.some((f) => f.name === 'posts'),
      'the Author root resolved its link to Post',
    );
  });
});
