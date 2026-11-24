// Prints the OAuth provider's configuration for a development stack: cookie
// keys and a signing key, made the first time this runs and kept in a
// gitignored file beside the package, so restarting the stack keeps flows in
// progress working. No key is ever committed: a committed private key is one
// that can end up in a real deployment. Delete the file to make new keys.

import { generateKeyPairSync, randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const configFile = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '.oauth-provider-dev-config.json',
);

if (!existsSync(configFile)) {
  let { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let config = {
    cookieKeys: [randomBytes(32).toString('base64url')],
    jwks: {
      keys: [
        {
          ...(privateKey.export({ format: 'jwk' }) as Record<string, unknown>),
          kid: 'development-oauth-provider',
          use: 'sig',
          alg: 'RS256',
        },
      ],
    },
  };
  writeFileSync(configFile, JSON.stringify(config), { mode: 0o600 });
}

console.log(readFileSync(configFile, 'utf8').trim());
