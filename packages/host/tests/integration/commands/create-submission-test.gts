import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { registerCardReferencePrefix } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

const realmServerOrigin = new URL(ENV.resolvedBaseRealmURL).origin;
const submissionRealmURL = new URL('/submissions-test/', realmServerOrigin)
  .href;
const catalogRealmURL = new URL('/catalog/', realmServerOrigin).href;
const catalogCreateSubmissionCommandURL =
  '@cardstack/catalog/commands/create-submission';
const catalogCreateSubmissionCommandTSURL =
  '@cardstack/catalog/commands/create-submission.ts';
const catalogListingModuleURL =
  '@cardstack/catalog/catalog-app/listing/listing';

module('Integration | commands | create-submission', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  setupBaseRealm(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL, submissionRealmURL],
  });

  hooks.beforeEach(async function () {
    let network = getService('network');
    network.virtualNetwork.addImportMap(
      '@cardstack/catalog/',
      (rest: string) => new URL(rest, catalogRealmURL).href,
    );
    registerCardReferencePrefix('@cardstack/catalog/', catalogRealmURL);

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
                module: catalogListingModuleURL,
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
    let createSubmissionModule: typeof import('@cardstack/catalog/commands/create-submission');
    try {
      createSubmissionModule = await loader.import<
        typeof import('@cardstack/catalog/commands/create-submission')
      >(catalogCreateSubmissionCommandURL);
    } catch {
      createSubmissionModule = await loader.import<
        typeof import('@cardstack/catalog/commands/create-submission')
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
