/* eslint-env browser */
// The Matrix requests the secure origin's pages make themselves: creating an
// account (registration's user-interactive auth, the invite code and email
// validation), and resetting a password by email. They go to the Matrix
// server the realm server names in the page's markup, the one server besides
// the realm server the page's policy lets it reach.

export class MatrixError extends Error {
  // `status` 0 is a request that never reached the server.
  constructor(status, body) {
    super(body?.error ?? `HTTP ${status}`);
    this.status = status;
    this.errcode = body?.errcode;
    this.data = body ?? {};
  }
}

export function matrixURL() {
  return new URL(
    document
      .querySelector('meta[name="boxel-matrix-url"]')
      ?.getAttribute('content') ?? '',
  );
}

// A request to the Matrix client API. Resolves to the response's JSON, or
// rejects with a `MatrixError`; a 401 answering a user-interactive auth
// request carries the server's flows in `data`.
async function request(path, { method = 'POST', body, accessToken } = {}) {
  let headers = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  let response;
  try {
    response = await fetch(new URL(`_matrix/client/v3/${path}`, matrixURL()), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new MatrixError(0, { error: 'Could not connect to server' });
  }
  let json = {};
  try {
    json = await response.json();
  } catch {
    // Judged by its status alone.
  }
  if (!response.ok) {
    throw new MatrixError(response.status, json);
  }
  return json;
}

export async function isUsernameAvailable(username) {
  try {
    let json = await request(
      `register/available?username=${encodeURIComponent(username)}`,
      { method: 'GET' },
    );
    return json.available === true;
  } catch (e) {
    if (e.errcode === 'M_USER_IN_USE') {
      return false;
    }
    throw e;
  }
}

// A random secret for an email validation session, as the app makes one.
export function clientSecret() {
  return crypto.randomUUID();
}

// Asks the Matrix server to email a validation link. `kind` is
// 'registration' or 'password'. Resolves to the validation session's `sid`.
export async function requestEmailToken(
  kind,
  { email, clientSecret, sendAttempt, nextLink },
) {
  let json = await request(
    kind === 'registration'
      ? 'register/email/requestToken'
      : 'account/password/email/requestToken',
    {
      body: {
        email,
        client_secret: clientSecret,
        send_attempt: sendAttempt,
        next_link: nextLink,
      },
    },
  );
  return json.sid;
}

// One step of registration's user-interactive auth. Resolves to the new
// account (`user_id`, `access_token`) once every stage is complete, and
// rejects with the server's flows (a 401) while a stage remains.
export async function register({ username, password, auth }) {
  return await request('register', {
    body: {
      username,
      password,
      ...(auth ? { auth } : {}),
      initial_device_display_name: 'Boxel sign-in',
    },
  });
}

export async function setDisplayName(userId, accessToken, displayname) {
  await request(`profile/${encodeURIComponent(userId)}/displayname`, {
    method: 'PUT',
    accessToken,
    body: { displayname },
  });
}

export async function logout(accessToken) {
  await request('logout', { accessToken, body: {} });
}

// Sets a new password once the email validation session `sid` was
// confirmed from the email. Every device the account is signed in on is
// signed out, as the app's reset does.
export async function resetPassword({ sid, clientSecret, newPassword }) {
  await request('account/password', {
    body: {
      auth: {
        type: 'm.login.email.identity',
        threepid_creds: { sid, client_secret: clientSecret },
      },
      new_password: newPassword,
      logout_devices: true,
    },
  });
}
