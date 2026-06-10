import { test, expect } from './fixtures.ts';
import { readFileSync } from 'fs';
import { appURL } from '../support/isolated-realm-server.ts';
import {
  createSubscribedUser,
  login,
  setupPermissions,
} from '../helpers/index.ts';
import type { Credentials } from '../support/synapse/index.ts';

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

    // Verify the download completed and the file is a valid zip. Read from
    // the saved path rather than consuming `createReadStream()` and breaking
    // out after the first chunk: a half-consumed download stream left open
    // throws `readableStreamImpl._read: Test ended` during teardown, which
    // Playwright reports as an error "not a part of any test" and fails the
    // run with a non-zero exit even when every test itself passed.
    const path = await download.path();
    expect(path).toBeTruthy();
    const buffer = readFileSync(path!);

    // ZIP files start with 'PK' (0x50 0x4B)
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });
});
