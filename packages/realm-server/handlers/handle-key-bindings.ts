import type Koa from 'koa';
import {
  fetchRealmPermissions,
  rri,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import RealmPermissionChecker from '@cardstack/runtime-common/realm-permission-checker';
import { setContextResponse } from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { normalizeRealmURL } from '../utils/realm-url.ts';
import { secretsKeyring } from '../lib/secrets-at-rest/index.ts';
import {
  approveBindings,
  listOwnBindings,
  previewBindings,
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
import { approvalBatch } from '../lib/key-binding-batch.ts';
import { findRealm } from '../lib/realm-routing.ts';
import { isSecureSession } from '../lib/secure-session.ts';
import { validateContextRequest } from '../lib/secure-window.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';

// The bindings API: approving operations in a realm with the signed-in user's
// keys and shares, revoking those approvals, and listing them. What a binding
// is and how a call uses one is set out in `lib/key-bindings.ts`. Approving
// and revoking take a session signed in on the secure origin, as creating a
// grant does. As for the keys API, the request log keeps only the method and
// path of these routes.
//
// A realm, card or module may be named in prefix form (`@cardstack/…`) or as a
// URL; the server resolves it, keys bindings by URL, and answers in RRI form.

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

// A realm, card or module named in prefix form, as the URL it is served at.
function resolved(network: VirtualNetwork, identifier: string): string {
  return network.isRegisteredPrefix(identifier)
    ? network.toURL(identifier).href
    : identifier;
}

function serializeBinding(network: VirtualNetwork, binding: KeyBinding) {
  let { id, realm, type, instance, ...attributes } = binding;
  return {
    type: 'key-binding',
    id,
    attributes: {
      realm: network.unresolveURL(realm),
      type: { ...type, module: network.unresolveURL(type.module) },
      instance: instance === null ? null : network.unresolveURL(instance),
      ...attributes,
    },
  };
}

function serializeApproved(
  network: VirtualNetwork,
  { binding, snapshot, grant, grantCreated }: ApprovedBinding,
) {
  return {
    ...serializeBinding(network, binding),
    meta: { request: snapshot, grant: { ...grant, created: grantCreated } },
  };
}

// The realm a request names, which the caller must be able to read; one they
// can't is answered as one that doesn't exist.
async function readableRealm(
  args: CreateRoutesArgs,
  caller: string,
  realm: unknown,
) {
  let realmURL =
    typeof realm === 'string'
      ? normalizeRealmURL(resolved(args.virtualNetwork, realm))
      : null;
  if (!realmURL) {
    throw new UserKeyError(400, 'a request names the realm');
  }
  let target = args.realms.find((r) => r.url === realmURL.href);
  if (
    !target ||
    !(await new RealmPermissionChecker(
      await fetchRealmPermissions(args.dbAdapter, realmURL),
      args.matrixClient,
    ).can(caller, 'read'))
  ) {
    throw new UserKeyError(404, 'no such realm');
  }
  return { realmURL, target };
}

function operationOf(
  network: VirtualNetwork,
  value: unknown,
): OperationApproval {
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
    ...(instance !== undefined
      ? { instance: resolved(network, instance as string) }
      : {}),
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
    let approvals = operations.map((operation) =>
      operationOf(args.virtualNetwork, operation),
    );
    let { realmURL, target } = await readableRealm(args, approver, realm);
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
      data: approved.map((a) => serializeApproved(args.virtualNetwork, a)),
      meta: { batchId },
    });
  });
}

// The bindings the signed-in user approved, in every realm.
export function handleListKeyBindings({
  dbAdapter,
  virtualNetwork,
}: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    let bindings = await listOwnBindings(dbAdapter, owner);
    await sendJSON(ctxt, 200, {
      data: bindings.map((b) => serializeBinding(virtualNetwork, b)),
    });
  });
}

// What approving an operation would record, for the approval screen to show
// and the approval to name back: `?realm=&module=&name=&operation=`. Answers
// the destination, whether it is approved per instance, and each slot's
// request and fingerprint. Reads no key, so any session that can read the
// realm may ask.
export function handlePreviewKeyBindings(args: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let caller = ownerOf(ctxt);
    let { realm, module, name, operation } = ctxt.query;
    if (
      typeof module !== 'string' ||
      typeof name !== 'string' ||
      typeof operation !== 'string' ||
      operation.length === 0
    ) {
      throw new UserKeyError(
        400,
        'a preview names the operation by module, name and operation',
      );
    }
    let { realmURL, target } = await readableRealm(args, caller, realm);
    let preview = await previewBindings(target.operationCore, {
      realmURL,
      codeRef: { module: rri(module), name },
      operation,
      caller,
    });
    await sendJSON(ctxt, 200, {
      data: {
        type: 'key-binding-preview',
        attributes: {
          ...preview,
          type: {
            ...preview.type,
            module: args.virtualNetwork.unresolveURL(preview.type.module),
          },
        },
      },
    });
  });
}

const BATCH_ATTRIBUTES = new Set(['target', 'review', 'interactive']);

// The batch the secure window approves in one confirmation
// (`lib/key-binding-batch.ts`): `attributes.{target, review?, interactive?}`,
// where `target` names a card or a card type in its realm as the window's
// context does. Answers every operation on the card's definition that needs
// the caller's approval, grouped by destination, with the caller's keys and
// shares a slot can take. Asked with the window's own session, as every
// request the window makes is.
export function handleKeyBindingBatch(args: CreateRoutesArgs): Handler {
  let { dbAdapter, definitionLookup, virtualNetwork, realms, reconciler } =
    args;
  return keysHandler(async (ctxt) => {
    let user = ownerOf(ctxt);
    if (
      !(await isSecureSession(
        dbAdapter,
        ctxt.state.token as RealmServerTokenClaim | undefined,
      ))
    ) {
      throw new UserKeyError(
        403,
        'the secure window asks this with its own session',
      );
    }
    let body = await readJSON(ctxt);
    let data = body.data as
      | { type?: unknown; attributes?: Record<string, unknown> }
      | undefined;
    if (
      !data ||
      typeof data !== 'object' ||
      data.type !== 'key-binding-batch'
    ) {
      throw new UserKeyError(400, `the resource type is 'key-binding-batch'`);
    }
    let attributes = data.attributes ?? {};
    if (typeof attributes !== 'object' || Array.isArray(attributes)) {
      throw new UserKeyError(400, 'attributes must be an object');
    }
    for (let name of Object.keys(attributes)) {
      if (!BATCH_ATTRIBUTES.has(name)) {
        throw new UserKeyError(400, `'${name}' can't be asked about here`);
      }
    }
    let { review, interactive } = attributes;
    for (let [name, value] of Object.entries({ review, interactive })) {
      if (value !== undefined && typeof value !== 'boolean') {
        throw new UserKeyError(400, `${name} is true or false`);
      }
    }
    let { target } = validateContextRequest({ target: attributes.target });
    if (!target) {
      throw new UserKeyError(400, 'a batch is asked for on a card or type');
    }
    let batch = await approvalBatch(
      {
        dbAdapter,
        findRealm: (url) => findRealm(url, { realms, reconciler, dbAdapter }),
        definitionLookup,
        virtualNetwork,
      },
      user,
      {
        target,
        review: review === true,
        interactive: interactive === true,
      },
    );
    await sendJSON(ctxt, 200, {
      data: {
        type: 'key-binding-batch',
        attributes: {
          ...batch,
          card: {
            ...batch.card,
            module: virtualNetwork.unresolveURL(batch.card.module),
          },
        },
      },
    });
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
