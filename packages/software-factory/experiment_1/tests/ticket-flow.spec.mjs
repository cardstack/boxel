import { test, expect } from '@playwright/test';
import { seedBoxelLocalStorage } from './helpers/boxel-auth.mjs';

const guidanceTasksRealm = 'http://localhost:4201/factory/guidance-tasks/';
const demoProjectCard = `${guidanceTasksRealm}Project/demo-project`;
const softwareFactoryDemoRealm = 'http://localhost:4201/factory/software-factory-demo/';
const deliveryBriefCard = `${softwareFactoryDemoRealm}DeliveryBrief/factory-flow-check`;

test('authenticated browser can open a Boxel card directly in interact mode', async ({ page }) => {
  await seedBoxelLocalStorage(page, [guidanceTasksRealm]);
  await page.goto(demoProjectCard, { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Untitled Project' })).toBeVisible();
  await expect(page.getByText('Dark Factory Platform').first()).toBeVisible();
  await expect(page.getByText(/Tickets/i).first()).toBeVisible();
  await expect(page.getByText(/Knowledge Base/i).first()).toBeVisible();
});

test('authenticated browser can open the demo realm DeliveryBrief card', async ({ page }) => {
  await seedBoxelLocalStorage(page, [guidanceTasksRealm, softwareFactoryDemoRealm]);
  await page.goto(deliveryBriefCard, { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Authenticated Delivery Flow' })).toBeVisible();
  await expect(page.getByText('Verified').first()).toBeVisible();
  await expect(page.getByText(/first end-to-end software factory pass/i)).toBeVisible();
});
