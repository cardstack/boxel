import type Koa from 'koa';
import {
  fetchRealmPermissions,
  param,
  query,
  rri,
  trimExecutableExtension,
  type RealmIdentifier,
  type RealmResourceIdentifier,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { realmServerAutomationChangeReporter } from '../lib/run-change-reporter.ts';
import RealmPermissionChecker from '@cardstack/runtime-common/realm-permission-checker';
import { setContextResponse } from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { normalizeRealmURL } from '../utils/realm-url.ts';
import { secretsKeyring } from '../lib/secrets-at-rest/index.ts';
import {
  approveBindings,
  canonicalInstance,
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
import {
  approvalBatch,
  bindingNames,
  type BindingNames,
} from '../lib/key-binding-batch.ts';
import { findRealm } from '../lib/realm-routing.ts';
import {
  automationsWaitingForKeyApproval,
  followAutomationKeyApprovals,
} from '../lib/automation-key-approvals.ts';
import { getAutomation } from '@cardstack/runtime-common/automations';
import { readRunDeclaration } from '@cardstack/runtime-common/automation-run-limits';
import type { AutomationVersion } from '@cardstack/runtime-common/automation-key-approval';
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
  'dailyBudgets',
  'automation',
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

function serializeBinding(
  network: VirtualNetwork,
  binding: KeyBinding,
  names?: BindingNames,
) {
  let { id, realm, type, instance, ...attributes } = binding;
  return {
    type: 'key-binding',
    id,
    attributes: {
      realm: network.unresolveURL(realm),
      type: { ...type, module: network.unresolveURL(type.module) },
      instance: instance === null ? null : network.unresolveURL(instance),
      ...attributes,
      ...names,
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
      args.dbAdapter,
      args.matrixClient.serverName,
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
// {<slot>: {keyId} | {shareId}}}], automation?: {id, version}}`. Answers 201
// with a binding per slot, each with the request it recorded and the grant it
// sends under, and the batch's id. The caller must be able to read the realm;
// one they can't is answered as one that doesn't exist.
//
// `automation` names a switched-on automation of the realm, by its card, and
// the version of it the approver was shown (the `version` switch-on answers
// in `keyApprovals`): the confirmation also approves that automation to use
// each binding it writes (ADR 039 §1.2), and is refused (409) when the
// automation has changed since. Once the confirmation commits, every
// automation of the realm waiting for key approval is checked again, and
// each whose approvals all match now runs.
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
    let { realm, operations, interactive, anonymous, dailyBudgets } =
      attributes;
    let named = automationNamed(attributes.automation);
    if (!Array.isArray(operations)) {
      throw new UserKeyError(400, 'an approval lists its operations');
    }
    if (
      dailyBudgets !== undefined &&
      (!dailyBudgets ||
        typeof dailyBudgets !== 'object' ||
        Array.isArray(dailyBudgets))
    ) {
      throw new UserKeyError(
        400,
        'dailyBudgets names a daily budget by share id',
      );
    }
    let approvals = operations.map((operation) =>
      operationOf(args.virtualNetwork, operation),
    );
    let { realmURL, target } = await readableRealm(args, approver, realm);
    let automation = named
      ? await approvedAutomation(args, target, realmURL, named)
      : undefined;
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
        dailyBudgets: (dailyBudgets ?? {}) as Record<string, number>,
        ...(automation ? { automation } : {}),
      },
    );
    await followAutomationKeyApprovals(
      args,
      realmURL,
      await automationsWaitingForKeyApproval(args.dbAdapter, realmURL, args),
    );
    await sendJSON(ctxt, 201, {
      data: approved.map((a) => serializeApproved(args.virtualNetwork, a)),
      meta: { batchId },
    });
  });
}

// The automation an approval names, as `{id, version}`: its card, and the
// version of it the approver was shown.
function automationNamed(
  value: unknown,
): { id: string; version: string } | undefined {
  if (value === undefined) {
    return undefined;
  }
  let named = value as Record<string, unknown> | null;
  if (
    !named ||
    typeof named !== 'object' ||
    Array.isArray(named) ||
    typeof named.id !== 'string' ||
    typeof named.version !== 'string' ||
    Object.keys(named).some((key) => key !== 'id' && key !== 'version')
  ) {
    throw new UserKeyError(
      400,
      'automation names the automation card as id and the version its approver was shown as version',
    );
  }
  return { id: named.id, version: named.version };
}

// The automation an approval names, switched on in the realm, with its
// version as it is now.
async function approvedAutomation(
  args: CreateRoutesArgs,
  target: CreateRoutesArgs['realms'][number],
  realmURL: URL,
  named: { id: string; version: string },
): Promise<{
  automationId: string;
  expectedVersion: string;
  current: AutomationVersion;
}> {
  let cardURL = resolved(args.virtualNetwork, named.id).replace(/\.json$/, '');
  let automationId = rri(args.virtualNetwork.unresolveURL(cardURL));
  let row = await getAutomation(args.dbAdapter, automationId);
  if (!row || args.virtualNetwork.toURLHref(row.realm) !== realmURL.href) {
    throw new UserKeyError(
      404,
      'the automation the approval names is not switched on in this realm',
    );
  }
  let read = await readRunDeclaration({
    dbAdapter: args.dbAdapter,
    definitionLookup: args.definitionLookup,
    virtualNetwork: args.virtualNetwork,
    automationId,
  });
  let current = read.ok
    ? await target.automationVersionOf({
        declaration: read.declaration,
        payer: row.payer,
      })
    : undefined;
  if (!current) {
    throw new UserKeyError(
      409,
      "the automation's card or script can't be read, so its approval can't be given now",
    );
  }
  return { automationId, expectedVersion: named.version, current };
}

// Which of the user's bindings `?realm=&module=&name=&operation=&instance=`
// asks for. Each is optional, and each may be named in prefix form or as a
// URL: it is resolved here, as a binding is keyed, so a caller needn't know
// how the server spells a realm or a module. An instance is named within the
// realm, so it is asked for with `realm`.
function bindingFilter(
  network: VirtualNetwork,
  query: Koa.Context['query'],
): (binding: KeyBinding) => boolean {
  let one = (name: string) => {
    let value = query[name];
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'string' || value.length === 0) {
      throw new UserKeyError(400, `${name} is given once, as text`);
    }
    return value;
  };
  let realm = one('realm');
  let module = one('module');
  let name = one('name');
  let operation = one('operation');
  let instance = one('instance');
  let realmURL = realm ? normalizeRealmURL(resolved(network, realm)) : null;
  if (realm && !realmURL) {
    throw new UserKeyError(400, 'realm is a realm');
  }
  if (instance && !realmURL) {
    throw new UserKeyError(400, 'an instance is asked for with its realm');
  }
  let moduleURL = module
    ? trimExecutableExtension(resolved(network, module))
    : undefined;
  let instanceURL =
    instance && realmURL
      ? canonicalInstance(realmURL, resolved(network, instance))
      : undefined;
  return (binding) =>
    (!realmURL || binding.realm === realmURL.href) &&
    (!moduleURL || binding.type.module === moduleURL) &&
    (!name || binding.type.name === name) &&
    (!operation || binding.operation === operation) &&
    (!instanceURL || binding.instance === instanceURL);
}

// The bindings the signed-in user approved, in every realm, or those
// `bindingFilter` asks for, each with what the key page names it by: its
// operation's label and its card's display name (`bindingNames`).
export function handleListKeyBindings({
  dbAdapter,
  definitionLookup,
  virtualNetwork,
  realms,
  reconciler,
  matrixClient,
}: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    let wanted = bindingFilter(virtualNetwork, ctxt.query);
    let bindings = (await listOwnBindings(dbAdapter, owner)).filter(wanted);
    let names = await bindingNames(
      {
        dbAdapter,
        findRealm: (url) => findRealm(url, { realms, reconciler, dbAdapter }),
        definitionLookup,
        virtualNetwork,
        matrixServerName: matrixClient.serverName,
      },
      owner,
      bindings,
    );
    await sendJSON(ctxt, 200, {
      data: bindings.map((b, i) =>
        serializeBinding(virtualNetwork, b, names[i]),
      ),
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

const BATCH_ATTRIBUTES = new Set([
  'target',
  'review',
  'interactive',
  'operations',
]);

// The batch the secure window approves in one confirmation
// (`lib/key-binding-batch.ts`): `attributes.{target, review?, interactive?,
// operations?}`, where `target` names a card or a card type in its realm as
// the window's context does, and `operations` names the operations an
// approval covers when it covers only some, which the keys offered for each
// slot then weigh alone. Answers every operation on the card's definition that needs
// the caller's approval, grouped by destination, with the caller's keys and
// shares a slot can take. Asked with a session signed in on the secure
// origin: the window's own, or the CLI's (`boxel keys approve`).
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
        'a batch is asked for only by a session signed in on the secure origin',
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
    let { review, interactive, operations } = attributes;
    if (review !== undefined && typeof review !== 'boolean') {
      throw new UserKeyError(400, 'review is true or false');
    }
    if (interactive !== undefined && typeof interactive !== 'boolean') {
      throw new UserKeyError(400, 'interactive is true or false');
    }
    if (
      operations !== undefined &&
      !(
        Array.isArray(operations) &&
        operations.length > 0 &&
        operations.every((o) => typeof o === 'string' && o !== '')
      )
    ) {
      throw new UserKeyError(400, 'operations is a list of operation names');
    }
    let { target } = validateContextRequest({ target: attributes.target });
    if (!target) {
      throw new UserKeyError(400, 'a batch is asked for on a card or type');
    }
    let batch = await approvalBatch(
      {
        dbAdapter,
        matrixServerName: args.matrixClient.serverName,
        findRealm: (url) => findRealm(url, { realms, reconciler, dbAdapter }),
        definitionLookup,
        virtualNetwork,
      },
      user,
      {
        target,
        review: review === true,
        interactive: interactive === true,
        ...(operations !== undefined
          ? { operations: operations as string[] }
          : {}),
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

// Revokes one of the user's bindings. Its grant stays. Each automation the
// binding served waits for key approval from then on
// (`revokeBindingsIn`), and the direct writers of its realm are told.
export function handleRevokeKeyBinding(args: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    let via = await secureClientOf(ctxt, args, 'approvals are revoked');
    let bindingId = ctxt.params.bindingId;
    let served = UUID_PATTERN.test(bindingId)
      ? await query(args.dbAdapter, [
          'SELECT a.automation_id, au.realm FROM automation_key_approvals a JOIN automations au ON au.automation_id = a.automation_id WHERE a.binding_id =',
          param(bindingId),
          '::uuid',
        ])
      : [];
    await revokeBinding(args.dbAdapter, { owner, bindingId, via });
    let report = realmServerAutomationChangeReporter(args);
    for (let row of served) {
      await report({
        automationId: row.automation_id as RealmResourceIdentifier,
        realm: row.realm as RealmIdentifier,
      });
    }
    await setContextResponse(ctxt, new Response(null, { status: 204 }));
  });
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
