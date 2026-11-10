import { generateKeyPairSync, randomBytes } from 'node:crypto';
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
