import type Koa from 'koa';
import { fetchRealmPermissions, rri } from '@cardstack/runtime-common';
import RealmPermissionChecker from '@cardstack/runtime-common/realm-permission-checker';
import type { ResolvedCodeRef } from '@cardstack/runtime-common/code-ref';
import type { CreateRoutesArgs } from '../routes.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import { normalizeRealmURL } from '../utils/realm-url.ts';
import { secretsKeyring } from '../lib/secrets-at-rest/index.ts';
import {
  secureSessionClient,
  type SecureSessionClient,
} from '../lib/secure-session.ts';
import {
  createOrReuseGrantForOperation,
  removeGrant,
  type UserKeyGrant,
} from '../lib/user-key-grants.ts';
import { UserKeyError } from '../lib/user-keys.ts';
import {
  keysHandler,
  mayMintKeyWriteTicket,
  ownerOf,
  readJSON,
  sendJSON,
} from './handle-user-keys.ts';

// The grants API: approving one of the signed-in user's keys for the
// destination an operation sends to, and removing such an approval. Who may
// do what, and how a grant's copy of the key is sealed, is set out in
// `lib/user-key-grants.ts`. As for the keys API, the request log keeps only
// the method and path of these routes.

type Handler = (ctxt: Koa.Context, next: Koa.Next) => Promise<void>;

const CREATE_ATTRIBUTES = new Set([
  'keyId',
  'realm',
  'codeRef',
  'operation',
  'expectedDestination',
]);

function serializeGrant(grant: UserKeyGrant) {
  let { id, ...attributes } = grant;
  return { type: 'user-key-grant', id, attributes };
}

// The client of the secure-origin session this request carries. Creating or
// removing a grant takes such a session, from a request the same rule as
// minting a key write ticket admits: the secure origin's `Origin`, or none, as
// the CLI sends. The app's session never carries the claim, from any origin.
async function secureClientOf(
  ctxt: Koa.Context,
  { dbAdapter, secureOriginURL }: CreateRoutesArgs,
): Promise<SecureSessionClient> {
  if (!mayMintKeyWriteTicket(ctxt, secureOriginURL)) {
    throw new UserKeyError(
      403,
      'grants are changed only from the secure window and the CLI',
    );
  }
  let client = await secureSessionClient(
    dbAdapter,
    ctxt.state.token as RealmServerTokenClaim | undefined,
  );
  if (!client) {
    throw new UserKeyError(
      403,
      'grants are changed only by a session signed in on the secure origin',
    );
  }
  return client;
}

function codeRefOf(value: unknown): ResolvedCodeRef {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof (value as Record<string, unknown>).module !== 'string' ||
    typeof (value as Record<string, unknown>).name !== 'string'
  ) {
    throw new UserKeyError(
      400,
      'a grant names the operation’s type as codeRef: {module, name}',
    );
  }
  let { module, name } = value as { module: string; name: string };
  return { module: rri(module), name };
}

// Approves the key for the destination the operation sends to, reusing a
// grant of the key that already covers it. Answers 201 with a new grant, 200
// with the one reused. The operation is read from the realm's definition
// cache, so the caller must be able to read the realm; a realm they can't is
// answered as one that doesn't exist. `expectedDestination` is the destination
// the user was shown. It is checked against the operation's and never stored
// in its place: 409 when they differ.
export function handleCreateUserKeyGrant(args: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    let via = await secureClientOf(ctxt, args);
    let body = await readJSON(ctxt);
    let data = body.data as
      | { type?: unknown; attributes?: Record<string, unknown> }
      | undefined;
    if (!data || typeof data !== 'object' || data.type !== 'user-key-grant') {
      throw new UserKeyError(400, `the resource type is 'user-key-grant'`);
    }
    let attributes = data.attributes ?? {};
    if (typeof attributes !== 'object' || Array.isArray(attributes)) {
      throw new UserKeyError(400, 'attributes must be an object');
    }
    for (let name of Object.keys(attributes)) {
      if (!CREATE_ATTRIBUTES.has(name)) {
        throw new UserKeyError(400, `'${name}' can't be set here`);
      }
    }
    let { keyId, realm, codeRef, operation, expectedDestination } = attributes;
    if (typeof keyId !== 'string') {
      throw new UserKeyError(400, 'a grant names the key');
    }
    if (typeof operation !== 'string' || operation.length === 0) {
      throw new UserKeyError(400, 'a grant names the operation');
    }
    if (typeof expectedDestination !== 'string') {
      throw new UserKeyError(
        400,
        'a grant names the destination its user was shown, as expectedDestination',
      );
    }
    let ref = codeRefOf(codeRef);
    let realmURL = typeof realm === 'string' ? normalizeRealmURL(realm) : null;
    if (!realmURL) {
      throw new UserKeyError(400, 'a grant names the realm');
    }
    let target = args.realms.find((r) => r.url === realmURL.href);
    if (
      !target ||
      !(await new RealmPermissionChecker(
        await fetchRealmPermissions(args.dbAdapter, realmURL),
        args.matrixClient,
      ).can(owner, 'read'))
    ) {
      throw new UserKeyError(404, 'no such realm');
    }
    let { grant, created } = await createOrReuseGrantForOperation(
      args.dbAdapter,
      secretsKeyring(),
      {
        core: target.operationCore,
        realmURL,
        codeRef: ref,
        operationName: operation,
        owner,
        keyId,
        expectedDestination,
        via,
      },
    );
    await sendJSON(ctxt, created ? 201 : 200, {
      data: serializeGrant(grant),
      meta: { created },
    });
  });
}

// Removes one of the user's grants, answering with the bindings it revoked.
export function handleRemoveUserKeyGrant(args: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    await secureClientOf(ctxt, args);
    let { revokedBindings } = await removeGrant(args.dbAdapter, {
      owner,
      grantId: ctxt.params.grantId,
    });
    await sendJSON(ctxt, 200, { meta: { revokedBindings } });
  });
}
