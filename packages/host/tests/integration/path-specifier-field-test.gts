import {
  blur,
  click,
  fillIn,
  find,
  type RenderingTestContext,
} from '@ember/test-helpers';

import {
  CardDef,
  Component,
  contains,
  field,
  serializeCard,
} from '@cardstack/base/card-api';
import PathSpecifierField from '@cardstack/base/path-specifier';
import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  PermissionsContextName,
  parsePathPrefix,
  rri,
  type LooseSingleCardDocument,
  type Permissions,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import type StoreService from '@cardstack/host/services/store';

import {
  provideConsumeContext,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

class Site extends CardDef {
  static displayName = 'Site';
  @field paths = contains(PathSpecifierField);
  static isolated = class Isolated extends Component<typeof this> {
    <template><@fields.paths /></template>
  };
}

function siteDocument(paths?: unknown): LooseSingleCardDocument {
  return {
    data: {
      attributes: paths === undefined ? {} : { paths },
      meta: { adoptsFrom: { module: rri('./site'), name: 'Site' } },
    },
  };
}

function messageFor(prefix: string): string {
  let result = parsePathPrefix(prefix);
  if (result.ok) {
    throw new Error(`expected "${prefix}" to be an invalid prefix`);
  }
  return result.error.message;
}

const input = (index: number) => `[data-test-path-specifier-input="${index}"]`;

// The message the input is announced with, found the way assistive
// technology finds it: through the input's `aria-errormessage`.
function errorMessageOf(index: number): string | undefined {
  let id = find(input(index))?.getAttribute('aria-errormessage');
  return id ? document.getElementById(id)?.textContent?.trim() : undefined;
}

module('Integration | PathSpecifierField', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let loader: Loader;
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
  });

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  function allowEditing(canWrite: boolean) {
    let permissions: Permissions = { canWrite, canRead: true };
    provideConsumeContext(PermissionsContextName, permissions);
  }

  test('a path specifier saves and reads back exactly as written, and an unset one reads back as absent', async function (assert) {
    // Surrounding whitespace, a percent-escape and a reserved character: none
    // of them is cleaned up or refused on the way through.
    let written = ['blog/', '/Docs/post%201.json', ' drafts/', 'blog/*'];
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'site.gts': { Site },
        'written.json': siteDocument(written),
        'empty.json': siteDocument([]),
        'null.json': siteDocument(null),
        'unset.json': siteDocument(),
      },
    });
    let store = getService('store') as StoreService;

    for (let [path, expected] of [
      ['written', written],
      ['empty', []],
      ['null', null],
      ['unset', null],
    ] as const) {
      let doc = await realm.realmIndexQueryEngine.cardDocument(
        new URL(`${testRealmURL}${path}`),
      );
      assert.strictEqual(
        doc?.type,
        'doc',
        `${path} indexes cleanly: ${JSON.stringify(
          doc?.type === 'error' ? doc.error : undefined,
        )}`,
      );
      assert.deepEqual(
        doc?.type === 'doc' ? doc.doc.data.attributes?.paths : undefined,
        expected,
        `${path} indexes with its path specifier as written`,
      );

      let site = (await store.get(`${testRealmURL}${path}`)) as Site;
      assert.deepEqual(
        serializeCard(site, {}).data.attributes?.paths,
        expected,
        `${path} serializes back to its path specifier as written`,
      );
    }
  });

  test('a malformed stored value fails the card instead of reading as absent', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'site.gts': { Site },
        'string.json': siteDocument('blog/'),
        'number-in-list.json': siteDocument(['blog/', 5]),
      },
    });

    for (let [path, reason] of [
      ['string', 'must be a list of path prefixes'],
      ['number-in-list', 'must be strings'],
    ]) {
      let entry = await realm.realmIndexQueryEngine.instance(
        new URL(`${testRealmURL}${path}`),
      );
      assert.strictEqual(
        entry?.type,
        'instance-error',
        `${path} is an index error rather than a card with no path limit`,
      );
      let error = entry?.type === 'instance-error' ? entry.error : undefined;
      assert.true(
        JSON.stringify(error ?? null).includes(reason),
        `${path} fails because its path specifier is malformed: ${JSON.stringify(
          error?.message,
        )}`,
      );
    }
  });

  test("the editor stores each prefix as typed and shows the validator's message for an invalid one", async function (assert) {
    allowEditing(true);
    let site = new Site({ paths: ['blog/'] });
    await renderCard(loader, site, 'edit');

    assert.dom('[data-test-path-specifier-row]').exists({ count: 1 });
    assert.dom(input(0)).hasValue('blog/');
    assert.dom(input(0)).doesNotHaveAttribute('aria-invalid');

    await fillIn(input(0), 'blog/*');
    assert.deepEqual(
      site.paths,
      ['blog/*'],
      'an invalid prefix is stored as typed',
    );
    assert.dom(input(0)).hasAttribute('aria-invalid', 'true');
    assert.strictEqual(
      errorMessageOf(0),
      messageFor('blog/*'),
      "the input shows the validator's message",
    );

    await fillIn(input(0), 'blog/drafts/');
    assert.deepEqual(site.paths, ['blog/drafts/']);
    assert.dom(input(0)).doesNotHaveAttribute('aria-invalid');
    assert.strictEqual(
      errorMessageOf(0),
      undefined,
      'the message goes away once the prefix is valid',
    );
  });

  test('the editor adds and removes prefixes, and a new empty prefix shows its message once the author leaves it', async function (assert) {
    allowEditing(true);
    let site = new Site({ paths: ['blog/'] });
    await renderCard(loader, site, 'edit');

    await click('[data-test-path-specifier-add]');
    assert.deepEqual(site.paths, ['blog/', ''], 'a new row is an empty prefix');
    assert.dom(input(1)).isFocused('the new row has the cursor');
    assert.strictEqual(
      errorMessageOf(1),
      undefined,
      'a row the author has just added shows no message yet',
    );

    await blur(input(1));
    assert.strictEqual(
      errorMessageOf(1),
      messageFor(''),
      'an empty row the author has left shows the message',
    );

    await fillIn(input(1), 'posts/');
    assert.deepEqual(site.paths, ['blog/', 'posts/']);

    await click('[data-test-path-specifier-remove="0"]');
    assert.deepEqual(site.paths, ['posts/']);
    assert.dom(input(0)).hasValue('posts/');

    await click('[data-test-path-specifier-remove="0"]');
    assert.deepEqual(
      site.paths,
      [],
      'removing the last prefix leaves an empty list',
    );
    assert.dom('[data-test-path-specifier-row]').doesNotExist();
    assert
      .dom(
        '[data-test-path-specifier-edit] [data-test-path-specifier-no-limit]',
      )
      .hasText('No path limit');
  });

  test('without write permission the editor shows the prefixes but cannot change them', async function (assert) {
    allowEditing(false);
    let site = new Site({ paths: ['blog/', 'blog/*'] });
    await renderCard(loader, site, 'edit');

    assert.dom(input(0)).hasValue('blog/');
    assert.dom(input(0)).hasAttribute('readonly');
    assert.strictEqual(
      errorMessageOf(1),
      messageFor('blog/*'),
      'an invalid prefix still shows its message',
    );
    assert.dom('[data-test-path-specifier-add]').doesNotExist();
    assert.dom('[data-test-path-specifier-remove]').doesNotExist();
  });

  test('the view lists the prefixes as written, and says No path limit for an empty or unset specifier', async function (assert) {
    await renderCard(
      loader,
      new Site({ paths: ['blog/', 'posts/drafts/'] }),
      'isolated',
    );
    assert.deepEqual(
      [...document.querySelectorAll('[data-test-path-specifier-prefix]')].map(
        (element) => element.textContent,
      ),
      ['blog/', 'posts/drafts/'],
    );
    assert.dom('[data-test-path-specifier-no-limit]').doesNotExist();

    for (let paths of [[], null]) {
      await renderCard(loader, new Site({ paths }), 'isolated');
      assert
        .dom('[data-test-path-specifier-no-limit]')
        .hasText(
          'No path limit',
          `${JSON.stringify(paths)} reads as no path limit`,
        );
      assert.dom('[data-test-path-specifier-prefix]').doesNotExist();
    }
  });
});
