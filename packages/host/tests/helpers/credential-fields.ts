import { settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

// The sign-in fields are a frame on the secure origin, which a test page can
// no more type into, or speak for, than card code can. A test that only needs
// to get past the sign-in form, against the mock Matrix server, signs in
// here instead: it starts the Matrix service with the session a sign-in
// through the frame hands the sign-in form.
export async function signInThroughCredentialFields(
  userId = '@testuser:localhost',
) {
  if (!document.querySelector('[data-test-credential-fields-frame="login"]')) {
    throw new Error('the sign-in fields are not on the page');
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
