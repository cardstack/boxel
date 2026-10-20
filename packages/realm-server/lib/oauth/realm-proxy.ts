import {
  impersonateAsMatrixAdmin,
  logoutMatrixAccessToken,
} from '../../synapse.ts';

// Obtain a realm session for the consenting user. Matrix and realm credentials
// never leave the authorization service; no owner credential is substituted.
export async function userRealmSession(
  user: string,
  realm: string,
): Promise<string> {
  let matrixURL = new URL(process.env.MATRIX_URL!);
  let token = await impersonateAsMatrixAdmin({
    matrixURL,
    userId: user,
    adminUsername: process.env.MATRIX_ADMIN_USERNAME!,
    adminPassword: process.env.MATRIX_ADMIN_PASSWORD!,
  });
  try {
    let openid = await fetch(
      new URL(
        `_matrix/client/v3/user/${encodeURIComponent(user)}/openid/request_token`,
        matrixURL,
      ),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!openid.ok) throw new Error('Unable to establish user realm session');
    let response = await fetch(new URL('_session', realm), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(await openid.json()),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    let jwt = response.headers.get('Authorization');
    if (!response.ok || !jwt) throw new Error('Realm declined user session');
    return jwt;
  } finally {
    await logoutMatrixAccessToken({ matrixURL, accessToken: token });
  }
}
