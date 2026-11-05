import { settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

// Users sign in on the secure origin, a page a test can't drive. A test that
// only needs to get past the signed-out landing, against the mock Matrix
// server, signs in here instead: it starts the Matrix service with the
// session the secure origin's hand-off gives the app.
export async function signInThroughSecureOrigin(
  userId = '@testuser:localhost',
) {
  if (!document.querySelector('[data-test-secure-sign-in-landing]')) {
    throw new Error('the signed-out landing is not on the page');
  }
  await getService('matrix-service').start({
    auth: {
      access_token: 'mock-access-token',
      device_id: 'mock-device-id',
      user_id: userId,
    },
    refreshRoutes: true,
  });
  await settled();
}
