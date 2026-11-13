import { generateKeyPairSync, randomBytes } from 'node:crypto';
import type { DBAdapter } from '@cardstack/runtime-common';
import type { OAuthProviderConfig } from '../../lib/oauth-provider/config.ts';

// The OAuth provider's configuration for tests: cookie keys and a signing key
// made fresh for each test process, never a value any environment uses.
let config: OAuthProviderConfig | undefined;

export function testOAuthProviderConfig(): OAuthProviderConfig {
  if (!config) {
    let { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    config = {
      cookieKeys: [randomBytes(32).toString('base64url')],
      jwks: {
        keys: [
          {
            ...(privateKey.export({ format: 'jwk' }) as Record<
              string,
              unknown
            >),
            kid: 'test-oauth-provider',
            use: 'sig',
            alg: 'RS256',
          },
        ],
      },
    };
  }
  return config;
}

// A secure origin for tests that turn the provider on: it needs one for its
// pages.
export const testOAuthSecureOriginURL = new URL(
  'https://secure.oauth-provider.test/secure',
);

// A database for tests that start the provider but never send it a request:
// starting it reads nothing, so any use of this one fails the test.
export const unusedDBAdapter = new Proxy({} as DBAdapter, {
  get(_target, property) {
    throw new Error(
      `the OAuth provider used its database (${String(property)}) before any request`,
    );
  },
});
