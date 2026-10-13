import { click, settled } from '@ember/test-helpers';

import ENV from '@cardstack/host/config/environment';
import {
  CredentialFields,
  type CredentialFieldsResult,
} from '@cardstack/host/lib/credential-fields';

// The sign-in fields are a frame on the secure origin, which a test page can
// no more type into than card code can. A test that only needs to get past
// the sign-in form, against the mock Matrix server, signs in here instead: it
// has the form believe the fields are filled in and the mock homeserver's
// session come back, as the frame would report after a real sign-in.
export async function signInThroughCredentialFields(
  userId = '@testuser:localhost',
) {
  let frame = document.querySelector<HTMLIFrameElement>(
    '[data-test-credential-fields-frame="login"]',
  );
  if (!frame?.contentWindow) {
    throw new Error('the sign-in fields are not on the page');
  }
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: new URL(ENV.secureOriginURL).origin,
      source: frame.contentWindow,
      data: {
        type: 'state',
        complete: true,
        filled: { username: true, password: true },
      },
    }),
  );
  await settled();

  let submit = CredentialFields.prototype.submit;
  CredentialFields.prototype.submit = async function () {
    return {
      ok: true,
      status: 200,
      body: {
        access_token: 'mock-access-token',
        device_id: 'mock-device-id',
        user_id: userId,
      },
    } satisfies CredentialFieldsResult;
  };
  try {
    await click('[data-test-login-btn]');
  } finally {
    CredentialFields.prototype.submit = submit;
  }
}
