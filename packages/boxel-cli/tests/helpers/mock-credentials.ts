export const TEST_MATRIX_URL = 'https://matrix.test.local/';
export const TEST_REALM_URL = 'https://realm.test.local/testuser/workspace/';
export const TEST_USERNAME = 'testuser';
export const TEST_PASSWORD = 'testpassword';
export const TEST_USER_ID = '@testuser:test.local';
export const TEST_ACCESS_TOKEN = 'test_access_token_abc123';
export const TEST_DEVICE_ID = 'TESTDEVICE01';
export const TEST_SESSION_ROOM = '!testroom:test.local';

export function createMockJWT(
  overrides: Partial<{
    exp: number;
    user: string;
    realm: string;
    permissions: string[];
    sessionRoom: string;
  }> = {},
): string {
  const header = { alg: 'none', typ: 'JWT' };
  const payload = {
    iat: Math.floor(Date.now() / 1000),
    exp: overrides.exp ?? Math.floor(Date.now() / 1000) + 3600,
    user: overrides.user ?? TEST_USER_ID,
    realm: overrides.realm ?? TEST_REALM_URL,
    permissions: overrides.permissions ?? ['read', 'write'],
    sessionRoom: overrides.sessionRoom ?? TEST_SESSION_ROOM,
  };
  const signature = 'mock_signature';

  const encode = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString('base64');

  return `${encode(header)}.${encode(payload)}.${Buffer.from(signature).toString('base64')}`;
}

export function createMockOpenIdToken() {
  return {
    access_token: 'openid_token_xyz',
    expires_in: 3600,
    matrix_server_name: 'test.local',
    token_type: 'Bearer',
  };
}
