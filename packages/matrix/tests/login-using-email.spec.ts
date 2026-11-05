import { test } from './fixtures.ts';
import { appURL } from '../support/isolated-realm-server.ts';
import {
  signInOnSecureOrigin,
  openRoot,
  assertLoggedIn,
  createSubscribedUser,
  updateSynapseUser,
} from '../helpers/index.ts';

test.describe('Login using email', () => {
  let user: {
    username: string;
    password: string;
    credentials: any;
  };
  let userEmail: string;

  test.beforeEach(async () => {
    user = await createSubscribedUser('email-login');
    userEmail = `${user.username}@example.com`;
    await updateSynapseUser(user.credentials.userId, {
      emailAddresses: [userEmail],
      displayname: 'Test User',
    });
  });

  test('Login using email', async ({ page }) => {
    await openRoot(page, appURL);

    await signInOnSecureOrigin(page, userEmail, user.password);
    await assertLoggedIn(page, {
      email: userEmail,
      userId: user.credentials.userId,
      displayName: 'Test User',
    });
  });
});
