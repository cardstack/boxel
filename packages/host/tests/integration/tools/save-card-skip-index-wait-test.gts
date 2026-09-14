import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { SKIP_INDEX_WAIT_HEADER } from '@cardstack/runtime-common';

import SaveCardTool from '@cardstack/host/tools/save-card';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

// Guards the polarity of SaveCardInput.skipIndexWait against the field it rides
// on. It is a BooleanField, whose unset value is `false`, so a save that does
// not opt in must NOT stamp SKIP_INDEX_WAIT_HEADER — only an explicit
// `skipIndexWait: true` may. (An earlier `waitForIndex` spelling defaulted the
// unset field to the opt-out, silently flipping every SaveCard to the deferred-
// index echo path — see CS-12968.)
//
// The realm-side handling of the header is covered in the realm-server suite
// (card-save-skip-index-wait-test.ts); this pins the host end — that the option
// reaches the wire as a header exactly when opted in — by capturing the save's
// outgoing request headers.
module('Integration | tools | save-card skip-index-wait', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    autostart: true,
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'person.gts': `
              import { contains, field, CardDef } from "@cardstack/base/card-api";
              import StringField from "@cardstack/base/string";
              export class Person extends CardDef {
                static displayName = 'Person';
                @field firstName = contains(StringField);
              }
            `,
        },
      }),
    );
    let realmService = getService('realm');
    let messageService = getService('message-service');
    messageService.register();
    await realmService.login(testRealmURL);
  });

  // Wrap the card write so we can read the headers the save sent. Returns the
  // captured headers of the first non-GET request (the POST/PATCH the save
  // issues) plus a restore hook.
  function captureWriteHeaders() {
    let cardService = getService('card-service') as any;
    let original = cardService.fetchJSON.bind(cardService);
    let writeHeaders: Headers | undefined;
    cardService.fetchJSON = function (url: string | URL, args?: any) {
      let method = (args?.method ?? 'GET').toUpperCase();
      if (method !== 'GET' && writeHeaders == null) {
        writeHeaders = new Headers(args?.headers ?? {});
      }
      return original(url, args);
    };
    return {
      get headers() {
        return writeHeaders;
      },
      restore() {
        cardService.fetchJSON = original;
      },
    };
  }

  async function newPerson() {
    let loader = getService('loader-service').loader as any;
    let { Person } = await loader.import(`${testRealmURL}person`);
    return new Person({ firstName: 'Mango' });
  }

  test('a save with skipIndexWait unset does not send the skip-index-wait header', async function (assert) {
    let toolService = getService('tool-service') as any;
    let person = await newPerson();
    let capture = captureWriteHeaders();
    try {
      let saved = await new SaveCardTool(toolService.toolContext).execute({
        card: person,
        realm: testRealmURL,
      });
      assert.ok(saved?.id, 'the card saved');
      assert.ok(capture.headers, 'a write request was issued');
      assert.false(
        capture.headers!.has(SKIP_INDEX_WAIT_HEADER),
        'an unset skipIndexWait leaves the header off, so the save waits on indexing as before',
      );
    } finally {
      capture.restore();
    }
  });

  test('a save with skipIndexWait: true sends the skip-index-wait header', async function (assert) {
    let toolService = getService('tool-service') as any;
    let person = await newPerson();
    let capture = captureWriteHeaders();
    try {
      let saved = await new SaveCardTool(toolService.toolContext).execute({
        card: person,
        realm: testRealmURL,
        skipIndexWait: true,
      });
      assert.ok(saved?.id, 'the card saved');
      assert.ok(capture.headers, 'a write request was issued');
      assert.strictEqual(
        capture.headers!.get(SKIP_INDEX_WAIT_HEADER),
        '1',
        'an explicit skipIndexWait: true stamps the opt-out header',
      );
    } finally {
      capture.restore();
    }
  });
});
