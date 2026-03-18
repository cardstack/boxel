import {
  buildBrowserAuth,
  buildBrowserSession,
  getAccessibleRealmTokens,
  matrixLogin,
  parseArgs,
  printJson,
} from './lib/boxel.mjs';

let args = parseArgs(process.argv.slice(2));
let matrixAuth = await matrixLogin();
let realmTokens = await getAccessibleRealmTokens(matrixAuth);
let requestedRealms = args.realm
  ? Array.isArray(args.realm)
    ? args.realm
    : [args.realm]
  : [];
let session = buildBrowserSession(realmTokens, requestedRealms);

printJson({
  profileId: matrixAuth.credentials.profileId,
  username: matrixAuth.credentials.username,
  auth: buildBrowserAuth(matrixAuth),
  boxelSession: session,
});
