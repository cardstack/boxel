import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

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
  let loader: Loader;
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
    loader = getService('loader-service').loader;

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

  test('fields sharing a type fetch that shared module once between them', async function (assert) {
    let { ThemeField } = (await loader.import(`${testRealmURL}theme`)) as {
      ThemeField: typeof BaseDef;
    };
    let cardTypeService = getService('card-type-service');
    cardTypeService.invalidateAllCaches();
    requestLog.length = 0;

    let type: Type = await cardTypeService.assembleType(ThemeField);

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

    let colorishRequests = requestsFor(`${testRealmURL}colorish`);
    assert.strictEqual(
      colorishRequests.length,
      1,
      `the shared field type's module was requested once, not once per field (got ${colorishRequests.length}: ${colorishRequests.join(', ')})`,
    );
  });

  test('assembling a type asks for no realm info', async function (assert) {
    let { ThemeField } = (await loader.import(`${testRealmURL}theme`)) as {
      ThemeField: typeof BaseDef;
    };
    let cardTypeService = getService('card-type-service');
    cardTypeService.invalidateAllCaches();
    requestLog.length = 0;

    let type = await cardTypeService.assembleType(ThemeField);
    assert.strictEqual(
      type.moduleInfo.extension,
      '.gts',
      'the module info that is assembled is the file extension',
    );

    // Positive control: an absence assertion over a recording is only worth
    // anything once the recording is known to have caught the traffic it is
    // being asked about.
    assert.strictEqual(
      requestsFor(`${testRealmURL}colorish`).length,
      1,
      'the recorder observed the assembly it is being asked about',
    );
    assert.deepEqual(
      requestLog.filter((url) => new URL(url).pathname.endsWith('/_info')),
      [],
      'nothing about an assembled type depends on realm info',
    );
  });

  test('a failed module-info fetch is not cached, so the next assembly retries', async function (assert) {
    let { ThemeField } = (await loader.import(`${testRealmURL}theme`)) as {
      ThemeField: typeof BaseDef;
    };
    let cardTypeService = getService('card-type-service');
    cardTypeService.invalidateAllCaches();
    requestLog.length = 0;

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
});
