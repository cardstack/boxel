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
  setSkillsRedirect,
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
    await setSkillsRedirect(page);
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
      await page
        .locator('[data-test-skill-menu][data-test-pill-menu-button]')
        .click();
    }
    await page.locator('[data-test-pill-menu-add-button]').click();
    await page.locator(`[data-test-select="${cardId}"]`).click();
    await page.locator('[data-test-card-catalog-go-button]').click();

    await expect(
      page.locator(`[data-test-pill-menu-item="${cardId}"]`),
    ).toHaveCount(1);
    await expect(
      page.locator(`[data-test-skill-toggle="${cardId}-on"]`),
    ).toContainClass('checked');
  }

  const environmentSkillCardId = `http://localhost:4205/skills/Skill/boxel-environment`;
  const defaultSkillCardsForCodeMode = [
    `http://localhost:4205/skills/Skill/source-code-editing`,
    `http://localhost:4205/skills/Skill/boxel-development`,
    `http://localhost:4205/skills/Skill/boxel-environment`,
  ];
  const skillCard1 = `${appURL}/skill-pirate-speak`;
  const skillCard2 = `${appURL}/skill-seo`;
  const skillCard3 = `${appURL}/skill-card-title-editing`;

  test(`it can attach skill cards and toggle activation`, async ({ page }) => {
    await login(page, 'user1', 'pass', { url: appURL });
    await getRoomId(page);
    await expect(page.locator('[data-test-new-session]')).toHaveCount(1);
    await expect(page.locator('[data-test-skill-menu]')).toHaveCount(1);

    await expect(page.locator('[data-test-active-skills-count]')).toContainText(
      '1 Skill',
    );
    await page
      .locator('[data-test-skill-menu][data-test-pill-menu-button]')
      .click();
    await expect(page.locator('[data-test-skill-menu]')).toContainText(
      'Skills: 1 of 1 active',
    );
    await expect(page.locator('[data-test-pill-menu-item]')).toHaveCount(1);
    await expect(
      page.locator(`[data-test-pill-menu-item="${environmentSkillCardId}"]`),
    ).toHaveCount(1);
    await expect(
      page.locator(`[data-test-skill-toggle="${environmentSkillCardId}-on"]`),
    ).toHaveCount(1);
    await expect(page.locator('[data-test-pill-menu-add-button]')).toHaveCount(
      1,
    );

    await attachSkill(page, skillCard1);
    await expect(
      page.locator(`[data-test-pill-menu-item="${skillCard1}"]`),
    ).toContainText('Talk Like a Pirate');
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      'Skills: 2 of 2 active',
    );

    await page.locator(`[data-test-skill-toggle="${skillCard1}-on"]`).click();
    await expect(
      page.locator(`[data-test-skill-toggle="${skillCard1}-off"]`),
    ).not.toContainClass('checked');
    await expect(
      page.locator(`[data-test-skill-toggle="${skillCard1}-on"]`),
    ).toHaveCount(0);
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      'Skills: 1 of 2 active',
    );

    await attachSkill(page, skillCard2);
    await expect(
      page.locator(`[data-test-pill-menu-item="${skillCard2}"]`),
    ).toContainText('SEO');
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      'Skills: 2 of 3 active',
    );

    await page.locator(`[data-test-skill-toggle="${skillCard1}-off"]`).click();
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      'Skills: 3 of 3 active',
    );

    await attachSkill(page, skillCard3);
    await expect(
      page.locator(`[data-test-pill-menu-item="${skillCard3}"]`),
    ).toContainText('Card Title & Description Editing');
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      'Skills: 4 of 4 active',
    );

    await page.locator(`[data-test-skill-toggle="${skillCard3}-on"]`).click();
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      'Skills: 3 of 4 active',
    );

    await page.locator('[data-test-pill-menu-detail-close]').click();
    await expect(page.locator('[data-test-active-skills-count]')).toContainText(
      '3 Skills',
    );
  });

  test('it will attach code editing skills in code mode by default', async ({
    page,
  }) => {
    await login(page, 'user1', 'pass', { url: appURL });
    await page.locator(`[data-test-room-settled]`).waitFor();

    await page.locator('[data-test-submode-switcher] button').click();
    await page.locator('[data-test-boxel-menu-item-text="Code"]').click();
    await page.locator('[data-test-skill-menu]').hover();
    await page
      .locator('[data-test-skill-menu][data-test-pill-menu-button]')
      .click();

    // Check that each default skill card for code mode is attached
    for (const skillCardURL of defaultSkillCardsForCodeMode) {
      await expect(
        page.locator(`[data-test-pill-menu-item="${skillCardURL}"]`),
        `Skill card ${skillCardURL} should be attached`,
      ).toHaveCount(1);

      await expect(
        page.locator(`[data-test-skill-toggle="${skillCardURL}-on"]`),
        `Skill card ${skillCardURL} should be active`,
      ).toContainClass('checked');
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
    await expect(page.locator('[data-test-skill-menu]')).toContainText(
      'Skills: 4 of 4 active',
    );
    await sendMessage(page, room1, 'Room 1'); // sending a message to be able to create new room

    let room2 = await createRoom(page);
    await expect(page.locator('[data-test-active-skills-count]')).toContainText(
      '1 Skill',
    );
    await attachSkill(page, skillCard2, true);
    await expect(page.locator('[data-test-skill-menu]')).toContainText(
      'Skills: 2 of 2 active',
    );
    await sendMessage(page, room2, 'Room 2'); // sending a message to be able to create new room

    let room3 = await createRoom(page);
    await expect(page.locator('[data-test-active-skills-count]')).toContainText(
      '1 Skill',
    );
    await attachSkill(page, skillCard3, true);
    await attachSkill(page, skillCard2);
    await page.locator(`[data-test-skill-toggle="${skillCard2}-on"]`).click();
    await expect(page.locator('[data-test-skill-menu]')).toContainText(
      'Skills: 2 of 3 active',
    );

    await page.locator('[data-test-pill-menu-button]').click();
    await openRoom(page, room1);
    await isInRoom(page, room1);
    await expect(page.locator('[data-test-active-skills-count]')).toContainText(
      '4 Skills',
    );

    await openRoom(page, room2);
    await isInRoom(page, room2);
    await expect(page.locator('[data-test-active-skills-count]')).toContainText(
      '2 Skills',
    );

    await openRoom(page, room3);
    await isInRoom(page, room3);
    await expect(page.locator('[data-test-active-skills-count]')).toContainText(
      '2 Skills',
    );
  });

  test(`can attach more skills during chat`, async ({ page }) => {
    await login(page, 'user1', 'pass', { url: appURL });
    let room1 = await getRoomId(page);
    await attachSkill(page, skillCard2, true);
    await sendMessage(page, room1, 'Message 1');
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);
    await attachSkill(page, skillCard1);
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
    await page.locator('[data-test-pill-menu-button]').click();
    await sendMessage(page, room1, 'Message 1');
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);

    expect(page.locator('[data-test-active-skills-count]')).toHaveText(
      '3 Skills',
    );
    await page.locator('[data-test-skill-menu]').hover();
    await page
      .locator('[data-test-skill-menu][data-test-pill-menu-button]')
      .click();
    await page
      .locator(`[data-test-skill-toggle="${environmentSkillCardId}-on"]`)
      .click(); // toggle off default skill card
    await page.locator(`[data-test-skill-toggle="${skillCard1}-on"]`).click(); // toggle off skill 1
    await page.locator(`[data-test-skill-toggle="${skillCard2}-on"]`).click(); // toggle off skill 2
    await expect(
      page.locator(`[data-test-skill-toggle="${environmentSkillCardId}-off"]`),
    ).toHaveCount(1);
    await expect(
      page.locator(`[data-test-skill-toggle="${skillCard1}-off"]`),
    ).toHaveCount(1);
    await expect(
      page.locator(`[data-test-skill-toggle="${skillCard2}-off"]`),
    ).toHaveCount(1);
    await page.locator('[data-test-pill-menu-button]').click();
    await sendMessage(page, room1, 'Message 2');
    await assertMessages(page, [
      { from: 'user1', message: 'Message 1' },
      { from: 'user1', message: 'Message 2' },
    ]);
    expect(page.locator('[data-test-active-skills-count]')).toHaveText(
      '0 Skills',
    );
  });

  test(`previously disabled skills can be enabled`, async ({ page }) => {
    await login(page, 'user1', 'pass', { url: appURL });
    let room1 = await getRoomId(page);
    await attachSkill(page, skillCard1, true);
    await attachSkill(page, skillCard2);
    await page.locator(`[data-test-skill-toggle="${skillCard2}-on"]`).click(); // toggle off skill 2
    await expect(
      page.locator(`[data-test-skill-toggle="${skillCard2}-off"]`),
    ).toHaveCount(1);
    await page.locator('[data-test-pill-menu-button]').click();
    await sendMessage(page, room1, 'Message 1');
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);

    await page.locator('[data-test-skill-menu]').hover();
    await page
      .locator('[data-test-skill-menu][data-test-pill-menu-button]')
      .click();
    await page.locator(`[data-test-skill-toggle="${skillCard2}-off"]`).click(); // toggle on skill 2
    await expect(
      page.locator(`[data-test-skill-toggle="${skillCard2}-on"]`),
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
    await page.locator(`[data-test-skill-toggle="${skillCard1}-on"]`).click();
    await expect(page.locator('[data-test-skill-menu]')).toContainText(
      'Skills: 2 of 3 active',
    );

    await reloadAndOpenAiAssistant(page);
    await openRoom(page, room1);
    await expect(page.locator('[data-test-active-skills-count]')).toContainText(
      '2 Skill',
    );

    await logout(page);
    await login(page, 'user2', 'pass', { url: appURL });
    await getRoomId(page);
    await expect(page.locator('[data-test-active-skills-count]')).toContainText(
      '1 Skill',
    );
    await attachSkill(page, skillCard3, true);
    await expect(page.locator('[data-test-skill-menu]')).toContainText(
      'Skills: 2 of 2 active',
    );

    await logout(page);
    await login(page, 'user1', 'pass', { url: appURL });
    await openRoom(page, room1);
    await expect(page.locator('[data-test-active-skills-count]')).toContainText(
      '2 Skills',
    );
  });

  test('ensure that the skill card from boxel index is not overwritten by the skill card from matrix store', async ({
    page,
  }) => {
    await login(page, 'user1', 'pass', { url: appURL });

    // create a skill card
    await page.locator('[data-test-create-new-card-button]').click();
    await page
      .locator('[data-test-select="https://cardstack.com/base/cards/skill"]')
      .click();
    await page.locator('[data-test-card-catalog-go-button]').click();
    await page
      .locator('[data-test-field="instructions"] textarea')
      .fill(
        'Here is a command you might find useful: * switch-submode: use this with "code" to go to code mode and "interact" to go to interact mode.',
      );
    await page
      .locator('[data-test-field="commands"] [data-test-add-new]')
      .click();
    await page
      .locator('[data-test-field="codeRef"] input')
      .fill('@cardstack/boxel-host/commands/switch-submode/default');
    await page
      .locator('[data-test-field="title"] input')
      .fill('Automatic Switch Command');
    await page.waitForSelector('[data-test-last-saved]');
    const cards = await page.locator('[data-test-card]').all();
    const skillCard =
      await cards[cards.length - 1].getAttribute('data-test-card');

    // close the Skill card
    await page.locator('[data-test-close-button]').click();

    // Add the skill card to the assistant
    await page
      .locator('[data-test-skill-menu][data-test-pill-menu-button]')
      .click();
    await page
      .locator('[data-test-skill-menu] [data-test-pill-menu-add-button]')
      .click();
    await page
      .locator('[data-test-card-catalog-item]', {
        hasText: 'Automatic Switch Command',
      })
      .click();
    await page.locator('[data-test-card-catalog-go-button]').click();

    // fill in message field with "Switch to code mode"
    await page
      .locator('[data-test-boxel-input-id="ai-chat-input"]')
      .fill('Switch to code mode');
    await page.locator('[data-test-send-message-btn]').click();
    await page.locator('[data-test-message-idx="0"]').waitFor();

    // Update the uploaded skill card
    await page.locator(`[data-cards-grid-item="${skillCard}"]`).click();
    await page.locator('[data-test-edit-button]').click();
    await page
      .locator('[data-test-field="instructions"] textarea')
      .fill(
        'Here is an updated command you might find useful: * switch-submode: use this with "code" to go to code mode and "interact" to go to interact mode.',
      );
    await page.waitForSelector('[data-test-last-saved]');
    await page.locator('[data-test-edit-button]').click();
    await page.locator('[data-test-close-ai-assistant]').click();

    // after reloading the page, the skill card will be instantiated from boxel index
    // and then when the ai panel is opened, the skill card from matrix store will be retrieved.
    // ensure that the skill card from boxel index is used.
    await page.reload();
    await expect(
      page.locator('[data-test-field="instructions"] .content'),
    ).toHaveText(
      'Here is an updated command you might find useful: * switch-submode: use this with "code" to go to code mode and "interact" to go to interact mode.',
    );
    await page.locator('[data-test-open-ai-assistant]').click();
    await expect(
      page.locator('[data-test-field="instructions"] .content'),
    ).toHaveText(
      'Here is an updated command you might find useful: * switch-submode: use this with "code" to go to code mode and "interact" to go to interact mode.',
    );
  });
});
