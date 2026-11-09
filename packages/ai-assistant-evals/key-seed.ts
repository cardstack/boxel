// Seeds an evaluation's pipeline approvals into a fresh test workspace before
// the first prompt: a key, a share when the approval is for one, and an
// approval of the card type's operation for scheduled pipelines only.
//
// Keys are changed only through a session signed in on the secure origin, and
// signing in there takes a person at the secure window. The runner drives the
// local stack only, so it writes that session's `secure_sessions` row into the
// local database and signs the session's token with the local realm secret
// seed, as the realm server's own tests do; everything after that goes
// through the realm server's key API exactly as the CLI's calls do.
//
// Env: EVAL_PG_CONTAINER (default `boxel-pg`), EVAL_PG_DATABASE (default
// PGDATABASE, then `boxel`), EVAL_REALM_SECRET_SEED (default the local stack's seed),
// EVAL_SHARE_OWNER (default `ai-assistant-eval-key-sharer`).

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import jsonwebtoken from 'jsonwebtoken';

import type { RealmResourceIdentifier } from '@cardstack/runtime-common/realm-identifiers';

import { REALM_SERVER_URL } from './eval-config.ts';
import { loginWithPassword } from './matrix-api.ts';
import { MIME, RealmClient } from './realm-api.ts';

import type { KeyFrom } from './eval-card.ts';

const run = promisify(execFile);

const PG_CONTAINER = process.env.EVAL_PG_CONTAINER ?? 'boxel-pg';
// A stack in env mode keeps its database under its own name, which `mise
// exec` puts in PGDATABASE.
const PG_DATABASE =
  process.env.EVAL_PG_DATABASE ?? process.env.PGDATABASE ?? 'boxel';
const REALM_SECRET_SEED =
  process.env.EVAL_REALM_SECRET_SEED ?? "shhh! it's a secret";

// The user whose share fills a `share` approval. Someone other than the eval
// user, so the eval user has nothing of their own to approve.
export const SHARE_OWNER =
  process.env.EVAL_SHARE_OWNER ?? 'ai-assistant-eval-key-sharer';

// What the seeded key holds. The approval is for pipelines only, so an
// invocation from the assistant is refused before any key is read: this value
// is never sent anywhere.
const KEY_VALUE = 'eval-placeholder-not-a-real-credential';

const SESSION_SECONDS = 60 * 60;

export interface PipelineApprovalTarget {
  realm: string;
  module: RealmResourceIdentifier;
  name: string;
  operation: string;
  // The copied card, which an operation approved per instance names.
  instance: RealmResourceIdentifier;
  keyFrom: KeyFrom;
}

// A token for a session signed in on the secure origin, as `user` (a full
// Matrix id). The row is what the realm server checks the token's
// `secureSession` claim against.
async function secureSessionToken(user: string): Promise<string> {
  let id = randomUUID();
  let sql =
    `INSERT INTO secure_sessions (id, user_id, client, sign_in_proof, expires_at) ` +
    `VALUES ('${id}', '${user.replace(/'/g, "''")}', 'cli', 'ai-assistant-eval:${id}', ` +
    `NOW() + interval '${SESSION_SECONDS} seconds')`;
  await run('docker', [
    'exec',
    PG_CONTAINER,
    'psql',
    '-U',
    'postgres',
    '-d',
    PG_DATABASE,
    '-v',
    'ON_ERROR_STOP=1',
    '-qc',
    sql,
  ]);
  return `Bearer ${jsonwebtoken.sign(
    { user, sessionRoom: 'ai-assistant-eval', secureSession: id },
    REALM_SECRET_SEED,
    { expiresIn: SESSION_SECONDS },
  )}`;
}

async function keyRequest(
  token: string,
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<any> {
  let response = await fetch(`${REALM_SERVER_URL.replace(/\/$/, '')}/${path}`, {
    method,
    headers: {
      accept: MIME.jsonApi,
      authorization: token,
      ...(body ? { 'content-type': MIME.jsonApi } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} /${path} answered ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : undefined;
}

async function ticket(
  token: string,
  attributes: { action: 'add' | 'share'; keyId?: string; realm?: string },
): Promise<string> {
  let json = await keyRequest(token, '_key-write-tickets', 'POST', {
    data: { type: 'key-write-ticket', attributes },
  });
  return json.data.attributes.ticket;
}

async function addKey(token: string, name: string): Promise<string> {
  let json = await keyRequest(token, '_user-keys', 'POST', {
    data: {
      type: 'user-key',
      attributes: { name, value: KEY_VALUE },
    },
    meta: { ticket: await ticket(token, { action: 'add' }) },
  });
  return json.data.id;
}

async function shareKey(
  token: string,
  keyId: string,
  realm: string,
  label: string,
): Promise<string> {
  let json = await keyRequest(token, '_key-shares', 'POST', {
    data: {
      type: 'key-share',
      attributes: { realm, keyId, label },
    },
    meta: { ticket: await ticket(token, { action: 'share', keyId, realm }) },
  });
  return json.data.id;
}

// Approves one operation for pipelines only, every slot filled with `fill`,
// against what the approval window would show: the preview's destination and
// each slot's fingerprint.
async function approveForPipelines(
  token: string,
  target: PipelineApprovalTarget,
  fill: { keyId: string } | { shareId: string },
) {
  let query = new URLSearchParams({
    realm: target.realm,
    module: target.module,
    name: target.name,
    operation: target.operation,
  });
  let preview = (
    await keyRequest(token, `_key-bindings/preview?${query}`, 'GET')
  ).data.attributes as {
    destination: string;
    perInstance: boolean;
    slots: { slot: string; fingerprint: string }[];
  };
  await keyRequest(token, '_key-bindings', 'POST', {
    data: {
      type: 'key-binding-approval',
      attributes: {
        realm: target.realm,
        operations: [
          {
            codeRef: { module: target.module, name: target.name },
            operation: target.operation,
            ...(preview.perInstance ? { instance: target.instance } : {}),
            expectedDestination: preview.destination,
            slots: Object.fromEntries(
              preview.slots.map((s) => [
                s.slot,
                { ...fill, expectedFingerprint: s.fingerprint },
              ]),
            ),
          },
        ],
      },
    },
  });
}

// Makes `user` a direct writer of the workspace, which a key is shared only
// into. `owner` is the workspace's owner, who may change its permissions.
async function addWriter(owner: RealmClient, realm: string, user: string) {
  let response = await fetch(`${realm}_permissions`, {
    method: 'PATCH',
    headers: {
      accept: MIME.jsonApi,
      'content-type': MIME.jsonApi,
      authorization: await owner.session(realm),
    },
    body: JSON.stringify({
      data: {
        id: realm,
        type: 'permissions',
        attributes: { permissions: { [user]: ['read', 'write'] } },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `could not make ${user} a writer of ${realm}: ${response.status} ${await response.text()}`,
    );
  }
}

// Seeds every approval into the test workspace. `user` is the eval user the
// run signs in as (a full Matrix id) and `owner` their realm client; a
// `share` approval is made by SHARE_OWNER, signed in with `password`.
export async function seedPipelineApprovals(
  targets: PipelineApprovalTarget[],
  {
    user,
    owner,
    password,
    log = () => {},
  }: {
    user: string;
    owner: RealmClient;
    password: string;
    log?: (line: string) => void;
  },
): Promise<void> {
  if (targets.length === 0) {
    return;
  }
  let userToken: string | undefined;
  let sharer:
    | { id: string; token: string; shares: Map<string, string> }
    | undefined;
  for (let [index, target] of targets.entries()) {
    // A user's key names are unique across their keys, and an eval user runs
    // many evaluations, so the name carries the test workspace's endpoint.
    let workspace = new URL(target.realm).pathname
      .split('/')
      .filter(Boolean)
      .pop();
    let keyName = `eval-${workspace}-${target.name}-${target.operation}-${index}`;
    if (target.keyFrom === 'own-key') {
      userToken ??= await secureSessionToken(user);
      let keyId = await addKey(userToken, keyName);
      await approveForPipelines(userToken, target, { keyId });
      log(
        `approved ${target.name}.${target.operation} for pipelines only, with ${user}'s own key`,
      );
      continue;
    }
    if (!sharer) {
      let credentials = await loginWithPassword(SHARE_OWNER, password);
      // A realm-server session first, so the realm server knows the user
      // before it is given permissions and a key.
      await new RealmClient(
        credentials.accessToken,
        credentials.userId,
      ).serverSession(REALM_SERVER_URL);
      sharer = {
        id: credentials.userId,
        token: await secureSessionToken(credentials.userId),
        shares: new Map(),
      };
    }
    let shareId = sharer.shares.get(target.realm);
    if (!shareId) {
      await addWriter(owner, target.realm, sharer.id);
      let keyId = await addKey(sharer.token, keyName);
      shareId = await shareKey(sharer.token, keyId, target.realm, 'Team key');
      sharer.shares.set(target.realm, shareId);
    }
    await approveForPipelines(sharer.token, target, { shareId });
    log(
      `approved ${target.name}.${target.operation} for pipelines only, with ${sharer.id}'s share`,
    );
  }
}
