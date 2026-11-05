import { click, find, waitFor, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { Deferred, ri } from '@cardstack/runtime-common';

import type CardService from '@cardstack/host/services/card-service';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type WorkspaceDuplicationService from '@cardstack/host/services/workspace-duplication';

import {
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupUserSubscription,
  skillsRealmURL,
  visitOperatorMode,
  realmConfigCardJSON,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

// Duplicate Workspace is offered only on the skills realm, so an in-process
// test realm is mounted at the resolved skills realm URL; the virtual network
// intercepts its requests before they reach the live server.
const ownedRealmURL = 'http://test-realm/testuser/workspace-a/';
const copyRealmURL = 'http://test-realm/testuser/skills-copy/';
// A realm the user can reach through `_realm-auth` permissions without it
// appearing in the matrix realms account data — the shape trusted-realm-server
// sessions produce for shared and system realms.
const grantedRealmURL = 'http://test-realm/otheruser/granted-workspace/';

const COPY_IN_WORKSPACES =
  '[data-test-workspace-list] [data-test-workspace="Boxel Skills (Copy)"]';

const skillMarkdown = `# Test skill

Always test the workspace duplication feature.
`;

const cardsGridIndex = {
  data: {
    type: 'card',
    meta: {
      adoptsFrom: {
        module: '@cardstack/base/cards-grid',
        name: 'CardsGrid',
      },
    },
  },
};

async function openDuplicateModal() {
  await waitFor(`[data-test-workspace-menu-trigger="${skillsRealmURL}"]`);
  await click(`[data-test-workspace-menu-trigger="${skillsRealmURL}"]`);
  await click('[data-test-boxel-menu-item-text="Duplicate Workspace"]');
}

module('Acceptance | dashboard duplicate', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [ownedRealmURL],
  });

  hooks.beforeEach(async function () {
    setupUserSubscription();

    await setupAcceptanceTestRealm({
      realmURL: ownedRealmURL,
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Workspace A' }),
        'index.json': cardsGridIndex,
      },
    });

    await setupAcceptanceTestRealm({
      realmURL: skillsRealmURL,
      mockMatrixUtils,
      permissions: {
        '*': ['read'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Boxel Skills' }),
        'index.json': cardsGridIndex,
        'README.md': 'A collection of skills.\n',
        'skills/test-skill/SKILL.md': skillMarkdown,
      },
    });

    await setupAcceptanceTestRealm({
      realmURL: grantedRealmURL,
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Granted Workspace' }),
        'index.json': cardsGridIndex,
      },
    });
  });

  // The duplicate target realm is mounted beforehand with the two files
  // `_create-realm` seeds, and `createRealm` is stubbed to return it: the
  // realm-server mock has no realm-creation endpoint, so these tests cover
  // everything around that call — endpoint choice, file copying, and
  // showing the finished copy.
  async function setupCopyTargetRealm() {
    return await setupAcceptanceTestRealm({
      realmURL: copyRealmURL,
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Boxel Skills (Copy)' }),
        'index.json': cardsGridIndex,
      },
    });
  }

  test('the skills realm offers Duplicate Workspace, whose confirmation can be canceled', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });
    assert.dom('[data-test-dashboard]').exists();

    await waitFor(`[data-test-workspace-menu-trigger="${skillsRealmURL}"]`);
    await click(`[data-test-workspace-menu-trigger="${skillsRealmURL}"]`);
    assert
      .dom('[data-test-boxel-menu-item-text="Duplicate Workspace"]')
      .exists("the skills realm's menu has Duplicate Workspace");

    await click('[data-test-boxel-menu-item-text="Duplicate Workspace"]');
    assert
      .dom(`[data-test-duplicate-modal="${skillsRealmURL}"]`)
      .exists('choosing Duplicate Workspace opens the confirmation');

    await click('[data-test-cancel-duplicate-button]');
    assert
      .dom(`[data-test-duplicate-modal="${skillsRealmURL}"]`)
      .doesNotExist('canceling closes the confirmation');
  });

  test('other workspaces have no Duplicate Workspace action', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);

    assert
      .dom('[data-test-boxel-menu-item-text="Duplicate Workspace"]')
      .doesNotExist('a workspace that is not the skills realm has none');
    assert
      .dom('[data-test-boxel-menu-item-text="Realm Settings"]')
      .exists('the rest of the menu still renders');
  });

  test('duplicating the skills realm copies its files into a new private workspace', async function (assert) {
    let { adapter: copyRealmAdapter } = await setupCopyTargetRealm();

    let realmServer = this.owner.lookup(
      'service:realm-server',
    ) as RealmServerService;
    let createRealmCalls: Parameters<RealmServerService['createRealm']>[0][] =
      [];
    realmServer.createRealm = async (args) => {
      createRealmCalls.push(args);
      return new URL(copyRealmURL);
    };

    await visitOperatorMode({ workspaceChooserOpened: true });

    await openDuplicateModal();
    await click('[data-test-confirm-duplicate-button]');

    await waitFor(COPY_IN_WORKSPACES);
    assert
      .dom(COPY_IN_WORKSPACES)
      .exists('the finished copy joins Your Workspaces');
    assert
      .dom(`[data-test-duplicate-modal="${skillsRealmURL}"]`)
      .doesNotExist('the modal closes once the copy completes');

    assert.strictEqual(
      createRealmCalls.length,
      1,
      'one realm is created for the duplicate',
    );
    assert.strictEqual(
      createRealmCalls[0]?.endpoint,
      'skills-copy',
      "the duplicate's endpoint derives from the source realm's endpoint",
    );
    assert.strictEqual(
      createRealmCalls[0]?.name,
      'Boxel Skills (Copy)',
      "the duplicate's name marks it as a copy",
    );

    let copiedSkill = await copyRealmAdapter.openFile(
      'skills/test-skill/SKILL.md',
    );
    assert.strictEqual(
      copiedSkill?.content,
      skillMarkdown,
      'files are copied into the duplicate byte for byte',
    );

    let copiedReadme = await copyRealmAdapter.openFile('README.md');
    assert.strictEqual(
      copiedReadme?.content,
      'A collection of skills.\n',
      'every source file is copied, not just cards',
    );

    let copyRealmConfig = await copyRealmAdapter.openFile('realm.json');
    let configName = JSON.parse(copyRealmConfig?.content as string).data
      .attributes.cardInfo.name;
    assert.strictEqual(
      configName,
      'Boxel Skills (Copy)',
      "the source's realm.json does not overwrite the duplicate's own config",
    );
  });

  test('duplicating keeps realms that are not in the matrix account data', async function (assert) {
    await setupCopyTargetRealm();

    let realmServer = this.owner.lookup(
      'service:realm-server',
    ) as RealmServerService;
    realmServer.createRealm = async () => new URL(copyRealmURL);

    await visitOperatorMode({ workspaceChooserOpened: true });

    // A trusted-realm-servers session: the realm list is assembled from
    // `_realm-auth`, and the legacy `app.boxel.realms` account data is not
    // authoritative. Realms granted only through `_realm-auth`, like the
    // skills realm, are listed without being in the account data, and must
    // survive list updates that read it.
    let matrixService = this.owner.lookup('service:matrix-service') as any;
    matrixService.trustedRealmServersAuthoritative = true;
    await realmServer.setAvailableRealmIdentifiers([
      ...realmServer.userRealmIdentifiers,
      ri(grantedRealmURL),
    ]);
    await waitFor(
      '[data-test-workspace-list] [data-test-workspace="Granted Workspace"]',
    );

    await openDuplicateModal();
    await click('[data-test-confirm-duplicate-button]');

    await waitFor(COPY_IN_WORKSPACES);
    assert
      .dom(
        '[data-test-workspace-list] [data-test-workspace="Granted Workspace"]',
      )
      .exists('the granted realm survives the duplication');
    assert
      .dom('[data-test-catalog-list] [data-test-workspace="Boxel Skills"]')
      .exists('the skills realm catalog survives the duplication');
  });

  test('the modal shows the copy in progress, and canceling it closes the modal and deletes the partial realm', async function (assert) {
    await setupCopyTargetRealm();

    let realmServer = this.owner.lookup(
      'service:realm-server',
    ) as RealmServerService;
    let createRealmCalled = false;
    let realmCreated = new Deferred<URL>();
    realmServer.createRealm = async () => {
      createRealmCalled = true;
      return realmCreated.promise;
    };
    let deletedRealms: string[] = [];
    realmServer.deleteRealm = async (realmURL) => {
      deletedRealms.push(realmURL);
    };

    await visitOperatorMode({ workspaceChooserOpened: true });
    await openDuplicateModal();

    // Not awaited: the held realm creation keeps the duplication running.
    let confirmed = click('[data-test-confirm-duplicate-button]');
    let canceled: Promise<void> | undefined;
    try {
      await waitUntil(() => createRealmCalled, {
        timeoutMessage: 'the duplicate realm is never created',
      });
      assert
        .dom('[data-test-duplicate-progress]')
        .includesText('Copying 0 of', 'the modal shows how far the copy is');

      canceled = click('[data-test-cancel-duplicate-button]');
      await waitUntil(
        () => !find(`[data-test-duplicate-modal="${skillsRealmURL}"]`),
        { timeoutMessage: 'canceling never closes the modal' },
      );
    } finally {
      realmCreated.fulfill(new URL(copyRealmURL));
    }
    await confirmed;
    await canceled;
    await waitUntil(() => deletedRealms.length > 0, {
      timeoutMessage: 'the partial realm is never deleted',
    });

    assert.deepEqual(
      deletedRealms,
      [copyRealmURL],
      'the partially created realm is deleted after canceling',
    );
    assert
      .dom(`[data-test-duplicate-modal="${skillsRealmURL}"]`)
      .doesNotExist('the modal stays closed');
    assert
      .dom(COPY_IN_WORKSPACES)
      .doesNotExist('the canceled copy never joins Your Workspaces');
  });

  test('an aborted duplication stops copying and deletes the partial realm', async function (assert) {
    await setupCopyTargetRealm();

    let realmServer = this.owner.lookup(
      'service:realm-server',
    ) as RealmServerService;
    let controller = new AbortController();
    realmServer.createRealm = async () => {
      // Aborted as soon as the realm exists: the copy must not start, and
      // the partial realm must be cleaned up.
      controller.abort();
      return new URL(copyRealmURL);
    };
    let deletedRealms: string[] = [];
    realmServer.deleteRealm = async (realmURL) => {
      deletedRealms.push(realmURL);
    };

    await visitOperatorMode({ workspaceChooserOpened: true });

    let workspaceDuplication = this.owner.lookup(
      'service:workspace-duplication',
    ) as WorkspaceDuplicationService;
    await assert.rejects(
      workspaceDuplication.duplicateWorkspace(ri(skillsRealmURL), {
        signal: controller.signal,
      }),
      /cancelled/,
      'the duplication rejects once the abort lands',
    );

    assert.deepEqual(
      deletedRealms,
      [copyRealmURL],
      'the partially created realm is deleted after the abort',
    );
    assert
      .dom(COPY_IN_WORKSPACES)
      .doesNotExist('the aborted copy never joins Your Workspaces');
  });

  test('an endpoint collision retries with a numbered suffix', async function (assert) {
    await setupCopyTargetRealm();

    let realmServer = this.owner.lookup(
      'service:realm-server',
    ) as RealmServerService;
    let attemptedEndpoints: string[] = [];
    let attemptedNames: string[] = [];
    realmServer.createRealm = async (args) => {
      attemptedEndpoints.push(args.endpoint);
      attemptedNames.push(args.name);
      if (attemptedEndpoints.length === 1) {
        throw new Error(
          `Could not create realm with endpoint '${args.endpoint}': 400 - realm '${copyRealmURL}' already exists on this server`,
        );
      }
      return new URL(copyRealmURL);
    };

    await visitOperatorMode({ workspaceChooserOpened: true });

    await openDuplicateModal();
    await click('[data-test-confirm-duplicate-button]');

    await waitFor(COPY_IN_WORKSPACES);
    assert.deepEqual(
      attemptedEndpoints,
      ['skills-copy', 'skills-copy-2'],
      'a taken endpoint falls through to the next numbered candidate',
    );
    assert.deepEqual(
      attemptedNames,
      ['Boxel Skills (Copy)', 'Boxel Skills (Copy 2)'],
      "the workspace name carries the same number as the endpoint, so a second copy isn't named like the first",
    );
  });

  test('a failed source read rejects instead of writing the error body', async function (assert) {
    let { adapter: copyRealmAdapter } = await setupCopyTargetRealm();

    await visitOperatorMode({ workspaceChooserOpened: true });

    let cardService = this.owner.lookup('service:card-service') as CardService;
    await assert.rejects(
      cardService.copySource(
        new URL(`${skillsRealmURL}skills/does-not-exist/SKILL.md`),
        new URL(`${copyRealmURL}skills/does-not-exist/SKILL.md`),
      ),
      /Could not read .*does-not-exist.*404/,
      'copying an unreadable source fails instead of succeeding',
    );

    let copiedFile = await copyRealmAdapter.openFile(
      'skills/does-not-exist/SKILL.md',
    );
    assert.notOk(
      copiedFile,
      'nothing is written to the destination when the source read fails',
    );
  });

  test('a failed duplication keeps the modal open with the error', async function (assert) {
    let realmServer = this.owner.lookup(
      'service:realm-server',
    ) as RealmServerService;
    realmServer.createRealm = () =>
      Promise.reject(
        new Error("Could not create realm with endpoint 'skills-copy': 500"),
      );

    await visitOperatorMode({ workspaceChooserOpened: true });

    await openDuplicateModal();
    await click('[data-test-confirm-duplicate-button]');

    await waitFor('[data-test-duplicate-error]');
    assert
      .dom('[data-test-duplicate-error]')
      .hasText(
        "Could not create realm with endpoint 'skills-copy': 500",
        'the failure stays visible in the modal',
      );
    assert
      .dom(`[data-test-duplicate-modal="${skillsRealmURL}"]`)
      .exists('the modal stays open so the error can be read');
    assert
      .dom(COPY_IN_WORKSPACES)
      .doesNotExist('no workspace is added when duplication fails');
  });
});
