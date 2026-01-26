import { settled, waitFor } from '@ember/test-helpers';

import window from 'ember-window-mock';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import { RecentFiles } from '@cardstack/host/utils/local-storage-keys';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  setupAuthEndpoints,
  setupUserSubscription,
  setMonacoContent,
} from '../../helpers';

import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';

const headPreviewCardSource = `
  import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
  import StringField from "https://cardstack.com/base/string";

  export class HeadPreview extends CardDef {
    static displayName = 'Head Preview';

    @field title = contains(StringField);
    @field description = contains(StringField);

    static head = class Head extends Component<typeof this> {
      <template>
        {{! template-lint-disable no-forbidden-elements }}
        <title>{{@model.title}}</title>
        <meta name='description' content={{@model.description}} />
        <meta property='og:title' content={{@model.title}} />
        <meta property='og:description' content={{@model.description}} />
      </template>
    };
  }
`;

module('Acceptance | code submode | head format preview', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
  });

  let { setRealmPermissions, createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(async function () {
    setRealmPermissions({ [testRealmURL]: ['read', 'write'] });

    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    window.localStorage.setItem(
      RecentFiles,
      JSON.stringify([[testRealmURL, 'HeadPreview/example.json']]),
    );

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'head-preview.gts': headPreviewCardSource,
        'HeadPreview/example.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Preview Title',
              description: 'Preview description',
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}head-preview`,
                name: 'HeadPreview',
              },
            },
          },
        },
      },
    });
  });

  test('head format preview updates when editing card json', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}HeadPreview/example`,
            format: 'head',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}HeadPreview/example.json`,
      cardPreviewFormat: 'head',
    });

    await waitFor('.google-title');
    assert.dom('.google-title').hasText('Preview Title');
    assert.dom('.google-description').hasText('Preview description');

    setMonacoContent(
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            title: 'Updated Title',
            description: 'Updated description',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}head-preview`,
              name: 'HeadPreview',
            },
          },
        },
      }),
    );
    await settled();

    assert.dom('.google-title').hasText('Updated Title');
    assert.dom('.google-description').hasText('Updated description');
  });
});
