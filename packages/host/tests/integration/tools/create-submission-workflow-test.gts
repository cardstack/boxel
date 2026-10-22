import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { CardDef, contains, field, linksTo } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { rri } from '@cardstack/runtime-common';
import type {
  LooseSingleCardDocument,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';

import type NetworkService from '@cardstack/host/services/network';
import RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import StoreService from '@cardstack/host/services/store';
import CreateSubmissionWorkflowTool from '@cardstack/host/tools/create-submission-workflow';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmInfo,
  testRealmURL,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

// The workflow card's definition lives in the catalog, which this build does
// not serve. The store records the `adoptsFrom` the tool asked for, then saves
// the card against a stand-in definition in the test realm so the rest of the
// tool runs as it would against the catalog.
let requestedAdoptsFrom: ResolvedCodeRef[] = [];

class RecordingStoreService extends StoreService {
  async add(instanceOrDoc: any, opts?: any): Promise<any> {
    let doc = instanceOrDoc as LooseSingleCardDocument;
    let adoptsFrom = doc?.data?.meta?.adoptsFrom as ResolvedCodeRef | undefined;
    if (adoptsFrom?.name === 'SubmissionWorkflowCard') {
      requestedAdoptsFrom.push({ ...adoptsFrom });
      doc = {
        data: {
          ...doc.data,
          meta: {
            ...doc.data.meta,
            adoptsFrom: {
              module: rri(`${testRealmURL}submission-workflow-card`),
              name: 'SubmissionWorkflowCard',
            },
          },
        },
      };
    }
    return await super.add(doc, opts);
  }
}

module('Integration | tools | create-submission-workflow', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let catalogRealmURL: string;

  hooks.beforeEach(function (this: RenderingTestContext) {
    requestedAdoptsFrom = [];
    getOwner(this)!.register('service:realm', StubRealmService);
    getOwner(this)!.register('service:store', RecordingStoreService);
  });

  hooks.beforeEach(async function () {
    class Listing extends CardDef {
      @field name = contains(StringField);
    }
    class SubmissionWorkflowCard extends CardDef {
      @field submittedBy = contains(StringField);
      @field catalogRealmUrl = contains(StringField);
      @field roomId = contains(StringField);
      @field branchName = contains(StringField);
      @field listing = linksTo(Listing);
      @field prCard = linksTo(CardDef);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'listing.gts': { Listing },
        'submission-workflow-card.gts': { SubmissionWorkflowCard },
        'Listing/test-listing.json': new Listing({ name: 'Some Listing' }),
      },
    });

    let network = getService('network') as NetworkService;
    catalogRealmURL = network.virtualNetwork.toURL('@cardstack/catalog/').href;
    let realmServer = getService('realm-server') as RealmServerService;
    // Another catalog whose URL also ends in `/catalog/` is listed first, so
    // the tool has to tell the catalog apart by its registered prefix.
    Object.defineProperty(realmServer, 'catalogRealmIdentifiers', {
      get: () => ['https://example.com/other/catalog/', catalogRealmURL],
      configurable: true,
    });
  });

  test('the workflow card adopts from the catalog by its prefix', async function (assert) {
    let toolService = getService('tool-service');
    let command = new CreateSubmissionWorkflowTool(toolService.toolContext);
    await command.execute({
      realm: testRealmURL,
      listingId: `${testRealmURL}Listing/test-listing`,
    });

    assert.deepEqual(requestedAdoptsFrom, [
      {
        module: rri(
          '@cardstack/catalog/submission-workflow-card/submission-workflow-card',
        ),
        name: 'SubmissionWorkflowCard',
      },
    ]);
  });
});
