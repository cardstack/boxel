import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import CreateSubmissionCommand from '@cardstack/host/commands/create-submission';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import {
  CardDef,
  contains,
  field,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

const submissionRealmURL = 'http://localhost:4201/submissions-test/';

module('Integration | commands | create-submission', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  setupBaseRealm(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL, submissionRealmURL],
  });

  hooks.beforeEach(async function () {
    class Listing extends CardDef {
      @field name = contains(StringField);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      contents: {
        'listing.gts': { Listing },
        'Listing/test-listing.json': new Listing({ name: 'Some Listing' }),
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
