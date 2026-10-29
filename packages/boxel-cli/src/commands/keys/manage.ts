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
import { prompt } from '../../lib/prompt.ts';
import {
  realmServerRequest,
  secureSignIn,
  secureSignOut,
  SecureSessionRequestError,
} from '../../lib/secure-session.ts';
import type { PostedSecureSession } from '../../lib/sso-login.ts';
import {
  addUserKey,
  canonicalRealmUrl,
  deleteUserKey,
  findUserKey,
  listOwnShares,
  listRealmShares,
  listUserKeys,
  replaceUserKey,
  shareUserKey,
  swapKeyIntoShare,
  unshareUserKey,
  type KeyShare,
  type ServiceAccountDetails,
  type UserKeyMetadata,
} from '../../lib/user-keys.ts';

// The commands that manage the signed-in user's own keys and the shares that
// put them into realms. Keys belong to the user, so only the share commands
// name a realm.
//
// Reading (`list`, `show`, `shares`) and unsharing use the profile's ordinary
// realm-server session. A change that stores or hands out a key (`add`,
// `replace`, `delete`, `share`, `swap`) takes a key write ticket for that
// change, which only a session signed in on the secure origin can mint, so
// those commands first make sure the profile holds one, opening the secure
// window's sign-in in the browser when it doesn't.
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

interface Context {
  pm: ProfileManager;
  realmServerUrl: string;
  matrixUserId: string;
  json: boolean;
  deps: KeysCommandDeps;
}

function context(json: boolean | undefined, deps: KeysCommandDeps): Context {
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
function say(ctx: Context, message: string): void {
  if (ctx.json) {
    console.error(message);
  } else {
    console.log(message);
  }
}

function emit(ctx: Context, value: unknown, print: () => void): void {
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
async function secureToken(ctx: Context): Promise<string> {
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

async function ordinaryToken(ctx: Context): Promise<string> {
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
// (--subject).
export const KEY_KINDS = ['static', 'google-service-account'] as const;

export interface ServiceAccountOptions {
  kind?: string;
  // `false` is `replace --no-subject`: act as the service account itself.
  subject?: string | false;
  scope?: string[];
}

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
    KeysCommandDeps = {},
): Promise<UserKeyMetadata> {
  let ctx = context(options.json, options);
  let kind = options.kind ?? 'static';
  checkAddKind(kind);
  checkKindOptions(kind, options);
  checkKeyValueSource(options, ctx.deps.input ?? process.stdin);
  let token = await secureToken(ctx);
  let value = await readValue(ctx, options);
  checkNotAKeyFile(kind, value);
  let key = await addUserKey(ctx.realmServerUrl, token, {
    name,
    ...(options.kind ? { kind } : {}),
    value,
    ...serviceAccountAttributes(kind, options),
  });
  emit(ctx, key, () => {
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

async function confirm(ctx: Context, question: string): Promise<boolean> {
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

export async function keysSwap(
  label: string,
  options: { realm: string; key: string; json?: boolean } & KeysCommandDeps,
): Promise<KeyShare> {
  let ctx = context(options.json, options);
  let token = await secureToken(ctx);
  let key = await findUserKey(ctx.realmServerUrl, token, options.key);
  let share = await swapKeyIntoShare(ctx.realmServerUrl, token, {
    realm: options.realm,
    label,
    keyId: key.id,
  });
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
