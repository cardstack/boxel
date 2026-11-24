/* eslint-env node */

// Prints the OAuth provider's configuration, BOXEL_OAUTH_CONFIG: cookie keys
// and a signing key set.
//
// With no arguments, for a development stack: the keys are made the first
// time this runs and kept in a gitignored file beside the package, so
// restarting the stack keeps flows in progress working. Delete the file to
// make new keys.
//
// With `--new --kid <id>`, for a deployed environment: new keys, printed and
// never written anywhere, for an operator to pipe straight into the
// environment's secret store (the `oauth-provider` skill). The `kid` names the
// signing key, e.g. `staging-2026-11`.
//
// No key is ever committed: a committed private key is one that can end up in
// a real deployment.

import { generateKeyPairSync, randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';

function newConfig(kid: string) {
  let { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    cookieKeys: [randomBytes(32).toString('base64url')],
    jwks: {
      keys: [
        {
          ...(privateKey.export({ format: 'jwk' }) as Record<string, unknown>),
          kid,
          use: 'sig',
          alg: 'RS256',
        },
      ],
    },
  };
}

let { values } = parseArgs({
  options: {
    new: { type: 'boolean', default: false },
    kid: { type: 'string' },
  },
});

if (values.new) {
  if (!values.kid) {
    console.error('--new needs --kid <id> to name the signing key');
    process.exit(1);
  }
  console.log(JSON.stringify(newConfig(values.kid)));
} else {
  const configFile = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '.oauth-provider-dev-config.json',
  );
  if (!existsSync(configFile)) {
    writeFileSync(
      configFile,
      JSON.stringify(newConfig('development-oauth-provider')),
      { mode: 0o600 },
    );
  }
  console.log(readFileSync(configFile, 'utf8').trim());
}
