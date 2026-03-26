import { resolve } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

const adopterRealmDir = resolve(
  process.cwd(),
  'test-fixtures',
  'darkfactory-adopter',
);

test.use({ realmDir: adopterRealmDir });
test.use({ realmServerMode: 'shared' });

async function gotoCard(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'commit' });
}

test('renders a project adopted from the public DarkFactory module', async ({
  authedPage,
  cardURL,
}) => {
  await gotoCard(authedPage, cardURL('project-demo'));

  await expect(
    authedPage.getByRole('heading', { name: 'DarkFactory Adoption Harness' }),
  ).toBeVisible({ timeout: 120_000 });
  await expect(
    authedPage.getByRole('heading', { name: 'Objective' }),
  ).toBeVisible();
  await expect(
    authedPage.getByRole('heading', { name: 'Success Criteria' }),
  ).toBeVisible();
  await expect(
    authedPage.getByRole('heading', { name: 'Knowledge Base' }),
  ).toBeVisible();
  await expect(authedPage.getByText('Agent Onboarding')).toBeVisible();
});

test('renders a ticket adopted from the public DarkFactory module', async ({
  authedPage,
  cardURL,
}) => {
  await gotoCard(authedPage, cardURL('ticket-demo'));

  await expect(
    authedPage.getByRole('heading', {
      name: 'Verify public DarkFactory adoption',
    }),
  ).toBeVisible({ timeout: 120_000 });
  await expect(
    authedPage.getByRole('heading', { name: 'Project' }),
  ).toBeVisible();
  await expect(
    authedPage.getByText('DarkFactory Adoption Harness'),
  ).toBeVisible();
  await expect(
    authedPage.getByRole('heading', { name: 'Acceptance Criteria' }),
  ).toBeVisible();
  await expect(
    authedPage.getByRole('heading', { name: 'Agent Notes' }),
  ).toBeVisible();
  await expect(
    authedPage.getByRole('heading', { name: 'Related Knowledge' }),
  ).toBeVisible();
});

test('renders a knowledge article and agent profile adopted from the public DarkFactory module', async ({
  authedPage,
  cardURL,
}) => {
  await gotoCard(authedPage, cardURL('knowledge-article-demo'));

  await expect(
    authedPage.getByRole('heading', { name: 'Agent Onboarding' }).first(),
  ).toBeVisible({ timeout: 120_000 });
  await expect(
    authedPage.getByText('onboarding', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    authedPage.getByText(
      'Use the project card for scope, the ticket card for execution, and update notes as you go.',
    ),
  ).toBeVisible();

  await gotoCard(authedPage, cardURL('agent-demo'));

  await expect(
    authedPage.getByRole('heading', { name: 'codex-darkfactory' }),
  ).toBeVisible({ timeout: 120_000 });
  await expect(authedPage.getByText('Boxel tracker workflows')).toBeVisible();
  await expect(authedPage.getByText('ticket triage')).toBeVisible();
});

test('renders a DarkFactory card with active projects from the adopter realm', async ({
  authedPage,
  cardURL,
}) => {
  await gotoCard(authedPage, cardURL('factory-demo'));

  await expect(
    authedPage.getByRole('heading', { name: 'DarkFactory Test Fixture' }),
  ).toBeVisible({ timeout: 120_000 });
  await expect(
    authedPage.getByRole('heading', { name: 'Active Projects' }),
  ).toBeVisible();
  await expect(
    authedPage.getByText('DarkFactory Adoption Harness'),
  ).toBeVisible();
});
