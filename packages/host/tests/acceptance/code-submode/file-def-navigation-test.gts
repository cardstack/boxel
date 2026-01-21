import { click, waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import {
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  setupOnSave,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
  visitOperatorMode,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';

module('Acceptance | code submode | file def navigation', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });

  hooks.beforeEach(async function () {
    let loader = getService('loader-service').loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
    let fileApi: typeof import('https://cardstack.com/base/file-api');

    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    fileApi = await loader.import(`${baseRealm.url}file-api`);

    let { field, contains, linksTo, CardDef, Component } = cardApi;
    let { default: StringField } = string;
    let { FileDef } = fileApi;

    class FileLinkCard extends CardDef {
      static displayName = 'File Link Card';

      @field title = contains(StringField);
      @field attachment = linksTo(FileDef);

      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-file-link-card-title><@fields.title /></h2>
          <div data-test-file-link-attachment>
            <@fields.attachment />
          </div>
        </template>
      };
    }

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'file-link-card.gts': { FileLinkCard },
        'FileLinkCard/notes.md': `# Notes

Some markdown content.`,
        'FileLinkCard/with-markdown.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Linked markdown example',
            },
            relationships: {
              attachment: {
                links: {
                  self: './notes.md',
                },
                data: {
                  type: 'file-meta',
                  id: './notes.md',
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: '../file-link-card',
                name: 'FileLinkCard',
              },
            },
          },
        },
      },
    });
  });

  test('clicking embedded file in preview opens markdown file in code mode', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}FileLinkCard/with-markdown.json`,
    });

    await waitFor('[data-test-card-resource-loaded]');
    await waitFor(
      '[data-test-file-link-attachment] [data-test-field-component-card]',
    );
    await waitFor('[data-test-card-url-bar-input]');

    let urlInput = document.querySelector(
      '[data-test-card-url-bar-input]',
    ) as HTMLInputElement | null;
    let startingValue = urlInput?.value ?? '';
    let expectedMarkdownUrl = new URL('FileLinkCard/notes.md', testRealmURL)
      .href;

    await click(
      '[data-test-file-link-attachment] [data-test-field-component-card]',
    );

    await waitUntil(() => {
      let currentValue =
        (
          document.querySelector(
            '[data-test-card-url-bar-input]',
          ) as HTMLInputElement | null
        )?.value ?? '';
      return currentValue !== startingValue;
    });

    assert.dom('[data-test-card-url-bar-input]').hasValue(expectedMarkdownUrl);
  });
});
