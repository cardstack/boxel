import { test, expect } from './fixtures';
import { appURL } from '../helpers/isolated-realm-server';
import {
  createSubscribedUser,
  login,
  setupPermissions,
} from '../helpers';
import type { Credentials } from '../docker/synapse';

test.describe('Download Realm', () => {
  let credentials: Credentials;
  let username: string;
  let password: string;

  test.beforeEach(async () => {
    ({ username, password, credentials } =
      await createSubscribedUser('download-realm'));
    await setupPermissions(credentials.userId, `${appURL}/`);
  });

  test('can download a realm as a streaming zip file in code submode', async ({
    page,
  }) => {
    const operatorModeState = {
      stacks: [],
      codePath: `${appURL}/index.json`,
      submode: 'code',
      fileView: 'browser',
      openDirs: {},
    };
    const stateParam = encodeURIComponent(JSON.stringify(operatorModeState));
    await login(page, username, password, {
      url: `${appURL}?operatorModeState=${stateParam}`,
    });

    // Wait for the code submode to load
    await expect(page.locator('[data-test-file-browser-toggle]')).toBeVisible();

    // Wait for the download button to appear
    await expect(
      page.locator('[data-test-download-realm-button]'),
    ).toBeVisible();

    // Start waiting for download before clicking
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-test-download-realm-button]').click();

    // Wait for the download to complete
    const download = await downloadPromise;

    // Verify the download filename ends with .zip
    expect(download.suggestedFilename()).toMatch(/\.zip$/);

    // Read the downloaded content to verify it's a valid zip file
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
      // Only need first few bytes to verify zip signature
      if (chunks.reduce((acc, c) => acc + c.length, 0) >= 4) {
        break;
      }
    }
    const buffer = Buffer.concat(chunks);

    // ZIP files start with 'PK' (0x50 0x4B)
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);

    // Verify the download completed (streaming worked)
    const path = await download.path();
    expect(path).toBeTruthy();
  });
});
