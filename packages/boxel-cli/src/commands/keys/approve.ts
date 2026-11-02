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
  realmArgument,
} from '../../lib/key-bindings.ts';
import { openBrowser } from '../../lib/open-browser.ts';
import { fetchSecureOriginUrl } from '../../lib/secure-session.ts';
import {
  SsoTimeoutError,
  secureOriginPageUrl,
  startLoopbackCallback,
  type WindowOutcome,
} from '../../lib/sso-login.ts';
import {
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
// machine, and finishes when the window says it ended: the approval made, or
// cancelled. Either way, what was approved is read from the realm server. The
// terminal never creates a grant on its own.
//
// An approval is for the card's pipelines unless `--interactive` also allows
// it from an open card, the AI assistant and the CLI, which counts as
// interactive: nothing it invokes runs as a pipeline. With `--interactive` the
// batch also holds operations approved for pipelines only, and the terminal
// prints what interactive use allows before asking. A share approved for
// interactive use for the first time needs its daily budget, from
// `--daily-budget` in the terminal or asked for in the window. `--anonymous`
// also allows use by people who aren't signed in, for the shares the approval
// fills (never a personal key); a share approved for it for the first time
// needs its anonymous cap, from `--anonymous-cap` or asked for in the
// window.

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
  let base = realmArgument(realm);
  let module =
    def.startsWith('@') || /^[a-z][a-z0-9+.-]*:/i.test(def)
      ? def
      : base.startsWith('@')
        ? `${base}${def.replace(/^\.?\//, '')}`
        : new URL(def, base).href;
  return {
    module: module.replace(EXECUTABLE_EXTENSION, ''),
    name,
    ...(operation ? { operation } : {}),
  };
}

interface ApproveOptions {
  operation: string;
  realm: string;
  slot?: string;
  instance?: string;
  interactive?: boolean;
  anonymous?: boolean;
  dailyBudget?: string;
  anonymousCap?: string;
  yes?: boolean;
  timeout?: string;
  json?: boolean;
}

// What interactive use allows, printed once before the confirmation: for the
// user's own key, and for a share, whose approval reaches every reader of the
// realm. The secure window's approve page says the same.
export const INTERACTIVE_CONFIRMATION = {
  userKey:
    'Any card you open can make these calls as you and read what comes back.',
  apiKey:
    "Any card a reader of this realm opens, from any realm, can make these calls with this key and read the responses. Allow this only for a key whose responses aren't private, and that the service limits to reading.",
} as const;

// What anonymous use allows, printed once before the confirmation. The secure
// window's approve page says the same.
export const ANONYMOUS_CONFIRMATION =
  'Anyone on the internet who opens this card can make these calls with this key, up to the anonymous cap.';

// `--daily-budget` and `--anonymous-cap`: a whole number of calls, at least
// one.
function callsOption(
  flag: '--daily-budget' | '--anonymous-cap',
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  let calls = /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isSafeInteger(calls) || calls < 1) {
    throw new Error(`${flag} is a whole number of calls, at least one`);
  }
  return calls;
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
  { interactive, anonymous }: { interactive: boolean; anonymous: boolean },
): void {
  say(
    ctx,
    `Approving ${planned.length} ${planned.length === 1 ? 'call' : 'calls'} that ${batch.card.name} in ${batch.realm.name} (${batch.realm.url}) makes:`,
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
        `    ${p.operation.label}${p.operation.status === 'changed' ? ` ${FG_YELLOW}(changed since it was approved)${RESET}` : p.operation.status === 'pipelines-only' ? ` ${DIM}(approved for pipelines only)${RESET}` : p.operation.status === 'signed-in-only' ? ` ${DIM}(approved for signed-in people only)${RESET}` : ''}`,
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
      '  With --interactive, the card makes these calls on its schedule and whenever it is opened: in the browser, from the AI assistant, or from the CLI.',
    );
    let kinds = new Set(planned.flatMap((p) => p.fills.map((f) => f.kind)));
    for (let kind of ['userKey', 'apiKey'] as const) {
      if (kinds.has(kind)) {
        say(ctx, `  ${FG_YELLOW}${INTERACTIVE_CONFIRMATION[kind]}${RESET}`);
      }
    }
  }
  if (anonymous) {
    say(
      ctx,
      `  ${FG_YELLOW}With --anonymous, for your shares: ${ANONYMOUS_CONFIRMATION}${RESET}`,
    );
  }
  let remaining =
    batch.remaining +
    (interactive ? (batch.remainingPipelinesOnly ?? 0) : 0) +
    (anonymous ? (batch.remainingSignedInOnly ?? 0) : 0);
  if (remaining > 0) {
    say(ctx, '');
    say(
      ctx,
      `  ${DIM}${remaining} more ${remaining === 1 ? 'call needs' : 'calls need'} approving after these; run it again for them.${RESET}`,
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
// to a listener on this machine, and waits for the page to say how it ended:
// the change made, or cancelled (the user cancelled or closed the window
// first). The window finishes it under its own session; nothing comes back
// but how it ended, and the caller reads what changed from the realm server
// whichever it was.
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
): Promise<WindowOutcome> {
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
    say(
      ctx,
      "Waiting for the secure window... Its Cancel or Close button stops this; closing the browser's own window or tab leaves this waiting, so press Ctrl-C then.",
    );
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
    return result.outcome;
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
  let dailyBudget = callsOption('--daily-budget', options.dailyBudget);
  if (dailyBudget !== undefined && !options.interactive) {
    throw new Error('--daily-budget is given with --interactive');
  }
  let anonymousCap = callsOption('--anonymous-cap', options.anonymousCap);
  if (anonymousCap !== undefined && !options.anonymous) {
    throw new Error('--anonymous-cap is given with --anonymous');
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
  let batch = await approvalBatch(ctx.realmServerUrl, token, {
    target,
    interactive: Boolean(options.interactive),
    anonymous: Boolean(options.anonymous),
  });
  // A card is named by its own URL, so the type --operation names is checked
  // against the one the card adopts from. Both are asked of the realm server,
  // which names each the same way, so the two answers compare as written.
  if (options.instance) {
    let named = await approvalBatch(ctx.realmServerUrl, token, {
      target: {
        kind: 'type',
        module: parsed.module,
        name: parsed.name,
        realm: options.realm,
      },
    });
    if (
      named.card.module !== batch.card.module ||
      named.card.exportName !== batch.card.exportName
    ) {
      throw new Error(
        `${options.instance} is a ${batch.card.exportName} from ${batch.card.module}, not the ${parsed.name} from ${named.card.module} that --operation names`,
      );
    }
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
  // The window approves every slot of each operation it is given, so an
  // approval narrowed to one slot can't be confirmed there.
  if (newGrants(planned).length > 0 && options.slot !== undefined) {
    throw new Error(
      `Sending ${newGrants(planned)
        .map((g) => `${g.name} to ${g.host}`)
        .join(
          ', ',
        )} is confirmed in the secure window, which approves every slot of an operation. Approve without --slot, or once the key has been approved for ${[...new Set(newGrants(planned).map((g) => g.host))].join(', ')}`,
    );
  }
  // Approving again sets where a request runs, so an approval made without
  // --interactive would quietly return a live card's requests to pipelines
  // only. Asked for in so many words instead.
  let live = planned.filter((p) =>
    p.operation.slots.some(
      (s) => p.fills.some((f) => f.slot === s.slot) && s.approved?.interactive,
    ),
  );
  if (!interactive && live.length > 0) {
    throw new Error(
      `${live.map((p) => p.operation.label).join(', ')} ${live.length === 1 ? 'is' : 'are'} approved for use in open cards. Pass --interactive to keep that; to run ${live.length === 1 ? 'it' : 'them'} in pipelines only, revoke ${live.length === 1 ? 'it' : 'them'} with \`boxel keys revoke\` and approve again`,
    );
  }
  let anonymous = Boolean(options.anonymous);
  // Likewise, an approval made without --anonymous would quietly stop serving
  // people who aren't signed in.
  let open = planned.filter((p) =>
    p.operation.slots.some(
      (s) => p.fills.some((f) => f.slot === s.slot) && s.approved?.anonymous,
    ),
  );
  if (!anonymous && open.length > 0) {
    throw new Error(
      `${open.map((p) => p.operation.label).join(', ')} ${open.length === 1 ? 'is' : 'are'} approved for people who aren't signed in. Pass --anonymous to keep that; to serve signed-in people only, revoke ${open.length === 1 ? 'it' : 'them'} with \`boxel keys revoke\` and approve again`,
    );
  }
  // Anonymous use is a share's: a person who isn't signed in has no key of
  // their own.
  let filledShares = batch.shares.filter((share) =>
    planned.some((p) =>
      p.fills.some((f) => f.kind === 'apiKey' && f.id === share.id),
    ),
  );
  if (anonymous && filledShares.length === 0) {
    throw new Error(
      "--anonymous allows use of a share by people who aren't signed in, and this approval fills no slot with a share: such a person has no key of their own",
    );
  }
  // The shares this approval allows anonymous use of for the first time,
  // whose anonymous cap it names.
  let firstAnonymous = anonymous
    ? filledShares.filter((share) => !share.anonymous)
    : [];
  // The shares this approval allows interactive use of for the first time,
  // whose daily budget it names.
  let firstInteractive = interactive
    ? batch.shares.filter(
        (share) =>
          !share.interactive &&
          planned.some((p) =>
            p.fills.some((f) => f.kind === 'apiKey' && f.id === share.id),
          ),
      )
    : [];
  if (dailyBudget !== undefined) {
    if (newGrants(planned).length > 0) {
      throw new Error(
        '--daily-budget is asked for in the secure window for this approval, since it sends a key somewhere new. Leave it off',
      );
    }
    if (firstInteractive.length === 0) {
      throw new Error(
        "--daily-budget names the daily budget of a share allowed in open cards for the first time, and this approval has none. A share's limits are changed by its owner from the key's page",
      );
    }
  }
  if (anonymousCap !== undefined) {
    if (newGrants(planned).length > 0) {
      throw new Error(
        '--anonymous-cap is asked for in the secure window for this approval, since it sends a key somewhere new. Leave it off',
      );
    }
    if (firstAnonymous.length === 0) {
      throw new Error(
        "--anonymous-cap names the anonymous cap of a share allowed for people who aren't signed in for the first time, and this approval has none",
      );
    }
  }
  printBatch(ctx, batch, planned, { interactive, anonymous });
  if (!options.yes) {
    if (!(await confirm(ctx, 'Approve? [y/N] '))) {
      throw new Error('Not approved');
    }
  }

  let grants = newGrants(planned);
  let operations = planned.map((p) =>
    approvalOf(p, { module: batch.card.module, name: batch.card.exportName }),
  );
  if (grants.length === 0) {
    if (firstInteractive.length > 0 && dailyBudget === undefined) {
      throw new Error(
        `${firstInteractive.map((s) => s.label).join(', ')} ${firstInteractive.length === 1 ? 'is' : 'are'} allowed in open cards for the first time, so name the daily budget with --daily-budget <calls> (it is ${firstInteractive.map((s) => s.dailyBudget).join(', ')} now)`,
      );
    }
    if (firstAnonymous.length > 0 && anonymousCap === undefined) {
      throw new Error(
        `${firstAnonymous.map((s) => s.label).join(', ')} ${firstAnonymous.length === 1 ? 'is' : 'are'} allowed for people who aren't signed in for the first time, so name the anonymous cap with --anonymous-cap <calls>: the most calls a day all of them together make with the share, at most its daily budget`,
      );
    }
    let { approved } = await approveOperations(ctx.realmServerUrl, token, {
      realm: batch.realm.url,
      operations,
      interactive,
      anonymous,
      ...(dailyBudget !== undefined
        ? {
            dailyBudgets: Object.fromEntries(
              firstInteractive.map((share) => [share.id, dailyBudget]),
            ),
          }
        : {}),
      ...(anonymousCap !== undefined
        ? {
            anonymousCaps: Object.fromEntries(
              firstAnonymous.map((share) => [share.id, anonymousCap]),
            ),
          }
        : {}),
    });
    let result: ApproveResult = { approved, via: 'cli' };
    emit(ctx, result, () => {
      console.log(
        `${FG_GREEN}Approved ${planned.length} ${planned.length === 1 ? 'call' : 'calls'} that ${batch.card.name} makes.${RESET}`,
      );
    });
    return result;
  }

  // The approvals in place before the window opens, so what it approved is
  // told apart from what was there already.
  let ofThisCard = {
    realm: batch.realm.url,
    module: batch.card.module,
    name: batch.card.exportName,
    ...(options.instance ? { instance: options.instance } : {}),
  };
  let before = new Set(
    (await listOwnBindings(ctx.realmServerUrl, token, ofThisCard)).map(
      (b) => b.approvalId,
    ),
  );
  let first = planned[0]!;
  let fill = first.fills[0]!;
  let fragment: Record<string, string> = options.instance
    ? { card: options.instance }
    : {
        module: batch.card.module,
        name: batch.card.exportName,
        realm: batch.realm.url,
      };
  let outcome = await finishInSecureWindow(ctx, {
    page: 'approve',
    fragment: {
      ...fragment,
      operation: first.operation.name,
      key: fill.id,
      operations: planned.map((p) => p.operation.name).join(','),
      ...(interactive ? { interactive: '1' } : {}),
      ...(anonymous ? { anonymous: '1' } : {}),
      reason: `Approve ${batch.card.name}'s requests from the Boxel CLI`,
    },
    what: `sending ${grants.map((g) => `${g.name} to ${g.host}`).join(', ')}`,
    timeoutMs,
  });
  // What the window approved, read back from the realm server: the bindings
  // of the card's operations in this realm approved since it opened.
  let names = new Set(planned.map((p) => p.operation.name));
  let approved = (
    await listOwnBindings(
      ctx.realmServerUrl,
      await ordinaryToken(ctx),
      ofThisCard,
    )
  ).filter(
    (b) =>
      names.has(b.operation) &&
      !before.has(b.approvalId) &&
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
      outcome === 'cancelled'
        ? `Not approved: the secure window was closed without approving ${batch.card.name}'s requests`
        : `The secure window closed without approving ${batch.card.name}'s requests`,
    );
  }
  let result: ApproveResult = { approved, via: 'window' };
  emit(ctx, result, () => {
    let count = new Set(approved.map((b) => b.operation)).size;
    console.log(
      `${FG_GREEN}Approved ${count} ${count === 1 ? 'call' : 'calls'} that ${batch.card.name} makes, in the secure window.${RESET}`,
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
  let realm = realmArgument(options.realm);
  let keyId = await findUserKey(ctx.realmServerUrl, token, name).then(
    (key) => key.id,
    () => undefined,
  );
  // The user's shares labelled `name`, in any realm: the listing below is
  // already narrowed to this one.
  let shareIds = new Set(
    (await listOwnShares(ctx.realmServerUrl, token))
      .filter((s) => s.label === name)
      .map((s) => s.id),
  );
  let bindings = (
    await listOwnBindings(ctx.realmServerUrl, token, {
      realm,
      module: parsed.module,
      name: parsed.name,
      operation: parsed.operation,
      instance: options.instance,
    })
  ).filter(
    (b) =>
      (options.slot === undefined || b.slot === options.slot) &&
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

export type PendingReason = 'changed' | 'unreadable';

export interface PendingBinding {
  binding: KeyBinding;
  reason: PendingReason;
  detail?: string;
}

const PENDING_REASONS: Record<PendingReason, string> = {
  changed: 'its request changed since you approved it',
  unreadable: "its operation can't be read now",
};

// The user's approvals that don't send as approved: one whose request has
// changed since it was approved (whether or not a call has found it yet), and
// one whose operation can't be read now. Removing a grant revokes its
// approvals rather than leaving them waiting, and a share's approvals whose
// key went with its grants are suspended with the share, which its writers
// resume, so neither is listed. Read with the profile's ordinary session.
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
