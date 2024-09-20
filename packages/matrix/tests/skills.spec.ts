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
  testHost,
  reloadAndOpenAiAssistant,
  isInRoom,
  registerRealmUsers,
  getRoomEvents,
} from '../helpers';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
} from '../docker/synapse';

test.describe('Skills', () => {
  let synapse: SynapseInstance;
  test.beforeEach(async () => {
    synapse = await synapseStart();
    await registerRealmUsers(synapse);
    await registerUser(synapse, 'user1', 'pass');
    await registerUser(synapse, 'user2', 'pass');
  });
  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
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

  const defaultSkillCard = `https://cardstack.com/base/SkillCard/card-editing`;
  const skillCard1 = `${testHost}/skill-pirate-speak`;
  const skillCard2 = `${testHost}/skill-seo`;
  const skillCard3 = `${testHost}/skill-card-title-editing`;

  test(`it can attach skill cards and toggle activation`, async ({ page }) => {
    await login(page, 'user1', 'pass');
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
      page.locator(`[data-test-pill-menu-item="${defaultSkillCard}"]`),
    ).toHaveCount(1);
    await expect(
      page.locator(`[data-test-card-pill-toggle="${defaultSkillCard}-on"]`),
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

  test(`room skills state does not leak when switching rooms`, async ({
    page,
  }) => {
    await login(page, 'user1', 'pass');
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

  test(`enabled skills are attached to sent messages`, async ({ page }) => {
    await login(page, 'user1', 'pass');
    let room1 = await getRoomId(page);
    await attachSkill(page, skillCard1, true);
    await attachSkill(page, skillCard2);
    await attachSkill(page, skillCard3);
    await page
      .locator(`[data-test-card-pill-toggle="${skillCard3}-on"]`)
      .click(); // toggle off skill 3
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '3 of 4 Skills Active',
    );

    await sendMessage(page, room1, 'Hello!');
    await assertMessages(page, [{ from: 'user1', message: 'Hello' }]);

    let events = await getRoomEvents('user1', 'pass', room1);
    let messages = events.filter(
      (ev) =>
        ev.type === 'm.room.message' &&
        ev.content?.msgtype === 'org.boxel.message',
    );
    let { attachedSkillEventIds } = JSON.parse(messages[0]?.content?.data);
    expect(attachedSkillEventIds).toHaveLength(3);

    let cardFragments = events.filter(
      (ev) =>
        ev.type === 'm.room.message' &&
        ev.content?.msgtype === 'org.boxel.cardFragment',
    );
    expect(cardFragments.length).toStrictEqual(3);
    let [fragment1, fragment2, fragment3] = cardFragments;
    expect(fragment1.content.data).toContain(defaultSkillCard);
    expect(fragment2.content.data).toContain(skillCard1);
    expect(fragment3.content.data).toContain(skillCard2);
    expect(cardFragments).not.toContain(skillCard3);

    let [defaultSkillCardEventId, skillEventId1, skillEventId2] =
      attachedSkillEventIds;
    expect(fragment1.event_id).toStrictEqual(defaultSkillCardEventId);
    expect(fragment2.event_id).toStrictEqual(skillEventId1);
    expect(fragment3.event_id).toStrictEqual(skillEventId2);
  });

  test(`can attach more skills during chat`, async ({ page }) => {
    await login(page, 'user1', 'pass');
    let room1 = await getRoomId(page);
    await attachSkill(page, skillCard2, true);
    await sendMessage(page, room1, 'Message 1');
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);
    let events = await getRoomEvents('user1', 'pass', room1);
    let messages = events.filter(
      (ev) =>
        ev.type === 'm.room.message' &&
        ev.content?.msgtype === 'org.boxel.message',
    );
    let { attachedSkillEventIds } = JSON.parse(messages[0]?.content?.data);
    expect(attachedSkillEventIds).toHaveLength(2);

    await attachSkill(page, skillCard1, true);
    await attachSkill(page, skillCard3);
    await sendMessage(page, room1, 'Message 2');
    await assertMessages(page, [
      { from: 'user1', message: 'Message 1' },
      { from: 'user1', message: 'Message 2' },
    ]);
    events = await getRoomEvents('user1', 'pass', room1);
    messages = events.filter(
      (ev) =>
        ev.type === 'm.room.message' &&
        ev.content?.msgtype === 'org.boxel.message',
    );
    expect(messages[1].content.body).toStrictEqual('Message 2');
    attachedSkillEventIds = JSON.parse(
      messages[1]?.content.data,
    ).attachedSkillEventIds;
    expect(attachedSkillEventIds).toHaveLength(4);
  });

  test(`disabled skills are not attached to sent message`, async ({ page }) => {
    await login(page, 'user1', 'pass');
    let room1 = await getRoomId(page);
    await attachSkill(page, skillCard1, true);
    await attachSkill(page, skillCard2);
    await sendMessage(page, room1, 'Message 1');
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);
    let events = await getRoomEvents('user1', 'pass', room1);
    let messages = events.filter(
      (ev) =>
        ev.type === 'm.room.message' &&
        ev.content?.msgtype === 'org.boxel.message',
    );
    let { attachedSkillEventIds } = JSON.parse(messages[0]?.content?.data);
    expect(attachedSkillEventIds).toHaveLength(3);

    await page.locator('[data-test-skill-menu]').hover();
    await page.locator('[data-test-pill-menu-header-button]').click();
    await page
      .locator(`[data-test-card-pill-toggle="${skillCard1}-on"]`)
      .click(); // toggle off skill 1
    await expect(
      page.locator(`[data-test-card-pill-toggle="${skillCard1}-off"]`),
    ).toHaveCount(1);
    await sendMessage(page, room1, 'Message 2');
    await assertMessages(page, [
      { from: 'user1', message: 'Message 1' },
      { from: 'user1', message: 'Message 2' },
    ]);
    events = await getRoomEvents('user1', 'pass', room1);
    messages = events.filter(
      (ev) =>
        ev.type === 'm.room.message' &&
        ev.content?.msgtype === 'org.boxel.message',
    );
    expect(messages[1].content.body).toStrictEqual('Message 2');
    attachedSkillEventIds = JSON.parse(
      messages[1]?.content.data,
    ).attachedSkillEventIds;
    expect(attachedSkillEventIds).toHaveLength(2);

    let cardFragments = events.filter(
      (ev) =>
        ev.type === 'm.room.message' &&
        ev.content?.msgtype === 'org.boxel.cardFragment',
    );
    expect(cardFragments.length).toStrictEqual(3);
    expect(cardFragments[2].content.data).toContain(skillCard2);
  });

  test(`can disable all skills`, async ({ page }) => {
    await login(page, 'user1', 'pass');
    let room1 = await getRoomId(page);
    await attachSkill(page, skillCard1, true);
    await attachSkill(page, skillCard2);
    await sendMessage(page, room1, 'Message 1');
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);
    let events = await getRoomEvents('user1', 'pass', room1);
    let messages = events.filter(
      (ev) =>
        ev.type === 'm.room.message' &&
        ev.content?.msgtype === 'org.boxel.message',
    );
    let { attachedSkillEventIds } = JSON.parse(messages[0]?.content?.data);
    expect(attachedSkillEventIds).toHaveLength(3);

    await page.locator('[data-test-skill-menu]').hover();
    await page.locator('[data-test-pill-menu-header-button]').click();
    await page
      .locator(`[data-test-card-pill-toggle="${defaultSkillCard}-on"]`)
      .click(); // toggle off default skill card
    await page
      .locator(`[data-test-card-pill-toggle="${skillCard1}-on"]`)
      .click(); // toggle off skill 1
    await page
      .locator(`[data-test-card-pill-toggle="${skillCard2}-on"]`)
      .click(); // toggle off skill 2
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
    events = await getRoomEvents('user1', 'pass', room1);
    messages = events.filter(
      (ev) =>
        ev.type === 'm.room.message' &&
        ev.content?.msgtype === 'org.boxel.message',
    );
    expect(messages[1].content.body).toStrictEqual('Message 2');
    attachedSkillEventIds = JSON.parse(
      messages[1]?.content.data,
    ).attachedSkillEventIds;
    expect(attachedSkillEventIds).toHaveLength(0);
  });

  test(`previously disabled skills can be enabled`, async ({ page }) => {
    await login(page, 'user1', 'pass');
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
    let events = await getRoomEvents('user1', 'pass', room1);
    let messages = events.filter(
      (ev) =>
        ev.type === 'm.room.message' &&
        ev.content?.msgtype === 'org.boxel.message',
    );
    let { attachedSkillEventIds } = JSON.parse(messages[0]?.content?.data);
    expect(attachedSkillEventIds).toHaveLength(2);

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
    events = await getRoomEvents('user1', 'pass', room1);
    messages = events.filter(
      (ev) =>
        ev.type === 'm.room.message' &&
        ev.content?.msgtype === 'org.boxel.message',
    );
    expect(messages[1].content.body).toStrictEqual('Message 2');
    attachedSkillEventIds = JSON.parse(
      messages[1]?.content.data,
    ).attachedSkillEventIds;
    expect(attachedSkillEventIds).toHaveLength(3);
  });

  test(`a message can include cards and skills at the same time`, async ({
    page,
  }) => {
    const testCard = `${testHost}/hassan`;
    await login(page, 'user1', 'pass');
    let room1 = await getRoomId(page);
    await attachSkill(page, skillCard1, true);
    await attachSkill(page, skillCard2);
    await sendMessage(page, room1, 'Message 1', [testCard]);
    await assertMessages(page, [
      {
        from: 'user1',
        message: 'Message 1',
        cards: [{ id: testCard, title: 'Hassan' }],
      },
    ]);
    let events = await getRoomEvents('user1', 'pass', room1);
    let messages = events.filter(
      (ev) =>
        ev.type === 'm.room.message' &&
        ev.content?.msgtype === 'org.boxel.message',
    );
    let { attachedCardsEventIds, attachedSkillEventIds } = JSON.parse(
      messages[0]?.content?.data,
    );
    expect(attachedCardsEventIds).toHaveLength(1);
    expect(attachedSkillEventIds).toHaveLength(3);
  });

  // TODO: CS-6985
  test.skip(`skills are persisted per room and do not leak between different users`, async ({
    page,
  }) => {
    await login(page, 'user1', 'pass');
    let room1 = await getRoomId(page);
    await attachSkill(page, skillCard1, true);
    await attachSkill(page, skillCard2);
    await page
      .locator(`[data-test-card-pill-toggle="${skillCard1}-on"]`)
      .click();
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '2 of 3 Skills Active',
    );

    await reloadAndOpenAiAssistant(page, 'skills-are-persisted-per-room');
    await openRoom(page, room1);
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '2 of 3 Skills Active',
    );

    await logout(page);
    await login(page, 'user2', 'pass');
    await getRoomId(page);
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '1 of 1 Skill Active',
    );
    await attachSkill(page, skillCard3, true);
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '2 of 2 Skill Active',
    );

    await logout(page);
    await login(page, 'user1', 'pass');
    await openRoom(page, room1);
    await expect(page.locator('[data-test-pill-menu-header]')).toContainText(
      '2 of 3 Skills Active',
    );
  });

  // TODO: CS-6985
  test.skip(`persisted enabled skills are attached to sent messages`, async () => {});
});
