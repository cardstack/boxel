import { expect, test } from '../../fixtures.ts';
import { getSharedSQLExecutor } from '../../../helpers/index.ts';
import {
  fillRegistration,
  followEmailLink,
  openSecurePage,
  signedInUser,
  uniqueName,
} from '../../../helpers/secure-origin-pages.ts';

// Creating an account on the secure origin where the Matrix server lets anyone
// register, as production's does. This run's Synapse is started from the
// `test-without-registration-token` template, so it asks for no invite code.

test.describe('The secure origin’s pages where registration is open', () => {
  test('creates an account without an invite step', async ({ page }) => {
    let username = uniqueName('secure-open');
    let email = `${username}@example.com`;
    let secure = await openSecurePage(page, 'register');
    await fillRegistration(secure, {
      name: 'Open Registrant',
      email,
      username,
    });
    await secure.locator('[data-test-register-btn]').click();
    await expect(secure.locator('[data-test-email-validation]')).toBeVisible();
    await expect(secure.locator('[data-test-token-field]')).toBeHidden();
    await followEmailLink(secure, email, 'Verify Email');
    expect(await signedInUser(secure)).toBe(`@${username}:localhost`);
    let [record] = await getSharedSQLExecutor().executeSQL(
      `SELECT matrix_registration_token FROM users WHERE matrix_user_id = '@${username}:localhost'`,
    );
    expect(record?.matrix_registration_token ?? null).toBeNull();
  });
});
