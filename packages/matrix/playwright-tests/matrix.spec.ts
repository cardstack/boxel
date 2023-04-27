import { test, expect } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  SYNAPSE_PORT,
  type SynapseInstance,
} from '../docker/synapse';

test.describe('Synapse Smoke test', () => {
  let synapse: SynapseInstance;

  test.beforeEach(async () => {
    synapse = await synapseStart();
  });

  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
  });

  test('synapse welcome page', async ({ page }) => {
    await page.goto(`http://localhost:${SYNAPSE_PORT}`);
    await expect(page.getByText('It works! Synapse is running')).toBeVisible();
  });
});
