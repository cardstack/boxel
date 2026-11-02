import {
  getProfileManager,
  getUsernameFromMatrixId,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager.ts';
import { cliLog } from '../../lib/cli-log.ts';
import { DIM, FG_GREEN, FG_RED, RESET } from '../../lib/colors.ts';
import {
  checkKeyValueSource,
  readKeyValue,
  type KeyValueSource,
} from '../../lib/key-value.ts';
import { destinationCovers } from '@cardstack/runtime-common/card-operations/destination-covers';
import { openBrowser } from '../../lib/open-browser.ts';
import { prompt } from '../../lib/prompt.ts';
import {
  realmServerRequest,
  secureSignIn,
  secureSignOut,
  SecureSessionRequestError,
} from '../../lib/secure-session.ts';
import {
  SsoTimeoutError,
  startLoopbackCallback,
  type PostedSecureSession,
} from '../../lib/sso-login.ts';
import {
  addUserKey,
  canonicalRealmUrl,
  deleteUserKey,
  findUserKey,
  listConnectableClients,
  listOwnShares,
  listRealmShares,
  listUserKeys,
  replaceUserKey,
  shareUserKey,
  completeOAuthConnect,
  startOAuthConnect,
  swapKeyIntoShare,
  unshareUserKey,
  type ConnectableClient,
  type KeyShare,
  type OAuthClientSettings,
  type OAuthConnectOutcome,
  type ServiceAccountDetails,
  type UserKeyMetadata,
} from '../../lib/user-keys.ts';
import { finishInSecureWindow, windowTimeout } from './approve.ts';

// The commands that manage the signed-in user's own keys and the shares that
// put them into realms. Keys belong to the user, so only the share commands
// name a realm.
//
// Reading (`list`, `show`, `shares`, `clients`) and unsharing use the
// profile's ordinary realm-server session. A change that stores or hands out
// a key (`add`, `replace`, `delete`, `share`, `swap`, `connect`) takes a key
// write ticket for that change, which only a session signed in on the secure
// origin can mint, so those commands first make sure the profile holds one,
// opening the secure window's sign-in in the browser when it doesn't.
//
// A key's value is typed at a masked prompt or read with `--stdin` or
// `--key-file`, never taken as an argument, and nothing prints one. A refusal
// prints with the server's reason, and under `--json` the server's `errors`
// pass through unchanged.

// After Enter the masked prompt shows at most the last 4 characters, never
// more than a quarter of the value, and nothing of a value of 8 characters
// or fewer.
const REVEAL_LAST = 4;
const REVEAL_NONE_AT_OR_BELOW = 8;

export interface KeysCommandDeps {
  profileManager?: ProfileManager;
  // Injected by tests, which act as the browser.
  openBrowserFn?: (url: string) => Promise<boolean>;
  // Whether someone is there to finish a sign-in in the browser. Defaults to
  // whether stderr is a terminal.
  interactive?: boolean;
  // Injected by tests: where a value is typed, and the answer to `delete`'s
  // confirmation.
  input?: NodeJS.ReadStream;
  output?: NodeJS.WritableStream;
  confirmFn?: (question: string) => Promise<boolean>;
}

export interface Context {
  pm: ProfileManager;
  realmServerUrl: string;
  matrixUserId: string;
  json: boolean;
  deps: KeysCommandDeps;
}

export function context(
  json: boolean | undefined,
  deps: KeysCommandDeps,
): Context {
  let pm = deps.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    throw new Error(NO_ACTIVE_PROFILE_ERROR);
  }
  return {
    pm,
    realmServerUrl: active.profile.realmServerUrl,
    matrixUserId: active.profile.matrixUserId,
    json: Boolean(json),
    deps,
  };
}

// Progress for people. Under `--json` it goes to stderr, keeping stdout for
// the JSON.
export function say(ctx: Context, message: string): void {
  if (ctx.json) {
    console.error(message);
  } else {
    console.log(message);
  }
}

export function emit(ctx: Context, value: unknown, print: () => void): void {
  if (ctx.json) {
    cliLog.output(JSON.stringify(value, null, 2));
  } else {
    print();
  }
}

// Opens the secure window's sign-in in the browser and keeps the session it
// hands back on the active profile. The browser must sign in the profile's
// own account.
export async function signInToManageKeys(
  pm: ProfileManager,
  {
    openBrowserFn,
    timeoutMs,
    log = console.log,
  }: {
    openBrowserFn?: (url: string) => Promise<boolean>;
    timeoutMs?: number;
    log?: (message: string) => void;
  } = {},
): Promise<PostedSecureSession> {
  let active = pm.getActiveProfile();
  if (!active) {
    throw new Error(NO_ACTIVE_PROFILE_ERROR);
  }
  let { profile } = active;
  let session = await secureSignIn({
    realmServerUrl: profile.realmServerUrl,
    username: getUsernameFromMatrixId(profile.matrixUserId),
    log,
    ...(openBrowserFn ? { openBrowserFn } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  if (session.userId !== profile.matrixUserId) {
    await secureSignOut(profile.realmServerUrl, session.token).catch(() => {});
    throw new Error(
      `The browser signed in ${session.userId}, but this profile is ` +
        `${profile.matrixUserId}. Run it again and sign in as ${profile.matrixUserId}.`,
    );
  }
  pm.setSecureSession(session);
  return session;
}

// The profile's secure session, checked with the realm server, which ends
// one early on sign-out or a password change. Without a live one, signs in
// through the browser when someone is there to, and refuses otherwise.
export async function secureToken(ctx: Context): Promise<string> {
  let stored = ctx.pm.getSecureSession();
  if (stored) {
    try {
      await realmServerRequest(ctx.realmServerUrl, '_secure-session', {
        token: stored.token,
      });
      return stored.token;
    } catch (e) {
      if (!(e instanceof SecureSessionRequestError && e.status === 401)) {
        throw e;
      }
      ctx.pm.clearSecureSession();
    }
  }
  let interactive =
    ctx.deps.interactive ??
    (ctx.deps.openBrowserFn ? true : Boolean(process.stderr.isTTY));
  if (!interactive) {
    throw new Error(
      'Changing a key needs you to sign in through the browser. Run `boxel keys sign-in` in a terminal first',
    );
  }
  say(ctx, 'Changing a key needs you to sign in to Boxel in the browser.');
  let session = await signInToManageKeys(ctx.pm, {
    openBrowserFn: ctx.deps.openBrowserFn,
    log: (message) => say(ctx, message),
  });
  return session.token;
}

export async function ordinaryToken(ctx: Context): Promise<string> {
  return await ctx.pm.getOrRefreshServerToken();
}

// The masked prompt writes to stderr under `--json`, so its asterisks and the
// characters it reveals never land in the JSON on stdout.
function readValue(ctx: Context, source: KeyValueSource): Promise<string> {
  return readKeyValue(source, {
    input: ctx.deps.input,
    output: ctx.deps.output ?? (ctx.json ? process.stderr : undefined),
    revealLast: REVEAL_LAST,
    revealNoneAtOrBelow: REVEAL_NONE_AT_OR_BELOW,
  });
}

function describeShare(share: KeyShare, keyNames: Map<string, string>): string {
  let state =
    share.state === 'active'
      ? `${FG_GREEN}active${RESET}`
      : `${FG_RED}suspended${RESET} (${share.suspensionReason})`;
  let key =
    share.keyId === undefined
      ? ''
      : share.keyId === null
        ? ', no key'
        : `, key ${keyNames.get(share.keyId) ?? share.keyId}`;
  return `${share.label} in ${share.realm}: ${state}${key}`;
}

function printKey(key: UserKeyMetadata): void {
  console.log(`${key.name}`);
  console.log(`  id: ${key.id}`);
  console.log(`  kind: ${key.kind}`);
  console.log(`  state: ${key.state}`);
  console.log(`  updated: ${key.updatedAt}`);
  let { client, connection } = key.oauth ?? {};
  if (client) {
    console.log(`  client id: ${client.clientId}`);
    console.log(`  grant: ${client.grantType}`);
    if (client.authorizeURL) {
      console.log(`  authorization URL: ${client.authorizeURL}`);
    }
    console.log(`  token URL: ${client.tokenURL}`);
    console.log(`  scopes: ${client.scopes || 'none'}`);
    if (client.apiHosts.length > 0) {
      console.log(`  API hosts: ${client.apiHosts.join(', ')}`);
    }
    console.log(`  client state: ${client.state}`);
  }
  if (connection) {
    console.log(
      `  signs in through: ${connection.client.label ?? 'a client that is gone'} (${connection.client.kind})`,
    );
    console.log(`  scopes: ${connection.scopes || 'none'}`);
    console.log(`  connection: ${connection.status}`);
  }
  if (key.serviceAccount) {
    let { email, subject, scopes } = key.serviceAccount;
    console.log(`  service account: ${email}`);
    console.log(`  acts as: ${subject ?? 'the service account itself'}`);
    console.log(`  scopes: ${scopes.join(' ')}`);
  }
  if (key.grants) {
    if (key.grants.length === 0) {
      console.log('  grants: none');
    } else {
      console.log('  grants:');
      for (let grant of key.grants) {
        console.log(
          `    ${grant.destination}: ${grant.state}, approved ${grant.approvedAt} in the ${grant.approvedVia === 'cli' ? 'CLI' : 'secure window'}`,
        );
      }
    }
  }
}

export async function keysList(
  options: { json?: boolean } & KeysCommandDeps = {},
): Promise<UserKeyMetadata[]> {
  let ctx = context(options.json, options);
  let keys = await listUserKeys(ctx.realmServerUrl, await ordinaryToken(ctx));
  emit(ctx, keys, () => {
    if (keys.length === 0) {
      console.log(
        `You have no keys. ${DIM}Add one with \`boxel keys add <name>\`.${RESET}`,
      );
    }
    for (let key of keys) {
      console.log(
        `${key.name}  ${DIM}${key.state}, updated ${key.updatedAt}${RESET}`,
      );
    }
  });
  return keys;
}

export async function keysShow(
  name: string,
  options: { json?: boolean } & KeysCommandDeps = {},
): Promise<{ key: UserKeyMetadata; shares: KeyShare[] }> {
  let ctx = context(options.json, options);
  let token = await ordinaryToken(ctx);
  let key = await findUserKey(ctx.realmServerUrl, token, name);
  let shares = await listOwnShares(ctx.realmServerUrl, token, {
    keyId: key.id,
  });
  let shown = { key, shares };
  emit(ctx, shown, () => {
    printKey(key);
    if (shares.length === 0) {
      console.log('  shares: none');
    } else {
      console.log('  shares:');
      for (let share of shares) {
        console.log(
          `    ${describeShare(share, new Map([[key.id, key.name]]))}`,
        );
      }
    }
  });
  return shown;
}

// The kinds of key `add` takes. A `google-service-account` key is a Google
// service account's JSON key file, read with --key-file or --stdin, with the
// scopes its tokens ask for (--scope) and optionally the user to act as
// (--subject). An `oauth-client` key is an app registered with a vendor: its
// value is the client secret, entered as any secret, and its settings are
// options (--client-id, --authorize-url, --token-url, --scopes, ...). An
// OAuth connection is never added: `connect` makes one by signing in.
export const KEY_KINDS = [
  'static',
  'google-service-account',
  'oauth-client',
] as const;

export interface ServiceAccountOptions {
  kind?: string;
  // `false` is `replace --no-subject`: act as the service account itself.
  subject?: string | false;
  scope?: string[];
}

export interface OAuthClientOptions {
  clientId?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  grantType?: string;
  tokenAuth?: string;
  apiHost?: string[];
}

const OAUTH_CLIENT_OPTIONS = {
  clientId: '--client-id',
  authorizeUrl: '--authorize-url',
  tokenUrl: '--token-url',
  scopes: '--scopes',
  grantType: '--grant-type',
  tokenAuth: '--token-auth',
  apiHost: '--api-host',
} as const;

// Refuses a `--kind` that `add` doesn't take, before anything that would make
// the person wait.
function checkAddKind(kind: string): void {
  if (!(KEY_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`--kind is one of: ${KEY_KINDS.join(', ')}`);
  }
}

// Refuses options that don't fit the key's kind. A service account's key file
// is JSON, so it is read from a file or stdin, never typed at the masked
// prompt, and it needs scopes: given with --scope, or for a replace, the ones
// the key has. A replace of a key whose details the server doesn't report has
// nothing to keep, so it needs the subject chosen too (--subject or
// --no-subject). Any other kind, an OAuth app's included, takes neither
// --subject nor --scope, and what its replacement may be is the realm
// server's to say.
function checkKindOptions(
  kind: string,
  options: ServiceAccountOptions & KeyValueSource,
  replacing?: { current: ServiceAccountDetails | undefined },
): void {
  let current = replacing?.current;
  if (kind === 'google-service-account') {
    if (!options.keyFile && !options.stdin) {
      throw new Error(
        "A Google service account's JSON key file is read with --key-file or --stdin",
      );
    }
    if (!options.scope?.length && !current?.scopes.length) {
      throw new Error(
        'A Google service account needs at least one --scope, such as https://www.googleapis.com/auth/spreadsheets',
      );
    }
    if (replacing && !current && options.subject === undefined) {
      throw new Error(
        "This key's details aren't known: give --subject <email>, or --no-subject to act as the service account itself",
      );
    }
  } else if (options.subject !== undefined || options.scope !== undefined) {
    throw new Error(
      '--subject and --scope are only for a google-service-account key',
    );
  }
}

// Refuses an OAuth client that lacks what every client needs, before
// anything that would make the person wait, and OAuth options on any other
// kind. The realm server checks the settings themselves.
function checkOAuthClientOptions(
  kind: string,
  options: OAuthClientOptions,
): void {
  let given = (
    Object.keys(OAUTH_CLIENT_OPTIONS) as (keyof OAuthClientOptions)[]
  ).filter((name) => options[name] !== undefined);
  if (kind !== 'oauth-client') {
    if (given.length > 0) {
      throw new Error(
        `${given.map((name) => OAUTH_CLIENT_OPTIONS[name]).join(', ')} ${given.length === 1 ? 'is' : 'are'} only for an oauth-client key`,
      );
    }
    return;
  }
  if (!options.clientId) {
    throw new Error('An OAuth client needs its --client-id');
  }
  if (!options.tokenUrl) {
    throw new Error('An OAuth client needs its --token-url');
  }
  let grantType = options.grantType ?? 'authorization_code';
  if (
    grantType !== 'authorization_code' &&
    grantType !== 'client_credentials'
  ) {
    throw new Error('--grant-type is authorization_code or client_credentials');
  }
  if (grantType === 'authorization_code' && !options.authorizeUrl) {
    throw new Error(
      'An OAuth client people sign in through needs its --authorize-url',
    );
  }
  if (grantType === 'client_credentials' && options.authorizeUrl) {
    throw new Error('A client_credentials client has no --authorize-url');
  }
  if (
    options.tokenAuth !== undefined &&
    options.tokenAuth !== 'client_secret_post' &&
    options.tokenAuth !== 'client_secret_basic'
  ) {
    throw new Error(
      '--token-auth is client_secret_post or client_secret_basic',
    );
  }
}

// An OAuth client's settings as the realm server takes them. Scopes may be
// given as several arguments or as one space-separated one.
function oauthClientSettings(
  kind: string,
  options: OAuthClientOptions,
): { oauth?: OAuthClientSettings } {
  if (kind !== 'oauth-client') {
    return {};
  }
  let scopes = (options.scopes ?? []).join(' ').trim();
  return {
    oauth: {
      clientId: options.clientId!,
      tokenUrl: options.tokenUrl!,
      ...(options.authorizeUrl ? { authorizeUrl: options.authorizeUrl } : {}),
      ...(options.grantType
        ? { grantType: options.grantType as OAuthClientSettings['grantType'] }
        : {}),
      ...(scopes ? { scopes } : {}),
      ...(options.tokenAuth
        ? { tokenAuth: options.tokenAuth as OAuthClientSettings['tokenAuth'] }
        : {}),
      ...(options.apiHost?.length ? { apiHosts: options.apiHost } : {}),
    },
  };
}

// Whether a value is a Google service account's JSON key file, which is only
// ever added as a google-service-account key: sent as it is, it would hand
// the private key to the API.
function isServiceAccountKeyFile(value: string): boolean {
  if (!value.trimStart().startsWith('{')) {
    return false;
  }
  try {
    return JSON.parse(value)?.type === 'service_account';
  } catch {
    return false;
  }
}

function checkNotAKeyFile(kind: string, value: string): void {
  if (kind !== 'google-service-account' && isServiceAccountKeyFile(value)) {
    throw new Error(
      "This is a Google service account's JSON key file. Add it with --kind google-service-account and the --scope its tokens may use",
    );
  }
}

// A service account's subject and scopes as entered. For a replace, `current`
// is what the key has now, and whatever isn't given is kept: its scopes
// without --scope, and the user it acts as without --subject or --no-subject.
function serviceAccountAttributes(
  kind: string,
  options: ServiceAccountOptions,
  current?: ServiceAccountDetails,
): { subject?: string; scopes?: string[] } {
  if (kind !== 'google-service-account') {
    return {};
  }
  let subject =
    options.subject === false
      ? undefined
      : (options.subject ?? current?.subject ?? undefined);
  return {
    ...(subject ? { subject } : {}),
    scopes: options.scope?.length ? options.scope : (current?.scopes ?? []),
  };
}

// The key's current scopes and subject, if a replace with this key file may
// keep them. Domain-wide delegation and the scopes it allows are granted per
// service account, so a key file for another service account keeps neither:
// its replace needs --scope and --subject or --no-subject, like a key whose
// details aren't known. Checked before a ticket is minted.
function keepableDetails(
  keyFile: string,
  options: ServiceAccountOptions,
  current: ServiceAccountDetails | undefined,
): ServiceAccountDetails | undefined {
  if (!current) {
    return undefined;
  }
  let email = keyFileEmail(keyFile);
  if (email === current.email) {
    return current;
  }
  if (!options.scope?.length || options.subject === undefined) {
    throw new Error(
      `This key file is for ${email ?? 'another service account'}, not ${current.email}. ` +
        'Delegation and scopes are granted per service account, so give --scope, and --subject <email> or --no-subject',
    );
  }
  return undefined;
}

function keyFileEmail(keyFile: string): string | undefined {
  try {
    let email = JSON.parse(keyFile)?.client_email;
    return typeof email === 'string' ? email : undefined;
  } catch {
    return undefined;
  }
}

// What a service account's replace kept of the key as it was, to say so.
function keptByReplace(
  options: ServiceAccountOptions,
  current: ServiceAccountDetails | undefined,
): string[] {
  if (!current) {
    return [];
  }
  let kept: string[] = [];
  if (!options.scope?.length) {
    kept.push(`Kept its scopes: ${current.scopes.join(' ')}`);
  }
  if (options.subject === undefined) {
    kept.push(
      current.subject
        ? `Kept acting as ${current.subject} (--no-subject acts as the service account itself)`
        : 'Kept acting as the service account itself (--subject acts as a user)',
    );
  }
  return kept;
}

export async function keysAdd(
  name: string,
  options: { json?: boolean } & KeyValueSource &
    ServiceAccountOptions &
    OAuthClientOptions &
    KeysCommandDeps = {},
): Promise<UserKeyMetadata> {
  let ctx = context(options.json, options);
  let kind = options.kind ?? 'static';
  checkAddKind(kind);
  checkKindOptions(kind, options);
  checkOAuthClientOptions(kind, options);
  checkKeyValueSource(options, ctx.deps.input ?? process.stdin);
  let token = await secureToken(ctx);
  let value = await readValue(ctx, options);
  checkNotAKeyFile(kind, value);
  let key = await addUserKey(ctx.realmServerUrl, token, {
    name,
    ...(options.kind ? { kind } : {}),
    value,
    ...serviceAccountAttributes(kind, options),
    ...oauthClientSettings(kind, options),
  });
  emit(ctx, key, () => {
    if (kind === 'oauth-client' && options.grantType !== 'client_credentials') {
      console.log(`${FG_GREEN}Added the OAuth client ${key.name}.${RESET}`);
      console.log(
        `${DIM}Connect your account through it with \`boxel keys connect <name> --client ${key.name}\`, or share it into a realm for the people there to connect through.${RESET}`,
      );
      return;
    }
    console.log(`${FG_GREEN}Added the key ${key.name}.${RESET}`);
    console.log(
      `${DIM}It can't be sent anywhere until you approve an operation that uses it.${RESET}`,
    );
  });
  return key;
}

// A key is replaced with a value of its own kind: a service account with a
// new key file, keeping its scopes and the user it acts as unless new ones
// are given.
export async function keysReplace(
  name: string,
  options: { json?: boolean } & KeyValueSource &
    Omit<ServiceAccountOptions, 'kind'> &
    KeysCommandDeps = {},
): Promise<UserKeyMetadata> {
  let ctx = context(options.json, options);
  checkKeyValueSource(options, ctx.deps.input ?? process.stdin);
  let token = await secureToken(ctx);
  let {
    id,
    kind,
    serviceAccount: current,
  } = await findUserKey(ctx.realmServerUrl, token, name);
  checkKindOptions(kind, options, { current });
  let value = await readValue(ctx, options);
  checkNotAKeyFile(kind, value);
  let keep =
    kind === 'google-service-account'
      ? keepableDetails(value, options, current)
      : undefined;
  let key = await replaceUserKey(ctx.realmServerUrl, token, {
    keyId: id,
    value,
    ...serviceAccountAttributes(kind, options, keep),
  });
  emit(ctx, key, () => {
    console.log(`${FG_GREEN}Replaced the value of ${key.name}.${RESET}`);
  });
  if (kind === 'google-service-account') {
    for (let line of keptByReplace(options, keep)) {
      say(ctx, line);
    }
  }
  return key;
}

export async function confirm(
  ctx: Context,
  question: string,
): Promise<boolean> {
  if (ctx.deps.confirmFn) {
    return await ctx.deps.confirmFn(question);
  }
  let answer = await prompt(question);
  return /^y(es)?$/i.test(answer);
}

export async function keysDelete(
  name: string,
  options: { json?: boolean; yes?: boolean } & KeysCommandDeps = {},
): Promise<{ deleted: UserKeyMetadata; suspended: KeyShare[] }> {
  let ctx = context(options.json, options);
  // Checked before signing in, so a missing --yes never costs a browser trip.
  if (
    !options.yes &&
    (ctx.json || !(ctx.deps.confirmFn || process.stdin.isTTY))
  ) {
    throw new Error(
      'Pass --yes to delete a key without a terminal to confirm in',
    );
  }
  let token = await secureToken(ctx);
  let key = await findUserKey(ctx.realmServerUrl, token, name);
  let shares = (
    await listOwnShares(ctx.realmServerUrl, token, { keyId: key.id })
  ).filter((share) => share.state === 'active');
  if (!options.yes) {
    if (shares.length > 0) {
      console.log(`Deleting ${name} suspends these shares:`);
      for (let share of shares) {
        console.log(`  ${share.label} in ${share.realm}`);
      }
    } else {
      console.log(`${name} is in no share.`);
    }
    if (!(await confirm(ctx, `Delete ${name}? [y/N] `))) {
      throw new Error('Not deleted');
    }
  }
  await deleteUserKey(ctx.realmServerUrl, token, { keyId: key.id });
  let result = { deleted: key, suspended: shares };
  emit(ctx, result, () => {
    console.log(
      `${FG_GREEN}Deleted the key ${name}.${RESET}` +
        (shares.length > 0
          ? ` ${shares.length} share${shares.length === 1 ? '' : 's'} suspended.`
          : ''),
    );
  });
  return result;
}

export async function keysShare(
  name: string,
  options: { realm: string; as?: string; json?: boolean } & KeysCommandDeps,
): Promise<KeyShare> {
  let ctx = context(options.json, options);
  let token = await secureToken(ctx);
  let key = await findUserKey(ctx.realmServerUrl, token, name);
  let share = await shareUserKey(ctx.realmServerUrl, token, {
    keyId: key.id,
    realm: options.realm,
    label: options.as ?? name,
  });
  emit(ctx, share, () => {
    console.log(
      `${FG_GREEN}Shared ${name} into ${share.realm} as ${share.label}.${RESET}`,
    );
  });
  return share;
}

export async function keysUnshare(
  label: string,
  options: { realm: string; json?: boolean } & KeysCommandDeps,
): Promise<KeyShare> {
  let ctx = context(options.json, options);
  let share = await unshareUserKey(
    ctx.realmServerUrl,
    await ordinaryToken(ctx),
    {
      realm: options.realm,
      label,
    },
  );
  emit(ctx, share, () => {
    console.log(
      `${FG_GREEN}Took ${share.label} out of ${share.realm}.${RESET}`,
    );
  });
  return share;
}

// A swap moves every operation approved for the share to the new key, which
// grants the key each destination they send to. A swap whose key already has
// a grant covering each of them is made here; one that grants it a new
// destination is confirmed in the secure window's swap page, as an approval
// that does is (see `approve.ts`).
export async function keysSwap(
  label: string,
  options: {
    realm: string;
    key: string;
    timeout?: string;
    json?: boolean;
  } & KeysCommandDeps,
): Promise<KeyShare> {
  let ctx = context(options.json, options);
  let token = await secureToken(ctx);
  let key = await findUserKey(ctx.realmServerUrl, token, options.key);
  let listed = (
    await listRealmShares(ctx.realmServerUrl, token, options.realm)
  ).find((s) => s.label === label);
  // Every grant counts, a rejected one too: the realm server reuses a grant
  // that covers the destination whatever its state, as an approval does.
  let grants = key.grants ?? [];
  let uncovered = [
    ...new Set(
      (listed?.operations ?? [])
        .map((o) => o.destination)
        .filter(
          (d): d is string =>
            d !== undefined &&
            !grants.some((g) => destinationCovers(g.destination, d)),
        ),
    ),
  ];
  let share: KeyShare;
  if (listed && listed.state === 'suspended' && uncovered.length > 0) {
    let hosts = uncovered.map((d) => new URL(d).host).join(', ');
    say(
      ctx,
      `${label} is approved for requests to ${hosts}, which ${key.name} has no grant for.`,
    );
    await finishInSecureWindow(ctx, {
      page: 'swap-key',
      fragment: { realm: listed.realm, share: listed.id, key: key.id },
      what: `sending ${key.name} to ${hosts}`,
      timeoutMs: windowTimeout(options.timeout),
    });
    let after = (
      await listRealmShares(ctx.realmServerUrl, token, options.realm)
    ).find((s) => s.id === listed.id);
    if (!after || after.state !== 'active' || after.keyId !== key.id) {
      throw new Error(
        `The secure window closed without putting ${key.name} into ${label}`,
      );
    }
    share = after;
  } else {
    share = await swapKeyIntoShare(ctx.realmServerUrl, token, {
      realm: options.realm,
      label,
      keyId: key.id,
    });
  }
  emit(ctx, share, () => {
    console.log(
      `${FG_GREEN}${share.label} in ${share.realm} now holds ${key.name}.${RESET}`,
    );
  });
  return share;
}

export async function keysShares(
  options: { realm: string; json?: boolean } & KeysCommandDeps,
): Promise<KeyShare[]> {
  let ctx = context(options.json, options);
  let token = await ordinaryToken(ctx);
  let shares = await listRealmShares(ctx.realmServerUrl, token, options.realm);
  // The server names the key only in the user's own shares, by id.
  let keyNames = new Map<string, string>();
  if (!ctx.json && shares.some((share) => share.keyId)) {
    for (let key of await listUserKeys(ctx.realmServerUrl, token)) {
      keyNames.set(key.id, key.name);
    }
  }
  emit(ctx, shares, () => {
    if (shares.length === 0) {
      console.log(`${canonicalRealmUrl(options.realm)} has no shares.`);
    }
    for (let share of shares) {
      let owner =
        share.owner === null
          ? 'a former member of the realm'
          : share.owner === ctx.matrixUserId
            ? 'you'
            : share.owner;
      console.log(`${describeShare(share, keyNames)}, owner ${owner}`);
    }
  });
  return shares;
}

// How `connect --client` names a client: `platform:<name>` for one of
// Boxel's own, a share's label for one shared into the realm given with
// `--realm`, and otherwise the name of one of the user's own client keys.
function clientArgument(client: ConnectableClient): string {
  return client.kind === 'platform' ? `platform:${client.name}` : client.label;
}

export async function keysClients(
  options: { realm?: string; json?: boolean } & KeysCommandDeps = {},
): Promise<ConnectableClient[]> {
  let ctx = context(options.json, options);
  let clients = await listConnectableClients(
    ctx.realmServerUrl,
    await ordinaryToken(ctx),
    { realm: options.realm },
  );
  emit(ctx, clients, () => {
    if (clients.length === 0) {
      console.log(
        options.realm
          ? `There are no clients to connect through in ${canonicalRealmUrl(options.realm)}.`
          : 'There are no clients to connect through.',
      );
    }
    for (let client of clients) {
      let whose =
        client.kind === 'platform'
          ? `${client.label}, Boxel's own`
          : client.kind === 'share'
            ? `shared into ${canonicalRealmUrl(options.realm!)}`
            : 'yours';
      let scopes = client.scopes ? `, scopes ${client.scopes}` : '';
      console.log(
        `${clientArgument(client)}  ${DIM}${whose}, signs in at ${client.authorizeHost}${scopes}${RESET}`,
      );
    }
  });
  return clients;
}

// The client `--client` names, among those the user may connect through:
// `platform:<name>` for one of Boxel's own; otherwise a client shared into
// the `--realm` under that label, or, failing that, one of the user's own
// client keys of that name, which `clients --realm` lists too.
function findClient(
  clients: ConnectableClient[],
  argument: string,
  realm: string | undefined,
): ConnectableClient {
  let found: ConnectableClient | undefined;
  if (argument.startsWith('platform:')) {
    let name = argument.slice('platform:'.length);
    found = clients.find((c) => c.kind === 'platform' && c.name === name);
  } else {
    found =
      (realm
        ? clients.find((c) => c.kind === 'share' && c.label === argument)
        : undefined) ??
      clients.find((c) => c.kind === 'own' && c.label === argument);
  }
  if (!found) {
    throw new Error(
      realm
        ? `${canonicalRealmUrl(realm)} has no client shared as ${argument}, and you have no client of that name, to connect through. \`boxel keys clients --realm ${realm}\` lists them`
        : `You have no client named ${argument} to connect through. A client shared into a realm takes --realm; \`boxel keys clients\` lists them`,
    );
  }
  return found;
}

// How long a sign-in at a service lasts on the realm server.
const CONNECT_WINDOW_MS = 10 * 60 * 1000;

// Why a sign-in ended without a connection, as the realm server or the
// service names it, in the words `connect` says it.
const CONNECT_FAILURES: Record<string, string> = {
  expired:
    'The sign-in took too long, or was already used, so nothing was connected. Run it again to start a new one',
  denied:
    "The service didn't give Boxel access: the sign-in was cancelled there, or the service refused it. Nothing was connected",
  failed:
    "The service didn't complete the sign-in, so nothing was connected. Try again; if it keeps happening, the client's settings may need checking",
  'name-taken':
    'A key of that name was added while you were signing in, so nothing was connected. Connect again under another name',
};

// Signs in to a service through a client, in the browser, and keeps what the
// sign-in yields as the user's connection `name`. The CLI waits on a
// loopback port it names when it starts the sign-in. The service sends the
// browser back through the realm server's callback to the secure window's
// `connected` page, which hands the service's one-use code to that port once
// the user confirms; the CLI then finishes the sign-in with its own secure
// session, so the browser needs no Boxel session of its own. The code is
// useless without the PKCE verifier and client secret, which only the realm
// server holds, and no token the service issues reaches the CLI.
export async function keysConnect(
  name: string,
  options: {
    client: string;
    realm?: string;
    timeout?: string;
    json?: boolean;
  } & KeysCommandDeps,
): Promise<UserKeyMetadata> {
  let ctx = context(options.json, options);
  let timeoutSeconds =
    options.timeout === undefined ? undefined : Number(options.timeout);
  if (
    timeoutSeconds !== undefined &&
    !(Number.isFinite(timeoutSeconds) && timeoutSeconds >= 0)
  ) {
    throw new Error('--timeout is a number of seconds');
  }
  // Found with the ordinary session, so a client that isn't there never costs
  // a sign-in in the browser.
  let client = findClient(
    await listConnectableClients(ctx.realmServerUrl, await ordinaryToken(ctx), {
      realm: options.realm,
    }),
    options.client,
    options.realm,
  );
  let token = await secureToken(ctx);
  let listener = await startLoopbackCallback({
    timeoutMs: Math.min(
      CONNECT_WINDOW_MS,
      timeoutSeconds === undefined ? Infinity : timeoutSeconds * 1000,
    ),
  });
  let outcome: OAuthConnectOutcome;
  try {
    let started = await startOAuthConnect(ctx.realmServerUrl, token, {
      name,
      client: client.ref,
      cli: { port: listener.port, state: listener.state },
    });
    let open = ctx.deps.openBrowserFn ?? openBrowser;
    if (await open(started.authorizeUrl)) {
      say(ctx, `Opening your browser to sign in at ${client.authorizeHost}...`);
      say(ctx, `If it didn't open, visit:\n  ${started.authorizeUrl}`);
    } else {
      say(
        ctx,
        `Open this URL in your browser to sign in at ${client.authorizeHost}:\n  ${started.authorizeUrl}`,
      );
    }
    say(
      ctx,
      'Waiting for you to sign in, then to continue in the Boxel page the browser comes back to...',
    );
    let result;
    try {
      result = await listener.waitForResult();
    } catch (e) {
      if (e instanceof SsoTimeoutError) {
        throw new Error(
          "The sign-in wasn't finished in the browser in time, so nothing was connected. Run it again to start a new one",
        );
      }
      throw e;
    }
    if (result.kind !== 'oauth') {
      throw new Error('The browser returned a different kind of sign-in.');
    }
    outcome =
      'error' in result.outcome
        ? { error: result.outcome.error }
        : await completeOAuthConnect(ctx.realmServerUrl, token, result.outcome);
  } finally {
    listener.close();
  }
  if ('error' in outcome) {
    throw new Error(
      CONNECT_FAILURES[outcome.error] ?? CONNECT_FAILURES.failed!,
    );
  }
  let connectedId = outcome.connected;
  let key = (await listUserKeys(ctx.realmServerUrl, token)).find(
    (candidate) => candidate.id === connectedId,
  );
  if (!key) {
    throw new Error(
      `The connection was made, but ${name} isn't among your keys; \`boxel keys list\` shows what you have`,
    );
  }
  emit(ctx, key, () => {
    console.log(
      `${FG_GREEN}Connected ${key.name} through ${client.kind === 'platform' ? client.label : clientArgument(client)}.${RESET}`,
    );
    console.log(
      `${DIM}Nothing can use it until an operation is approved for it.${RESET}`,
    );
  });
  return key;
}

// Runs a command, printing a refusal with the server's status and reason.
// Under `--json` a refusal prints as `{ error: { status, reason, errors } }`
// on stdout, `errors` being the server's own, unchanged.
export async function runKeysCommand(
  json: boolean | undefined,
  fn: () => Promise<unknown> | unknown,
): Promise<void> {
  try {
    await fn();
  } catch (e: any) {
    process.exitCode = 1;
    if (json) {
      let error =
        e instanceof SecureSessionRequestError
          ? { status: e.status, reason: e.reason, errors: e.errors }
          : { reason: e?.message ?? String(e) };
      cliLog.output(JSON.stringify({ error }, null, 2));
      return;
    }
    let message =
      e instanceof SecureSessionRequestError
        ? `Refused (HTTP ${e.status}): ${e.reason || e.message}`
        : (e?.message ?? String(e));
    console.error(`${FG_RED}Error:${RESET} ${message}`);
  }
}
