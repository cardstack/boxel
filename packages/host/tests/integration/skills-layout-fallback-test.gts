import { getService } from '@universal-ember/test-support';
import { setupWindowMock } from 'ember-window-mock/test-support';

import { module, test } from 'qunit';

import { APP_BOXEL_ROOM_SKILLS_EVENT_TYPE } from '@cardstack/runtime-common';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  skillsRealmURL,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

import type { SerializedFile } from '@cardstack/base/file-api';

// TEMPORARY: skills layout fallback, see lib/skills-layout-fallback.ts.
// Removed together with that module.

function skillMarkdown(name: string) {
  return `---
name: ${name}
description: ${name} skill
boxel:
  kind: skill
---
# ${name}
`;
}

module('Integration | skills layout fallback', function (hooks) {
  setupRenderingTest(hooks);
  setupWindowMock(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });

  let roomId: string;

  async function setupSkillsRealm(contents: Record<string, string>) {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: skillsRealmURL,
      permissions: { '*': ['read'] },
      contents,
    });
    await getService('matrix-service').ready;
    roomId = mockMatrixUtils.createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'skills-layout-room',
    });
  }

  function skillFile(sourceUrl: string) {
    return {
      sourceUrl,
      url: 'mxc://example/stale',
      name: 'SKILL.md',
      contentType: 'text/markdown',
    } as SerializedFile;
  }

  function setEnabledSkills(sourceUrls: string[], disabledUrls: string[] = []) {
    mockMatrixUtils.setRoomState(roomId, APP_BOXEL_ROOM_SKILLS_EVENT_TYPE, {
      enabledSkillCards: sourceUrls.map(skillFile),
      disabledSkillCards: disabledUrls.map(skillFile),
      toolDefinitions: [],
    });
  }

  function disabledSkillUrls(): string[] {
    return mockMatrixUtils
      .getRoomState(roomId, APP_BOXEL_ROOM_SKILLS_EVENT_TYPE)
      .disabledSkillCards.map((file: SerializedFile) => file.sourceUrl);
  }

  function enabledSkillUrls(): string[] {
    return mockMatrixUtils
      .getRoomState(roomId, APP_BOXEL_ROOM_SKILLS_EVENT_TYPE)
      .enabledSkillCards.map((file: SerializedFile) => file.sourceUrl);
  }

  test('a room holding skills/skills/ URLs is rewritten to the realm root', async function (assert) {
    await setupSkillsRealm({
      'boxel/SKILL.md': skillMarkdown('boxel'),
      'catalog-listing/SKILL.md': skillMarkdown('catalog-listing'),
    });
    setEnabledSkills([
      `${skillsRealmURL}skills/boxel/SKILL.md`,
      `${skillsRealmURL}catalog-listing/SKILL.md`,
    ]);

    await getService('matrix-service').updateSkillsAndToolsIfNeeded(roomId);

    assert.deepEqual(
      enabledSkillUrls(),
      [
        `${skillsRealmURL}boxel/SKILL.md`,
        `${skillsRealmURL}catalog-listing/SKILL.md`,
      ],
      'the moved skill is kept, under its root URL, in its original position',
    );
  });

  test('a root URL falls back to skills/skills/ while the realm serves only that', async function (assert) {
    await setupSkillsRealm({
      'skills/boxel/SKILL.md': skillMarkdown('boxel'),
    });
    setEnabledSkills([`${skillsRealmURL}boxel/SKILL.md`]);

    await getService('matrix-service').updateSkillsAndToolsIfNeeded(roomId);

    assert.deepEqual(
      enabledSkillUrls(),
      [`${skillsRealmURL}skills/boxel/SKILL.md`],
      'the skill is kept under the URL the realm serves',
    );
  });

  test('a skill missing in both forms is still dropped', async function (assert) {
    await setupSkillsRealm({
      'boxel/SKILL.md': skillMarkdown('boxel'),
    });
    setEnabledSkills([
      `${skillsRealmURL}skills/does-not-exist/SKILL.md`,
      `${skillsRealmURL}boxel/SKILL.md`,
    ]);

    await getService('matrix-service').updateSkillsAndToolsIfNeeded(roomId);

    assert.deepEqual(enabledSkillUrls(), [`${skillsRealmURL}boxel/SKILL.md`]);
  });

  test('disabled skills are rewritten too, and kept when they load from neither URL', async function (assert) {
    await setupSkillsRealm({
      'boxel/SKILL.md': skillMarkdown('boxel'),
      'catalog-listing/SKILL.md': skillMarkdown('catalog-listing'),
    });
    setEnabledSkills(
      [`${skillsRealmURL}boxel/SKILL.md`],
      [
        `${skillsRealmURL}skills/catalog-listing/SKILL.md`,
        `${skillsRealmURL}skills/does-not-exist/SKILL.md`,
      ],
    );

    await getService('matrix-service').updateSkillsAndToolsIfNeeded(roomId);

    assert.deepEqual(disabledSkillUrls(), [
      `${skillsRealmURL}catalog-listing/SKILL.md`,
      `${skillsRealmURL}skills/does-not-exist/SKILL.md`,
    ]);
  });
});
