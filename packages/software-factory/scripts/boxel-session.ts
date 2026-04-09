// This should be first
import '../src/setup-logger';

import {
  buildBrowserAuth,
  buildBrowserSession,
  getAccessibleRealmTokens,
  matrixLogin,
  parseArgs,
  printJson,
} from './lib/boxel';
import { logger } from '../src/logger';

let log = logger('boxel-session');

async function main(): Promise<void> {
  let args = parseArgs(process.argv.slice(2));
  let matrixAuth = await matrixLogin();
  let realmTokens = await getAccessibleRealmTokens(matrixAuth);
  let requestedRealms =
    typeof args.realm === 'string'
      ? [args.realm]
      : Array.isArray(args.realm)
        ? args.realm
        : [];
  let session = buildBrowserSession(realmTokens, requestedRealms);

  printJson({
    profileId: matrixAuth.credentials.profileId,
    username: matrixAuth.credentials.username,
    auth: buildBrowserAuth(matrixAuth),
    boxelSession: session,
  });
}

main().catch((error: unknown) => {
  let message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  log.error(message);
  process.exit(1);
});
