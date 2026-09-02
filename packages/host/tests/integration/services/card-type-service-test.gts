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

  // Registered last so the wrapper is in place for the measured call and not
  // for the realm setup above, whose own requests are of no interest here.
  hooks.beforeEach(function () {
    let { virtualNetwork } = getService('network');
    let inner = virtualNetwork.fetch;
    virtualNetwork.fetch = ((...args: Parameters<typeof inner>) => {
      let [input] = args;
      requestLog.push(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      return inner(...args);
    }) as typeof inner;
  });

  hooks.afterEach(function () {
    requestLog = [];
  });

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

    let colorishRequests = requestLog.filter((url) =>
      url.startsWith(`${testRealmURL}colorish`),
    );
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

    let realmInfoRequests = requestLog.filter((url) =>
      new URL(url).pathname.endsWith('/_info'),
    );
    assert.deepEqual(
      realmInfoRequests,
      [],
      'nothing about an assembled type depends on realm info',
    );
  });
});
