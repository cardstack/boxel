import { resolve } from 'node:path';

import { expect, test } from './fixtures';

const adopterRealmDir = resolve(
  process.cwd(),
  'test-fixtures',
  'darkfactory-adopter',
);

test.use({ realmDir: adopterRealmDir });

test('renders a project adopted from the public DarkFactory module', async ({
  authedPage,
  cardURL,
}) => {
  await authedPage.goto(cardURL('project-demo'), {
    waitUntil: 'domcontentloaded',
  });

  await expect(
    authedPage.getByRole('heading', { name: 'DarkFactory Adoption Harness' }),
  ).toBeVisible();
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
  await authedPage.goto(cardURL('ticket-demo'), {
    waitUntil: 'domcontentloaded',
  });

  await expect(
    authedPage.getByRole('heading', {
      name: 'Verify public DarkFactory adoption',
    }),
  ).toBeVisible();
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
  await authedPage.goto(cardURL('knowledge-article-demo'), {
    waitUntil: 'domcontentloaded',
  });

  await expect(
    authedPage.getByRole('heading', { name: 'Agent Onboarding' }).first(),
  ).toBeVisible();
  await expect(
    authedPage.getByText('onboarding', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    authedPage.getByText(
      'Use the project card for scope, the ticket card for execution, and update notes as you go.',
    ),
  ).toBeVisible();

  await authedPage.goto(cardURL('agent-demo'), {
    waitUntil: 'domcontentloaded',
  });

  await expect(
    authedPage.getByRole('heading', { name: 'codex-darkfactory' }),
  ).toBeVisible();
  await expect(authedPage.getByText('Boxel tracker workflows')).toBeVisible();
  await expect(authedPage.getByText('ticket triage')).toBeVisible();
});

test('renders a DarkFactory card with active projects from the adopter realm', async ({
  authedPage,
  cardURL,
}) => {
  await authedPage.goto(cardURL('factory-demo'), {
    waitUntil: 'domcontentloaded',
  });

  await expect(
    authedPage.getByRole('heading', { name: 'DarkFactory Test Fixture' }),
  ).toBeVisible();
  await expect(
    authedPage.getByRole('heading', { name: 'Active Projects' }),
  ).toBeVisible();
  await expect(
    authedPage.getByText('DarkFactory Adoption Harness'),
  ).toBeVisible();
});
