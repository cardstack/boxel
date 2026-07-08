import { click, waitFor } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { ri } from '@cardstack/runtime-common';

import type RealmServerService from '@cardstack/host/services/realm-server';

import {
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupUserSubscription,
  skillsRealmURL,
  visitOperatorMode,
  realmConfigCardJSON,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

// The Duplicate Workspace action is offered only on the skills realm tile, so
// an in-process test realm is mounted at the resolved skills realm URL; the
// virtual network intercepts its requests before they reach the live server.
const ownedRealmURL = 'http://test-realm/testuser/workspace-a/';
const copyRealmURL = 'http://test-realm/testuser/skills-copy/';
// A realm the user can reach through `_realm-auth` permissions without it
// appearing in the matrix realms account data — the shape trusted-realm-server
// sessions produce for shared and system realms.
const grantedRealmURL = 'http://test-realm/otheruser/granted-workspace/';

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

module('Acceptance | workspace-chooser duplicate', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [ownedRealmURL],
  });

  setupBaseRealm(hooks);

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

  // The duplicate target realm is pre-mounted with the two files
  // `_create-realm` seeds, and `createRealm` is stubbed to return it: the
  // realm-server mock has no realm-creation endpoint, so this test exercises
  // everything around that call — endpoint choice, file copying, and
  // surfacing the finished copy.
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

  test('the skills realm tile offers Duplicate Workspace', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    await waitFor(`[data-test-workspace-menu-trigger="${skillsRealmURL}"]`);
    await click(`[data-test-workspace-menu-trigger="${skillsRealmURL}"]`);

    assert
      .dom('[data-test-boxel-menu-item-text="Duplicate Workspace"]')
      .exists('the skills realm tile menu has a Duplicate Workspace item');

    await click('[data-test-boxel-menu-item-text="Duplicate Workspace"]');

    assert
      .dom(`[data-test-duplicate-modal="${skillsRealmURL}"]`)
      .exists('choosing Duplicate Workspace opens the confirmation modal');

    await click('[data-test-cancel-duplicate-button]');

    assert
      .dom(`[data-test-duplicate-modal="${skillsRealmURL}"]`)
      .doesNotExist('cancelling closes the modal');
  });

  test('other workspaces have no Duplicate Workspace action', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);

    assert
      .dom('[data-test-boxel-menu-item-text="Duplicate Workspace"]')
      .doesNotExist(
        'Duplicate Workspace is absent on a workspace that is not the skills realm',
      );
    assert
      .dom('[data-test-boxel-menu-item-text="Realm Settings"]')
      .exists('the rest of the tile menu still renders');
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

    await waitFor(`[data-test-workspace-menu-trigger="${skillsRealmURL}"]`);
    await click(`[data-test-workspace-menu-trigger="${skillsRealmURL}"]`);
    await click('[data-test-boxel-menu-item-text="Duplicate Workspace"]');
    await click('[data-test-confirm-duplicate-button]');

    await waitFor(
      '[data-test-workspace-list] [data-test-workspace="Boxel Skills (Copy)"]',
    );
    assert
      .dom(
        '[data-test-workspace-list] [data-test-workspace="Boxel Skills (Copy)"]',
      )
      .exists('the finished copy joins the user workspace list');
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
      'files are copied into the duplicate byte-for-byte',
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

    // Simulate a trusted-realm-servers session: the realm list is assembled
    // from `_realm-auth` and the legacy `app.boxel.realms` account data is
    // non-authoritative (its change events don't rewrite the list). Realms
    // granted only via `_realm-auth` — like the skills realm — exist in the
    // list without appearing in the account data, and must survive list
    // updates that read the account data.
    let matrixService = this.owner.lookup('service:matrix-service') as any;
    matrixService.trustedRealmServersAuthoritative = true;
    await realmServer.setAvailableRealmIdentifiers([
      ...realmServer.userRealmIdentifiers,
      ri(grantedRealmURL),
    ]);
    await waitFor(
      '[data-test-workspace-list] [data-test-workspace="Granted Workspace"]',
    );

    await click(`[data-test-workspace-menu-trigger="${skillsRealmURL}"]`);
    await click('[data-test-boxel-menu-item-text="Duplicate Workspace"]');
    await click('[data-test-confirm-duplicate-button]');

    await waitFor(
      '[data-test-workspace-list] [data-test-workspace="Boxel Skills (Copy)"]',
    );
    assert
      .dom(
        '[data-test-workspace-list] [data-test-workspace="Granted Workspace"]',
      )
      .exists('the granted realm survives the duplication');
    assert
      .dom('[data-test-catalog-list] [data-test-workspace="Boxel Skills"]')
      .exists('the skills realm catalog tile survives the duplication');
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

    await waitFor(`[data-test-workspace-menu-trigger="${skillsRealmURL}"]`);
    await click(`[data-test-workspace-menu-trigger="${skillsRealmURL}"]`);
    await click('[data-test-boxel-menu-item-text="Duplicate Workspace"]');
    await click('[data-test-confirm-duplicate-button]');

    await waitFor(
      '[data-test-workspace-list] [data-test-workspace="Boxel Skills (Copy)"]',
    );
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

  test('a failed duplication surfaces the error in the modal', async function (assert) {
    let realmServer = this.owner.lookup(
      'service:realm-server',
    ) as RealmServerService;
    realmServer.createRealm = () =>
      Promise.reject(
        new Error("Could not create realm with endpoint 'skills-copy': 500"),
      );

    await visitOperatorMode({ workspaceChooserOpened: true });

    await waitFor(`[data-test-workspace-menu-trigger="${skillsRealmURL}"]`);
    await click(`[data-test-workspace-menu-trigger="${skillsRealmURL}"]`);
    await click('[data-test-boxel-menu-item-text="Duplicate Workspace"]');
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
      .dom(
        '[data-test-workspace-list] [data-test-workspace="Boxel Skills (Copy)"]',
      )
      .doesNotExist('no workspace is added when duplication fails');
  });
});
