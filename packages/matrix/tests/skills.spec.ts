import { expect, test, type Page } from '@playwright/test';
import { registerUser } from '../docker/synapse';
import {
  login,
  logout,
  createRoom,
  getRoomId,
  openRoom,
  assertMessages,
  sendMessage,
  reloadAndOpenAiAssistant,
  isInRoom,
  registerRealmUsers,
  setupUserSubscribed,
  clearLocalStorage,
} from '../helpers';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
} from '../docker/synapse';
import {
  appURL,
  startServer as startRealmServer,
  type IsolatedRealmServer,
} from '../helpers/isolated-realm-server';

test.describe('Skills', () => {
  let synapse: SynapseInstance;
  let realmServer: IsolatedRealmServer;
  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    synapse = await synapseStart();
    await registerRealmUsers(synapse);
    realmServer = await startRealmServer();
    await registerUser(synapse, 'user1', 'pass');
    await registerUser(synapse, 'user2', 'pass');
    await clearLocalStorage(page, appURL);
    await setupUserSubscribed('@user1:localhost', realmServer);
    await setupUserSubscribed('@user2:localhost', realmServer);
  });
  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
    await realmServer.stop();
  });

  async function attachSkill(
    page: Page,
    cardId: string,
    openSkillMenu = false,
  ) {
    if (openSkillMenu) {
      await expect(page.locator('[data-test-skill-menu]')).toHaveCount(1);
      await page.locator('[data-test-skill-menu]').hover();
      await page.locator('[data-test-pill-menu-header-button]').click();
    }
    await page.locator('[data-test-pill-menu-add-button]').click();
    await page.locator(`[data-test-select="${cardId}"]`).click();
    await page.locator('[data-test-card-catalog-go-button]').click();

    await expect(
      page.locator(`[data-test-pill-menu-item="${cardId}"]`),
    ).toHaveCount(1);
    await expect(
      page.locator(`[data-test-card-pill-toggle="${cardId}-on"]`),
    ).toHaveClass('switch checked');
  }

  const defaultSkillCardForInteractMode = `https://cardstack.com/base/Skill/card-editing`;
  const defaultSkillCardsForCodeMode = [
    `https://cardstack.com/base/Skill/source-code-editing`,
    `https://cardstack.com/base/Skill/boxel-coding`,
  ];
  const skillCard1 = `${appURL}/skill-pirate-speak`;
  const skillCard2 = `${appURL}/skill-seo`;
  const skillCard3 = `${appURL}/skill-card-title-editing`;

  test(`it can attach skill cards and toggle activation`, async ({ page }) => {
    await login(page, 'user1', 'pass', { url: appURL });
    await getRoomId(page);
    await expect(page.locator('[data-test-new-session]')).toHaveCount(1);
    await expect(page.locator('[data-test-skill-menu]')).toHaveCount(1);
    await expect(page.locator('[data-test-skill-menu]')).toHaveClass(
      'pill-menu pill-menu--minimized skill-menu skills',
    );
    await expect(page.locator('[data-test-pill-menu-header-button]')).toHaveCSS(
      'visibility',
      'collapse',
    );
    await expect(
      page.locator('[data-test-pill-menu-header] .skills-length'),
    ).toHaveCSS('visibility', 'collapse');

    await page.locator('[data-test-skill-menu]').hover();
    await expect(page.locator('[data-test-pill-menu-header-button]')).toHaveCSS(
      'visibility',
      'visible',
    );
    await expect(
      page.locator('[data-test-pill-menu-header] .skills-length'),
    ).toHaveCSS('visibility', 'visible');
    await expect(
      page.locator('[data-test-pill-menu-header] .detail'),
    ).toContainText('1 of 1 Skill Active');
    await expect(
      page.locator('[data-test-pill-menu-header-button]'),
    ).toHaveText('Show');

    await page.locator('[data-test-pill-menu-header-button]').click();
    await expect(page.locator('[data-test-skill-menu]')).toHaveClass(
      'pill-menu skill-menu skills',
    );
    await expect(
      page.locator('[data-test-pill-menu-header-button]'),
    ).toHaveText('Hide');
    await expect(page.locator('[data-test-pill-menu-item]')).toHaveCount(1);
    await expect(
      page.locator(
        `[data-test-pill-menu-item="${defaultSkillCardForInteractMode}"]`,
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(
        `[data-test-card-pill-toggle="${defaultSkillCardForInteractMode}-on"]`,
      ),
    ).toHaveCount(1);
    await expect(page.locator('[data-test-pill-menu-add-button]')).toHaveCount(
      1,
    );

    await attachSkill(page, skillCard1);
    await expect(
      page.locator(`[data-test-pill-menu-item="${skillCard1}"]`),
    ).toContainText('Talk Like a Pirate');
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '2 of 2 Skills Active',
    );

    await page
      .locator(`[data-test-card-pill-toggle="${skillCard1}-on"]`)
      .click();
    await expect(
      page.locator(`[data-test-card-pill-toggle="${skillCard1}-off"]`),
    ).toHaveClass('switch');
    await expect(
      page.locator(`[data-test-card-pill-toggle="${skillCard1}-on"]`),
    ).toHaveCount(0);
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '1 of 2 Skills Active',
    );

    await attachSkill(page, skillCard2);
    await expect(
      page.locator(`[data-test-pill-menu-item="${skillCard2}"]`),
    ).toContainText('SEO');
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '2 of 3 Skills Active',
    );

    await page
      .locator(`[data-test-card-pill-toggle="${skillCard1}-off"]`)
      .click();
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '3 of 3 Skills Active',
    );

    await attachSkill(page, skillCard3);
    await expect(
      page.locator(`[data-test-pill-menu-item="${skillCard3}"]`),
    ).toContainText('Card Title & Description Editing');
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '4 of 4 Skills Active',
    );

    await page
      .locator(`[data-test-card-pill-toggle="${skillCard3}-on"]`)
      .click();
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '3 of 4 Skills Active',
    );
  });

  test('it will attach code editing skills in code mode by default', async ({
    page,
  }) => {
    await login(page, 'user1', 'pass', { url: appURL });

    await page.locator('[data-test-submode-switcher] button').click();
    await page.locator('[data-test-boxel-menu-item-text="Code"]').click();
    await page.locator('[data-test-skill-menu]').hover();
    await page.locator('[data-test-pill-menu-header-button]').click();

    // Check that each default skill card for code mode is attached
    for (const skillCardURL of defaultSkillCardsForCodeMode) {
      await expect(
        page.locator(`[data-test-pill-menu-item="${skillCardURL}"]`),
        `Skill card ${skillCardURL} should be attached`,
      ).toHaveCount(1);

      await expect(
        page.locator(`[data-test-card-pill-toggle="${skillCardURL}-on"]`),
        `Skill card ${skillCardURL} should be active`,
      ).toHaveClass('switch checked');
    }
  });

  test(`room skills state does not leak when switching rooms`, async ({
    page,
  }) => {
    await login(page, 'user1', 'pass', { url: appURL });
    let room1 = await getRoomId(page);

    await attachSkill(page, skillCard1, true);
    await attachSkill(page, skillCard2);
    await attachSkill(page, skillCard3);
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '4 of 4 Skills Active',
    );
    await sendMessage(page, room1, 'Room 1'); // sending a message to be able to create new room

    let room2 = await createRoom(page);
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '1 of 1 Skill Active',
    );
    await attachSkill(page, skillCard2, true);
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '2 of 2 Skills Active',
    );
    await sendMessage(page, room2, 'Room 2'); // sending a message to be able to create new room

    let room3 = await createRoom(page);
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '1 of 1 Skill Active',
    );
    await attachSkill(page, skillCard3, true);
    await attachSkill(page, skillCard2);
    await page
      .locator(`[data-test-card-pill-toggle="${skillCard2}-on"]`)
      .click();
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '2 of 3 Skills Active',
    );

    await openRoom(page, room1);
    await isInRoom(page, room1);
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '4 of 4 Skills Active',
    );

    await openRoom(page, room2);
    await isInRoom(page, room2);
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '2 of 2 Skills Active',
    );

    await openRoom(page, room3);
    await isInRoom(page, room3);
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '2 of 3 Skills Active',
    );
  });

  test(`can attach more skills during chat`, async ({ page }) => {
    await login(page, 'user1', 'pass', { url: appURL });
    let room1 = await getRoomId(page);
    await attachSkill(page, skillCard2, true);
    await sendMessage(page, room1, 'Message 1');
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);
    await attachSkill(page, skillCard1, true);
    await attachSkill(page, skillCard3);
    await sendMessage(page, room1, 'Message 2');
    await assertMessages(page, [
      { from: 'user1', message: 'Message 1' },
      { from: 'user1', message: 'Message 2' },
    ]);
  });

  test(`can disable all skills`, async ({ page }) => {
    await login(page, 'user1', 'pass', { url: appURL });
    let room1 = await getRoomId(page);
    await attachSkill(page, skillCard1, true);
    await attachSkill(page, skillCard2);
    await sendMessage(page, room1, 'Message 1');
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);

    expect(page.locator('[data-test-active-skills-count]')).toHaveText('3');
    await page.locator('[data-test-skill-menu]').hover();
    await page.locator('[data-test-pill-menu-header-button]').click();
    await page
      .locator(
        `[data-test-card-pill-toggle="${defaultSkillCardForInteractMode}-on"]`,
      )
      .click(); // toggle off default skill card
    await page
      .locator(`[data-test-card-pill-toggle="${skillCard1}-on"]`)
      .click(); // toggle off skill 1
    await page
      .locator(`[data-test-card-pill-toggle="${skillCard2}-on"]`)
      .click(); // toggle off skill 2
    await expect(
      page.locator(
        `[data-test-card-pill-toggle="${defaultSkillCardForInteractMode}-off"]`,
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(`[data-test-card-pill-toggle="${skillCard1}-off"]`),
    ).toHaveCount(1);
    await expect(
      page.locator(`[data-test-card-pill-toggle="${skillCard2}-off"]`),
    ).toHaveCount(1);
    await sendMessage(page, room1, 'Message 2');
    await assertMessages(page, [
      { from: 'user1', message: 'Message 1' },
      { from: 'user1', message: 'Message 2' },
    ]);
    expect(page.locator('[data-test-active-skills-count]')).toHaveText('0');
  });

  test(`previously disabled skills can be enabled`, async ({ page }) => {
    await login(page, 'user1', 'pass', { url: appURL });
    let room1 = await getRoomId(page);
    await attachSkill(page, skillCard1, true);
    await attachSkill(page, skillCard2);
    await page
      .locator(`[data-test-card-pill-toggle="${skillCard2}-on"]`)
      .click(); // toggle off skill 2
    await expect(
      page.locator(`[data-test-card-pill-toggle="${skillCard2}-off"]`),
    ).toHaveCount(1);
    await sendMessage(page, room1, 'Message 1');
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);

    await page.locator('[data-test-skill-menu]').hover();
    await page.locator('[data-test-pill-menu-header-button]').click();
    await page
      .locator(`[data-test-card-pill-toggle="${skillCard2}-off"]`)
      .click(); // toggle on skill 2
    await expect(
      page.locator(`[data-test-card-pill-toggle="${skillCard2}-on"]`),
    ).toHaveCount(1);
    await sendMessage(page, room1, 'Message 2');
    await assertMessages(page, [
      { from: 'user1', message: 'Message 1' },
      { from: 'user1', message: 'Message 2' },
    ]);
  });

  test(`skills are persisted per room and do not leak between different users`, async ({
    page,
  }) => {
    await login(page, 'user1', 'pass', { url: appURL });
    let room1 = await getRoomId(page);
    await attachSkill(page, skillCard1, true);
    await attachSkill(page, skillCard2);
    await page
      .locator(`[data-test-card-pill-toggle="${skillCard1}-on"]`)
      .click();
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '2 of 3 Skills Active',
    );

    await reloadAndOpenAiAssistant(page);
    await openRoom(page, room1);
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '2 of 3 Skills Active',
    );

    await logout(page);
    await login(page, 'user2', 'pass', { url: appURL });
    await getRoomId(page);
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '1 of 1 Skill Active',
    );
    await attachSkill(page, skillCard3, true);
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '2 of 2 Skills Active',
    );

    await logout(page);
    await login(page, 'user1', 'pass', { url: appURL });
    await openRoom(page, room1);
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '2 of 3 Skills Active',
    );
  });
});
