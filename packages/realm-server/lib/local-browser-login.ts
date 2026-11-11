import jsonwebtoken from 'jsonwebtoken';

export function createLocalBrowserLogin(options: {
  matrixURL: string;
  matrixServerName: string;
  matrixJwtSecret: string;
  fetch?: typeof fetch;
}) {
  const matrix = new URL(options.matrixURL);
  if (
    matrix.protocol !== 'http:' ||
    matrix.hostname !== '127.0.0.1' ||
    !/^[a-f0-9]{64}$/.test(options.matrixJwtSecret)
  )
    throw new Error('Invalid native browser sign-in configuration');
  const exchange = options.fetch ?? fetch;
  return async (request: {
    userId: string;
    accessToken: string;
  }): Promise<{ loginToken: string; expiresInMs: number }> => {
    try {
      if (
        typeof request.userId !== 'string' ||
        !request.userId.startsWith('@') ||
        !request.userId.endsWith(`:${options.matrixServerName}`) ||
        request.userId.length > 255 ||
        typeof request.accessToken !== 'string' ||
        !request.accessToken ||
        request.accessToken.length > 8192
      )
        throw new Error('Native browser sign-in rejected');
      const who = await exchange(
        new URL('_matrix/client/v3/account/whoami', matrix),
        {
          headers: { Authorization: `Bearer ${request.accessToken}` },
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!who.ok) throw new Error('Native browser sign-in rejected');
      const identity: unknown = await who.json();
      if (
        !identity ||
        typeof identity !== 'object' ||
        !('user_id' in identity) ||
        identity.user_id !== request.userId
      )
        throw new Error('Native browser sign-in rejected');
      const localpart = request.userId.slice(
        1,
        -`:${options.matrixServerName}`.length,
      );
      if (!/^[a-z0-9._=/-]+$/.test(localpart))
        throw new Error('Native browser sign-in rejected');
      const proof = jsonwebtoken.sign(
        { sub: localpart },
        options.matrixJwtSecret,
        {
          algorithm: 'HS256',
          issuer: 'boxel-local',
          audience: 'boxel-local-matrix',
          expiresIn: 30,
        },
      );
      const response = await exchange(
        new URL('_matrix/client/v1/login/get_token', matrix),
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${request.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            auth: { type: 'org.matrix.login.jwt', token: proof },
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) throw new Error('Native browser sign-in rejected');
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== 'object' ||
        !('login_token' in result) ||
        typeof result.login_token !== 'string' ||
        !result.login_token ||
        result.login_token.length > 8192 ||
        !('expires_in_ms' in result) ||
        typeof result.expires_in_ms !== 'number' ||
        !Number.isSafeInteger(result.expires_in_ms) ||
        result.expires_in_ms <= 0 ||
        result.expires_in_ms > 300_000
      )
        throw new Error('Native browser sign-in rejected');
      return {
        loginToken: result.login_token,
        expiresInMs: result.expires_in_ms,
      };
    } catch {
      throw new Error('Native browser sign-in rejected');
    }
  };
}
