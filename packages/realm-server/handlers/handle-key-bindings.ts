import type Koa from 'koa';
import { fetchRealmPermissions } from '@cardstack/runtime-common';
import RealmPermissionChecker from '@cardstack/runtime-common/realm-permission-checker';
import { setContextResponse } from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { normalizeRealmURL } from '../utils/realm-url.ts';
import { secretsKeyring } from '../lib/secrets-at-rest/index.ts';
import {
  approveBindings,
  listOwnBindings,
  revokeBinding,
  type ApprovedBinding,
  type KeyBinding,
  type OperationApproval,
} from '../lib/key-bindings.ts';
import { UserKeyError } from '../lib/user-keys.ts';
import {
  keysHandler,
  ownerOf,
  readJSON,
  sendJSON,
} from './handle-user-keys.ts';
import { codeRefOf, secureClientOf } from './handle-user-key-grants.ts';

// The bindings API: approving operations in a realm with the signed-in user's
// keys and shares, revoking those approvals, and listing them. What a binding
// is and how a call uses one is set out in `lib/key-bindings.ts`. Approving
// and revoking take a session signed in on the secure origin, as creating a
// grant does. As for the keys API, the request log keeps only the method and
// path of these routes.

type Handler = (ctxt: Koa.Context, next: Koa.Next) => Promise<void>;

const APPROVE_ATTRIBUTES = new Set([
  'realm',
  'operations',
  'interactive',
  'anonymous',
]);
const OPERATION_MEMBERS = new Set([
  'codeRef',
  'operation',
  'instance',
  'expectedDestination',
  'slots',
]);

function serializeBinding(binding: KeyBinding) {
  let { id, ...attributes } = binding;
  return { type: 'key-binding', id, attributes };
}

function serializeApproved({
  binding,
  snapshot,
  grant,
  grantCreated,
}: ApprovedBinding) {
  return {
    ...serializeBinding(binding),
    meta: { request: snapshot, grant: { ...grant, created: grantCreated } },
  };
}

function operationOf(value: unknown): OperationApproval {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UserKeyError(400, 'each approved operation is an object');
  }
  let member = value as Record<string, unknown>;
  for (let name of Object.keys(member)) {
    if (!OPERATION_MEMBERS.has(name)) {
      throw new UserKeyError(400, `'${name}' can't be set on an operation`);
    }
  }
  let { codeRef, operation, instance, expectedDestination, slots } = member;
  if (typeof operation !== 'string' || operation.length === 0) {
    throw new UserKeyError(400, 'an approval names the operation');
  }
  if (typeof expectedDestination !== 'string') {
    throw new UserKeyError(
      400,
      'an approval names the destination its user was shown, as expectedDestination',
    );
  }
  if (instance !== undefined && typeof instance !== 'string') {
    throw new UserKeyError(400, 'an instance is the URL of a card');
  }
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) {
    throw new UserKeyError(
      400,
      'an approval maps each slot it fills to {keyId} or {shareId}',
    );
  }
  return {
    codeRef: codeRefOf(codeRef),
    operation,
    ...(instance !== undefined ? { instance } : {}),
    expectedDestination,
    slots: slots as OperationApproval['slots'],
  };
}

// Approves a batch of operations in one realm: `attributes.{realm,
// operations: [{codeRef, operation, instance?, expectedDestination, slots:
// {<slot>: {keyId} | {shareId}}}]}`. Answers 201 with a binding per slot, each
// with the request it recorded and the grant it sends under, and the batch's
// id. The caller must be able to read the realm; one they can't is answered
// as one that doesn't exist.
export function handleApproveKeyBindings(args: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let approver = ownerOf(ctxt);
    let via = await secureClientOf(ctxt, args, 'operations are approved');
    let body = await readJSON(ctxt);
    let data = body.data as
      | { type?: unknown; attributes?: Record<string, unknown> }
      | undefined;
    if (
      !data ||
      typeof data !== 'object' ||
      data.type !== 'key-binding-approval'
    ) {
      throw new UserKeyError(
        400,
        `the resource type is 'key-binding-approval'`,
      );
    }
    let attributes = data.attributes ?? {};
    if (typeof attributes !== 'object' || Array.isArray(attributes)) {
      throw new UserKeyError(400, 'attributes must be an object');
    }
    for (let name of Object.keys(attributes)) {
      if (!APPROVE_ATTRIBUTES.has(name)) {
        throw new UserKeyError(400, `'${name}' can't be set here`);
      }
    }
    let { realm, operations, interactive, anonymous } = attributes;
    if (!Array.isArray(operations)) {
      throw new UserKeyError(400, 'an approval lists its operations');
    }
    let realmURL = typeof realm === 'string' ? normalizeRealmURL(realm) : null;
    if (!realmURL) {
      throw new UserKeyError(400, 'an approval names the realm');
    }
    let approvals = operations.map(operationOf);
    let target = args.realms.find((r) => r.url === realmURL.href);
    if (
      !target ||
      !(await new RealmPermissionChecker(
        await fetchRealmPermissions(args.dbAdapter, realmURL),
        args.matrixClient,
      ).can(approver, 'read'))
    ) {
      throw new UserKeyError(404, 'no such realm');
    }
    let { batchId, approved } = await approveBindings(
      args.dbAdapter,
      secretsKeyring(),
      {
        core: target.operationCore,
        realmURL,
        approver,
        via,
        operations: approvals,
        interactive: interactive === true,
        anonymous: anonymous === true,
      },
    );
    await sendJSON(ctxt, 201, {
      data: approved.map(serializeApproved),
      meta: { batchId },
    });
  });
}

// The bindings the signed-in user approved, in every realm.
export function handleListKeyBindings({
  dbAdapter,
}: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    let bindings = await listOwnBindings(dbAdapter, owner);
    await sendJSON(ctxt, 200, { data: bindings.map(serializeBinding) });
  });
}

// Revokes one of the user's bindings. Its grant stays.
export function handleRevokeKeyBinding(args: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    let via = await secureClientOf(ctxt, args, 'approvals are revoked');
    await revokeBinding(args.dbAdapter, {
      owner,
      bindingId: ctxt.params.bindingId,
      via,
    });
    await setContextResponse(ctxt, new Response(null, { status: 204 }));
  });
}
