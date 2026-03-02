import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

import type * as CreateSubmissionModule from '@cardstack/catalog/commands/create-submission';

const submissionRealmURL = 'http://localhost:4201/submissions-test/';
const catalogCreateSubmissionCommandURL =
  'http://localhost:4201/catalog/commands/create-submission';
const catalogCreateSubmissionCommandTSURL =
  'http://localhost:4201/catalog/commands/create-submission.ts';

module('Integration | commands | create-submission', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  setupBaseRealm(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL, submissionRealmURL],
  });

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      contents: {
        'Listing/test-listing.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'Some Listing',
            },
            meta: {
              adoptsFrom: {
                module:
                  'http://localhost:4201/catalog/catalog-app/listing/listing',
                name: 'Listing',
              },
            },
          },
        },
      },
    });

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: submissionRealmURL,
      contents: {},
    });
  });

  test('creates the submission card in the provided realm', async function (assert) {
    let commandService = getService('command-service');
    let loader = getService('loader-service').loader;
    let createSubmissionModule: typeof CreateSubmissionModule;
    try {
      createSubmissionModule = await loader.import<
        typeof CreateSubmissionModule
      >(catalogCreateSubmissionCommandURL);
    } catch {
      createSubmissionModule = await loader.import<
        typeof CreateSubmissionModule
      >(catalogCreateSubmissionCommandTSURL);
    }
    let CreateSubmissionCommand = createSubmissionModule.default;
    let command = new CreateSubmissionCommand(commandService.commandContext);

    let submission = await command.execute({
      roomId: '!abc123:localhost',
      realm: submissionRealmURL,
      listingId: `${testRealmURL}Listing/test-listing`,
    });

    assert.ok(submission.id, 'submission has an id');
    assert.true(
      submission.id!.startsWith(submissionRealmURL),
      `submission id is in submission realm (${submissionRealmURL})`,
    );
  });
});
