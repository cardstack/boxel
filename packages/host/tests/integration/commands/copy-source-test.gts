import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { module, test } from 'qunit';

import CopySourceCommand from '@cardstack/host/commands/copy-source';
import type NetworkService from '@cardstack/host/services/network';

import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
  setupSnapshotRealm,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';
import { getService } from '@universal-ember/test-support';

let fetch: NetworkService['fetch'];

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module('Integration | commands | copy-source', function (hooks) {
  setupRenderingTest(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks);

  let snapshot = setupSnapshotRealm(hooks, {
    mockMatrixUtils,
    async build({ loader }) {
      let loaderService = getService('loader-service');
      loaderService.loader = loader;
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {
          'person.gts': `
          import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";
          export class Person extends CardDef {
            static displayName = 'Person';
            @field firstName = contains(StringField);
          }
        `,
        },
        loader,
      });
      return {};
    },
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    fetch = getService('network').fetch;
  });

  hooks.beforeEach(function () {
    snapshot.get();
  });

  test('able to copy source or file', async function (assert) {
    let commandService = getService('command-service');
    let copySourceCommand = new CopySourceCommand(
      commandService.commandContext,
    );
    const fromRealmUrl = testRealmURL + 'person.gts';
    const toRealmUrl = testRealmURL + 'person-copy.gts';
    await copySourceCommand.execute({
      fromRealmUrl,
      toRealmUrl,
    });
    let personResponse = await fetch(new URL(fromRealmUrl));
    let personContent = await personResponse.text();
    let personCopyResponse = await fetch(new URL(toRealmUrl));
    let personCopyContent = await personCopyResponse.text();

    assert.strictEqual(personCopyContent, personContent);
  });
});
