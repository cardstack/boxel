import { DIM, FG_GREEN, FG_YELLOW, RESET } from '../../lib/colors.ts';
import {
  approvalBatch,
  approveOperations,
  listOwnBindings,
  previewBinding,
  removeGrant,
  revokeBinding,
  type ApprovalBatch,
  type ApprovedBinding,
  type BatchOperation,
  type BatchTarget,
  type BindingPreview,
  type BindingSnapshot,
  type KeyBinding,
  type OperationApproval,
} from '../../lib/key-bindings.ts';
import { openBrowser } from '../../lib/open-browser.ts';
import { fetchSecureOriginUrl } from '../../lib/secure-session.ts';
import {
  SsoTimeoutError,
  secureOriginPageUrl,
  startLoopbackCallback,
} from '../../lib/sso-login.ts';
import {
  canonicalRealmUrl,
  findUserKey,
  listOwnShares,
  type UserKeyGrant,
} from '../../lib/user-keys.ts';
import {
  confirm,
  context,
  emit,
  ordinaryToken,
  say,
  secureToken,
  type Context,
  type KeysCommandDeps,
} from './manage.ts';

// `boxel keys approve`, `revoke`, `pending` and `ungrant`: the approvals that
// let a card's `callApi` operations send the user's keys, made from the
// terminal.
//
// An approval is the same one the secure window's approve page makes: the
// realm server builds the batch (every operation on one card definition, in
// one realm, that needs the user's approval), and one confirmation approves
// it. The terminal prints every request in the batch and asks once. An
// approval that only reuses grants the key already has is made here, with the
// profile's secure session. One that grants a key a destination it has none
// for is confirmed in the secure window instead: the CLI opens the window's
// approve page for that batch, with a single-use link to a listener on this
// machine, and finishes when the window says the approval was made. The
// terminal never creates a grant on its own.
//
// The CLI counts as interactive: nothing it invokes runs as a pipeline. An
// approval is for pipelines only; `--interactive` and `--anonymous` ask the
// realm server for more, and it refuses them, since it offers neither.

// How long the CLI waits for the secure window.
const WINDOW_TIMEOUT_MS = 10 * 60 * 1000;

const EXECUTABLE_EXTENSION = /\.(gts|gjs|ts|js)$/;

// `<def>#<Class>[.<op>]`: the module that defines the card, the class it
// exports, and optionally one of its operations. The module is a URL, a
// prefix-form id (`@cardstack/…`), or a path relative to the realm.
export interface OperationArgument {
  module: string;
  name: string;
  operation?: string;
}

export function parseOperationArgument(
  value: string,
  realm: string,
): OperationArgument {
  let hash = value.lastIndexOf('#');
  if (hash <= 0 || hash === value.length - 1) {
    throw new Error(
      `--operation is <module>#<Class> or <module>#<Class>.<operation>, not ${value}`,
    );
  }
  let def = value.slice(0, hash);
  let rest = value.slice(hash + 1);
  let dot = rest.indexOf('.');
  let name = dot === -1 ? rest : rest.slice(0, dot);
  let operation = dot === -1 ? undefined : rest.slice(dot + 1);
  if (!name || operation === '') {
    throw new Error(
      `--operation is <module>#<Class> or <module>#<Class>.<operation>, not ${value}`,
    );
  }
  let module = def.startsWith('@')
    ? def
    : new URL(def, canonicalRealmUrl(realm)).href;
  return {
    module: module.replace(EXECUTABLE_EXTENSION, ''),
    name,
    ...(operation ? { operation } : {}),
  };
}

// Whether two names of a module name the same one: the realm server answers
// with a module in RRI form, which may be a prefix-form id or a URL, with its
// executable extension trimmed.
function sameModule(a: string, b: string): boolean {
  return (
    a.replace(EXECUTABLE_EXTENSION, '') === b.replace(EXECUTABLE_EXTENSION, '')
  );
}

interface ApproveOptions {
  operation: string;
  realm: string;
  slot?: string;
  instance?: string;
  interactive?: boolean;
  anonymous?: boolean;
  yes?: boolean;
  timeout?: string;
  json?: boolean;
}

// Where a slot's key goes, as a person reads it.
function placement(snapshot: BindingSnapshot): string {
  let { placement, placementName, transform } = snapshot;
  let basic = transform === 'basic' ? ', as HTTP Basic' : '';
  switch (placement) {
    case 'header':
      return `the ${placementName} header${basic}`;
    case 'query':
      return `the ${placementName} query parameter${basic}`;
    case 'path':
      return `the {${placementName}} path segment${basic}`;
    case 'body':
      return `${placementName} in the body${basic}`;
    default:
      return `${placement} ${placementName}${basic}`;
  }
}

// One slot of the approval: which slot, and the key or share that fills it.
interface Fill {
  slot: string;
  kind: 'userKey' | 'apiKey';
  id: string;
  name: string;
  covers: string[];
}

interface Planned {
  operation: BatchOperation;
  destination: string;
  host: string;
  registrableDomain: string;
  fills: Fill[];
}

function chosenOperations(
  batch: ApprovalBatch,
  operation: string | undefined,
): { operation: BatchOperation; group: ApprovalBatch['groups'][number] }[] {
  return batch.groups.flatMap((group) =>
    group.operations
      .filter((o) => operation === undefined || o.name === operation)
      .map((o) => ({ operation: o, group })),
  );
}

// Fills each slot of the chosen operations that `name` can fill: a
// `{{userKey}}` slot with the user's key of that name, an `{{apiKey}}` slot
// with their share in the realm under that label. `--slot` narrows it to one
// slot.
function plan(
  batch: ApprovalBatch,
  name: string,
  { operation, slot }: { operation?: string; slot?: string },
): Planned[] {
  let key = batch.keys.find((k) => k.name === name);
  let share = batch.shares.find((s) => s.label === name);
  let planned: Planned[] = [];
  for (let { operation: op, group } of chosenOperations(batch, operation)) {
    let fills: Fill[] = [];
    for (let s of op.slots) {
      if (slot !== undefined && s.slot !== slot) {
        continue;
      }
      if (s.key === 'userKey' && key) {
        fills.push({
          slot: s.slot,
          kind: 'userKey',
          id: key.id,
          name: key.name,
          covers: key.covers,
        });
      } else if (s.key === 'apiKey' && share) {
        fills.push({
          slot: s.slot,
          kind: 'apiKey',
          id: share.id,
          name: share.label,
          covers: share.covers,
        });
      }
    }
    if (fills.length > 0) {
      planned.push({
        operation: op,
        destination: group.destination.href,
        host: group.destination.host,
        registrableDomain: group.destination.registrableDomain,
        fills,
      });
    }
  }
  return planned;
}

function approvalOf(
  p: Planned,
  codeRef: OperationApproval['codeRef'],
): OperationApproval {
  return {
    codeRef,
    operation: p.operation.name,
    ...(p.operation.instance ? { instance: p.operation.instance } : {}),
    expectedDestination: p.destination,
    slots: Object.fromEntries(
      p.fills.map((fill) => {
        let fingerprint = p.operation.slots.find(
          (s) => s.slot === fill.slot,
        )!.fingerprint;
        return [
          fill.slot,
          fill.kind === 'userKey'
            ? { keyId: fill.id, expectedFingerprint: fingerprint }
            : { shareId: fill.id, expectedFingerprint: fingerprint },
        ];
      }),
    ),
  };
}

// The hosts each key would be sent to for the first time: a destination none
// of its grants covers yet.
function newGrants(planned: Planned[]): { name: string; host: string }[] {
  let seen = new Set<string>();
  let grants: { name: string; host: string }[] = [];
  for (let p of planned) {
    for (let fill of p.fills) {
      let id = `${fill.kind} ${fill.id} ${p.destination}`;
      if (!fill.covers.includes(p.destination) && !seen.has(id)) {
        seen.add(id);
        grants.push({ name: fill.name, host: p.host });
      }
    }
  }
  return grants;
}

function printBatch(
  ctx: Context,
  batch: ApprovalBatch,
  planned: Planned[],
  { interactive }: { interactive: boolean },
): void {
  say(
    ctx,
    `Approving ${planned.length} ${planned.length === 1 ? 'request' : 'requests'} of ${batch.card.name} in ${batch.realm.name} (${batch.realm.url}):`,
  );
  let byDestination = new Map<string, Planned[]>();
  for (let p of planned) {
    byDestination.set(p.destination, [
      ...(byDestination.get(p.destination) ?? []),
      p,
    ]);
  }
  for (let [destination, group] of byDestination) {
    say(ctx, '');
    say(ctx, `  ${group[0]!.registrableDomain}  ${DIM}${destination}${RESET}`);
    for (let p of group) {
      say(
        ctx,
        `    ${p.operation.label}${p.operation.status === 'changed' ? ` ${FG_YELLOW}(changed since it was approved)${RESET}` : ''}`,
      );
      say(ctx, `      ${p.operation.method} ${p.operation.path}`);
      if (p.operation.instance) {
        say(ctx, `      for the card ${p.operation.instance}`);
      }
      for (let fill of p.fills) {
        let snapshot = p.operation.slots.find(
          (s) => s.slot === fill.slot,
        )!.snapshot;
        let whose =
          fill.kind === 'userKey'
            ? `your key ${fill.name}`
            : `your share ${fill.name}`;
        say(ctx, `      sends ${whose} in ${placement(snapshot)}`);
        if (snapshot.bodyTemplate) {
          say(ctx, `      body: ${snapshot.bodyTemplate}`);
        }
      }
    }
  }
  let grants = newGrants(planned);
  if (grants.length > 0) {
    say(ctx, '');
    for (let { name, host } of grants) {
      say(
        ctx,
        `  ${FG_YELLOW}New:${RESET} ${name} is sent to ${host} for the first time.`,
      );
    }
  }
  if (interactive) {
    say(ctx, '');
    say(
      ctx,
      '  These requests may also be sent when you use the card yourself (from a card, the AI assistant or the CLI), not only from its pipelines.',
    );
  }
  if (batch.remaining > 0) {
    say(ctx, '');
    say(
      ctx,
      `  ${DIM}${batch.remaining} more need approving after these; run it again for them.${RESET}`,
    );
  }
  say(ctx, '');
}

// Whether someone is there to answer y/N. Checked before signing in, so a
// missing `--yes` never costs a browser trip.
function requireConfirmation(
  ctx: Context,
  yes: boolean | undefined,
  what: string,
) {
  if (!yes && (ctx.json || !(ctx.deps.confirmFn || process.stdin.isTTY))) {
    throw new Error(`Pass --yes to ${what} without a terminal to confirm in`);
  }
}

export function windowTimeout(value: string | undefined): number {
  if (value === undefined) {
    return WINDOW_TIMEOUT_MS;
  }
  let seconds = Number(value);
  if (!(Number.isFinite(seconds) && seconds >= 0)) {
    throw new Error('--timeout is a number of seconds');
  }
  return seconds * 1000;
}

// Opens a page of the secure window for one change, with a single-use link
// to a listener on this machine, and waits for the page to say the change
// was made. The window finishes it under its own session; nothing comes back
// but that it ended, and the caller reads what changed from the realm server.
export async function finishInSecureWindow(
  ctx: Context,
  {
    page,
    fragment,
    what,
    timeoutMs,
  }: {
    page: string;
    fragment: Record<string, string>;
    what: string;
    timeoutMs: number;
  },
): Promise<void> {
  let interactive =
    ctx.deps.interactive ??
    (ctx.deps.openBrowserFn ? true : Boolean(process.stderr.isTTY));
  if (!interactive) {
    throw new Error(
      `${what} is confirmed in the secure window, which needs you at the browser. Run it in a terminal`,
    );
  }
  let secureOrigin = await fetchSecureOriginUrl(ctx.realmServerUrl);
  let listener = await startLoopbackCallback({ timeoutMs });
  try {
    let url = secureOriginPageUrl(secureOrigin, page);
    url.hash = new URLSearchParams({
      ...fragment,
      cli_port: String(listener.port),
      cli_state: listener.state,
    }).toString();
    let open = ctx.deps.openBrowserFn ?? openBrowser;
    if (await open(url.href)) {
      say(ctx, `Opening the secure window to confirm ${what}...`);
      say(ctx, `If it didn't open, visit:\n  ${url.href}`);
    } else {
      say(
        ctx,
        `Open this URL in your browser to confirm ${what}:\n  ${url.href}`,
      );
    }
    say(ctx, 'Waiting for the secure window...');
    let result;
    try {
      result = await listener.waitForResult();
    } catch (e) {
      if (e instanceof SsoTimeoutError) {
        throw new Error(
          `The secure window wasn't finished in time, so ${what} wasn't confirmed. Run it again to start over`,
        );
      }
      throw e;
    }
    if (result.kind !== 'window') {
      throw new Error('The browser returned something other than the window.');
    }
    if (result.outcome !== 'done') {
      throw new Error(`${what} was cancelled in the secure window`);
    }
  } finally {
    listener.close();
  }
}

export interface ApproveResult {
  approved: (KeyBinding | ApprovedBinding)[];
  via: 'cli' | 'window';
}

export async function keysApprove(
  name: string,
  options: ApproveOptions & KeysCommandDeps,
): Promise<ApproveResult> {
  let ctx = context(options.json, options);
  if (options.anonymous && !options.interactive) {
    throw new Error('--anonymous is given with --interactive');
  }
  let timeoutMs = windowTimeout(options.timeout);
  let parsed = parseOperationArgument(options.operation, options.realm);
  requireConfirmation(ctx, options.yes, 'approve');
  let token = await secureToken(ctx);
  let target: BatchTarget = options.instance
    ? { kind: 'instance', url: options.instance }
    : {
        kind: 'type',
        module: parsed.module,
        name: parsed.name,
        realm: options.realm,
      };
  let batch = await approvalBatch(ctx.realmServerUrl, token, { target });
  // A card is named by its own URL, so the class --operation names is checked
  // against the one the card adopts from.
  if (options.instance && batch.card.exportName !== parsed.name) {
    throw new Error(
      `${options.instance} is a ${batch.card.exportName}, not the ${parsed.name} --operation names`,
    );
  }
  let planned = plan(batch, name, {
    operation: parsed.operation,
    slot: options.slot,
  });
  if (planned.length === 0) {
    let pending = chosenOperations(batch, parsed.operation);
    if (pending.length === 0) {
      throw new Error(
        parsed.operation
          ? `${batch.card.name}'s ${parsed.operation} has nothing to approve in ${batch.realm.url}: it is approved already, sends no key, or isn't one of its operations. \`boxel keys pending\` lists what needs approving again`
          : `${batch.card.name} has nothing to approve in ${batch.realm.url}`,
      );
    }
    throw new Error(
      `You have no key named ${name}, and no share labelled ${name} in ${batch.realm.url}, that fills ${options.slot ? `the slot ${options.slot}` : 'a slot'} of ${parsed.operation ?? batch.card.name}. \`boxel keys list\` and \`boxel keys show\` list them`,
    );
  }
  let interactive = Boolean(options.interactive);
  printBatch(ctx, batch, planned, { interactive });
  if (!options.yes) {
    if (!(await confirm(ctx, 'Approve? [y/N] '))) {
      throw new Error('Not approved');
    }
  }

  let grants = newGrants(planned);
  let operations = planned.map((p) =>
    approvalOf(p, { module: batch.card.module, name: batch.card.exportName }),
  );

  // Asking for more than pipelines is the realm server's to refuse, which it
  // does before anything is approved, so it is asked here, whatever grants
  // the approval needs.
  if (grants.length === 0 || interactive) {
    let { approved } = await approveOperations(ctx.realmServerUrl, token, {
      realm: batch.realm.url,
      operations,
      interactive,
      anonymous: Boolean(options.anonymous),
    });
    let result: ApproveResult = { approved, via: 'cli' };
    emit(ctx, result, () => {
      console.log(
        `${FG_GREEN}Approved ${planned.length} ${planned.length === 1 ? 'request' : 'requests'} of ${batch.card.name}.${RESET}`,
      );
    });
    return result;
  }

  let first = planned[0]!;
  let fill = first.fills[0]!;
  let fragment: Record<string, string> = options.instance
    ? { card: options.instance }
    : {
        module: batch.card.module,
        name: batch.card.exportName,
        realm: batch.realm.url,
      };
  await finishInSecureWindow(ctx, {
    page: 'approve',
    fragment: {
      ...fragment,
      operation: first.operation.name,
      key: fill.id,
      operations: planned.map((p) => p.operation.name).join(','),
      reason: `Approve ${batch.card.name}'s requests from the Boxel CLI`,
    },
    what: `sending ${grants.map((g) => `${g.name} to ${g.host}`).join(', ')}`,
    timeoutMs,
  });
  // What the window approved, read back from the realm server: the bindings
  // of the card's operations in this realm.
  let names = new Set(planned.map((p) => p.operation.name));
  let approved = (
    await listOwnBindings(ctx.realmServerUrl, await ordinaryToken(ctx))
  ).filter(
    (b) =>
      canonicalRealmUrl(b.realm) === canonicalRealmUrl(batch.realm.url) &&
      b.type.name === batch.card.exportName &&
      sameModule(b.type.module, batch.card.module) &&
      names.has(b.operation) &&
      planned.some(
        (p) =>
          p.operation.name === b.operation &&
          p.operation.slots.some(
            (s) => s.slot === b.slot && s.fingerprint === b.fingerprint,
          ),
      ),
  );
  if (approved.length === 0) {
    throw new Error(
      `The secure window closed without approving ${batch.card.name}'s requests`,
    );
  }
  let result: ApproveResult = { approved, via: 'window' };
  emit(ctx, result, () => {
    let count = new Set(approved.map((b) => b.operation)).size;
    console.log(
      `${FG_GREEN}Approved ${count} ${count === 1 ? 'request' : 'requests'} of ${batch.card.name} in the secure window.${RESET}`,
    );
  });
  return result;
}

interface RevokeOptions {
  operation: string;
  realm: string;
  slot?: string;
  instance?: string;
  yes?: boolean;
  json?: boolean;
}

// Revokes the user's approvals of a card's operations in a realm that send
// the key `name` (or the share labelled `name` there). Their grants stay.
export async function keysRevoke(
  name: string,
  options: RevokeOptions & KeysCommandDeps,
): Promise<KeyBinding[]> {
  let ctx = context(options.json, options);
  let parsed = parseOperationArgument(options.operation, options.realm);
  requireConfirmation(ctx, options.yes, 'revoke');
  let token = await secureToken(ctx);
  let realm = canonicalRealmUrl(options.realm);
  let keyId = await findUserKey(ctx.realmServerUrl, token, name).then(
    (key) => key.id,
    () => undefined,
  );
  let shareIds = new Set(
    (await listOwnShares(ctx.realmServerUrl, token))
      .filter((s) => canonicalRealmUrl(s.realm) === realm && s.label === name)
      .map((s) => s.id),
  );
  let bindings = (await listOwnBindings(ctx.realmServerUrl, token)).filter(
    (b) =>
      canonicalRealmUrl(b.realm) === realm &&
      b.type.name === parsed.name &&
      sameModule(b.type.module, parsed.module) &&
      (parsed.operation === undefined || b.operation === parsed.operation) &&
      (options.slot === undefined || b.slot === options.slot) &&
      (options.instance === undefined || b.instance === options.instance) &&
      ((keyId !== undefined && b.keyId === keyId) ||
        (b.shareId !== null && shareIds.has(b.shareId))),
  );
  if (bindings.length === 0) {
    throw new Error(
      `Nothing of ${parsed.name}${parsed.operation ? `'s ${parsed.operation}` : ''} in ${realm} is approved to send ${name}`,
    );
  }
  if (!options.yes) {
    say(ctx, `Revoking these approvals of ${name}:`);
    for (let b of bindings) {
      say(
        ctx,
        `  ${b.operationLabel ?? b.operation} (${b.slot})${b.instance ? ` for ${b.instance}` : ''}`,
      );
    }
    if (!(await confirm(ctx, 'Revoke? [y/N] '))) {
      throw new Error('Not revoked');
    }
  }
  for (let b of bindings) {
    await revokeBinding(ctx.realmServerUrl, token, b.id);
  }
  emit(ctx, bindings, () => {
    console.log(
      `${FG_GREEN}Revoked ${bindings.length} ${bindings.length === 1 ? 'approval' : 'approvals'} of ${name}.${RESET}`,
    );
  });
  return bindings;
}

export type PendingReason = 'changed' | 'grant-removed' | 'unreadable';

export interface PendingBinding {
  binding: KeyBinding;
  reason: PendingReason;
  detail?: string;
}

const PENDING_REASONS: Record<PendingReason, string> = {
  changed: 'its request changed since you approved it',
  'grant-removed': 'the grant it sent under was removed',
  unreadable: "its operation can't be read now",
};

// The user's approvals that don't send as approved: one whose request has changed
// since it was approved (whether or not a call has found it yet), one whose
// grant was removed, and one whose operation can't be read now. Read with the
// profile's ordinary session.
export async function keysPending(
  options: { json?: boolean } & KeysCommandDeps = {},
): Promise<PendingBinding[]> {
  let ctx = context(options.json, options);
  let token = await ordinaryToken(ctx);
  let bindings = await listOwnBindings(ctx.realmServerUrl, token);
  let previews = new Map<string, Promise<BindingPreview>>();
  let pending: PendingBinding[] = [];
  for (let binding of bindings) {
    if (binding.state === 'suspended') {
      // A suspended share's approvals are the share's writers' to resume.
      continue;
    }
    if (binding.state === 'needs-reapproval') {
      pending.push({ binding, reason: 'changed' });
      continue;
    }
    if (binding.grantId === null) {
      pending.push({ binding, reason: 'grant-removed' });
      continue;
    }
    let id = JSON.stringify([
      binding.realm,
      binding.type.module,
      binding.type.name,
      binding.operation,
    ]);
    let preview = previews.get(id);
    if (!preview) {
      preview = previewBinding(ctx.realmServerUrl, token, {
        realm: binding.realm,
        module: binding.type.module,
        name: binding.type.name,
        operation: binding.operation,
      });
      preview.catch(() => {});
      previews.set(id, preview);
    }
    try {
      let { slots } = await preview;
      let now = slots.find((s) => s.slot === binding.slot);
      if (!now || now.fingerprint !== binding.fingerprint) {
        pending.push({ binding, reason: 'changed' });
      }
    } catch (e: any) {
      pending.push({
        binding,
        reason: 'unreadable',
        detail: e?.reason || e?.message,
      });
    }
  }
  emit(ctx, pending, () => {
    if (pending.length === 0) {
      console.log('Nothing you approved needs approving again.');
      return;
    }
    for (let { binding, reason, detail } of pending) {
      console.log(
        `${binding.cardName ?? binding.type.name}: ${binding.operationLabel ?? binding.operation} ${DIM}in ${binding.realm}, slot ${binding.slot}${binding.instance ? `, card ${binding.instance}` : ''}${RESET}`,
      );
      console.log(
        `  ${PENDING_REASONS[reason]}${detail ? ` (${detail})` : ''}`,
      );
    }
    console.log(
      `${DIM}Approve again with \`boxel keys approve <key> --operation <module>#<Class>.<operation> --realm <url>\`.${RESET}`,
    );
  });
  return pending;
}

// Removes the grant of the key `name` for one destination, after listing the
// approvals its removal revokes.
export async function keysUngrant(
  name: string,
  options: {
    destination: string;
    yes?: boolean;
    json?: boolean;
  } & KeysCommandDeps,
): Promise<{ grant: UserKeyGrant; revoked: KeyBinding[] }> {
  let ctx = context(options.json, options);
  let destination: string;
  try {
    destination = new URL(options.destination).href;
  } catch {
    throw new Error(`--destination ${options.destination} is not a URL`);
  }
  requireConfirmation(ctx, options.yes, 'remove a grant');
  let token = await secureToken(ctx);
  let key = await findUserKey(ctx.realmServerUrl, token, name);
  let grant = (key.grants ?? []).find((g) => g.destination === destination);
  if (!grant) {
    let destinations = (key.grants ?? []).map((g) => g.destination);
    throw new Error(
      destinations.length > 0
        ? `${name} has no grant for ${destination}. Its grants are: ${destinations.join(', ')}`
        : `${name} has no grants`,
    );
  }
  let revoked = (await listOwnBindings(ctx.realmServerUrl, token)).filter(
    (b) => b.grantId === grant.id,
  );
  if (!options.yes) {
    if (revoked.length > 0) {
      say(
        ctx,
        `Removing ${name}'s grant for ${destination} revokes these approvals:`,
      );
      for (let b of revoked) {
        say(
          ctx,
          `  ${b.cardName ?? b.type.name}: ${b.operationLabel ?? b.operation} in ${b.realm}`,
        );
      }
    } else {
      say(ctx, `No approval sends ${name} under its grant for ${destination}.`);
    }
    if (!(await confirm(ctx, 'Remove the grant? [y/N] '))) {
      throw new Error('Not removed');
    }
  }
  let { revokedBindings } = await removeGrant(
    ctx.realmServerUrl,
    token,
    grant.id,
  );
  let revokedIds = new Set(revokedBindings);
  let result = {
    grant,
    revoked: revoked.filter((b) => revokedIds.has(b.id)),
  };
  emit(ctx, result, () => {
    console.log(
      `${FG_GREEN}Removed ${name}'s grant for ${destination}.${RESET}` +
        (revokedBindings.length > 0
          ? ` ${revokedBindings.length} ${revokedBindings.length === 1 ? 'approval' : 'approvals'} revoked.`
          : ''),
    );
  });
  return result;
}
