// What the approve page decides about a batch, apart from drawing it: one
// choice per slot for the whole batch and which key it starts on, which
// groups the chosen keys have no grant for yet, what changed in a request
// since it was approved, and the one confirmation the page sends.

import type {
  ApprovalBatch,
  BatchOperation,
  BatchSlot,
  OperationApproval,
  RequestSnapshot,
} from '../../security/keys.ts';

import {
  anonymousCapsClause,
  anonymousCapsPhrase,
  type AnonymousCaps,
} from './anonymous-caps.ts';

// A slot of the batch, by its token, and what can fill it: the user's own
// keys for a `userKey` slot, their shares in the realm for an `apiKey` one.
export interface SlotChoice {
  slot: string;
  kind: 'userKey' | 'apiKey';
  options: SlotOption[];
}

export interface SlotOption {
  id: string;
  name: string;
  // Whether the service rejected the key: offered and marked, never chosen
  // for the user.
  rejected?: boolean;
  // For a share, the key it holds.
  detail?: string;
  // The batch's destinations this key's (or share's key's) grants cover.
  covers: string[];
}

// Each slot token the batch's operations use, in the order they first appear.
export function slotChoices(batch: ApprovalBatch): SlotChoice[] {
  let choices: SlotChoice[] = [];
  for (let slot of allSlots(batch)) {
    if (choices.some((c) => c.slot === slot.slot)) {
      continue;
    }
    let kind = slot.key;
    // One choice fills the slot in every operation of the batch, so it offers
    // only the keys that can fill each of them: of a kind every one of them
    // takes, and good at every destination the slot is sent to.
    let slots = allSlots(batch).filter((s) => s.slot === slot.slot);
    let destinations = destinationsOfSlot(batch, slot.slot);
    let fits = (keyKind: string, serves: string[] | undefined) =>
      slots.every((s) => {
        let kinds = kindsOfSlot(s);
        return kinds === undefined || kinds.includes(slotKindOfKey(keyKind));
      }) &&
      (serves === undefined || destinations.every((d) => serves.includes(d)));
    let options: SlotOption[] =
      kind === 'userKey'
        ? batch.keys
            .filter((key) => fits(key.kind, key.serves))
            .map(({ id, name, covers, state }) => ({
              id,
              name,
              covers,
              ...(state === 'rejected' ? { rejected: true } : {}),
            }))
        : batch.shares
            .filter((share) => fits(share.keyKind, share.serves))
            .map(({ id, label, keyName, covers }) => ({
              id,
              name: label,
              detail: keyName,
              covers,
            }));
    // Those already allowed where the batch sends come first.
    options = [...options].sort(
      (a, b) =>
        b.covers.length - a.covers.length || a.name.localeCompare(b.name),
    );
    choices.push({ slot: slot.slot, kind, options });
  }
  return choices;
}

// The kind of slot a stored key fills: an OAuth connection, or an OAuth
// client that gets its own tokens, fills an `oauth` slot.
function slotKindOfKey(keyKind: string): string {
  return keyKind === 'oauth-connection' || keyKind === 'oauth-client'
    ? 'oauth'
    : keyKind;
}

// The kinds of key that can fill a slot: those the realm server names, else
// the declared one. Undefined when neither is known: any key is offered.
function kindsOfSlot(slot: BatchSlot): string[] | undefined {
  return slot.kinds ?? (slot.keyKind ? [slot.keyKind] : undefined);
}

function allSlots(batch: ApprovalBatch): BatchSlot[] {
  return batch.groups.flatMap((g) => g.operations.flatMap((o) => o.slots));
}

// The key a slot starts on: the one `preferred` names when it can fill the
// slot; else the one every operation with the slot was last approved with;
// else the one key whose grants already cover every destination the slot is
// sent to, or failing that the one whose grants cover any of them; else the
// only one there is. Otherwise the user chooses.
export function initialChoice(
  batch: ApprovalBatch,
  choice: SlotChoice,
  preferred?: string,
): string | undefined {
  let usable = choice.options.filter((o) => !o.rejected);
  let ids = usable.map((o) => o.id);
  if (preferred && ids.includes(preferred)) {
    return preferred;
  }
  let slots = allSlots(batch).filter((s) => s.slot === choice.slot);
  let previous = new Set(
    slots.map((s) =>
      choice.kind === 'userKey' ? s.approved?.keyId : s.approved?.shareId,
    ),
  );
  if (previous.size === 1) {
    let [id] = previous;
    if (id && ids.includes(id)) {
      return id;
    }
  }
  let destinations = destinationsOfSlot(batch, choice.slot);
  for (let covers of [
    (o: SlotOption) => destinations.every((d) => o.covers.includes(d)),
    (o: SlotOption) => destinations.some((d) => o.covers.includes(d)),
  ]) {
    let covering = usable.filter(covers);
    if (covering.length === 1) {
      return covering[0]!.id;
    }
    if (covering.length > 1) {
      return undefined;
    }
  }
  return usable.length === 1 ? usable[0]!.id : undefined;
}

function destinationsOfSlot(batch: ApprovalBatch, slot: string): string[] {
  return batch.groups
    .filter((g) =>
      g.operations.some((o) => o.slots.some((s) => s.slot === slot)),
    )
    .map((g) => g.destination.href);
}

export interface NewGrant {
  // The group's destination.
  destination: string;
  host: string;
  path: string;
  registrableDomain: string;
  // What the chosen key is called, for a slot, and the slot.
  keyName: string;
  slot: string;
  // The key (or share) chosen for the slot.
  optionId: string;
}

// The grants confirming would create: for each group with a ticked operation,
// each slot whose chosen key has no grant there yet.
export function newGrants(
  batch: ApprovalBatch,
  choices: SlotChoice[],
  chosen: Record<string, string | undefined>,
  ticked: Set<string>,
): NewGrant[] {
  let found: NewGrant[] = [];
  for (let group of batch.groups) {
    let slots = new Set(
      group.operations
        .filter((o) => ticked.has(operationKey(o)))
        .flatMap((o) => o.slots.map((s) => s.slot)),
    );
    for (let slot of slots) {
      let option = choices
        .find((c) => c.slot === slot)
        ?.options.find((o) => o.id === chosen[slot]);
      if (option && !option.covers.includes(group.destination.href)) {
        found.push({
          destination: group.destination.href,
          host: group.destination.host,
          path: group.destination.path,
          registrableDomain: group.destination.registrableDomain,
          keyName: option.detail ?? option.name,
          slot,
          optionId: option.id,
        });
      }
    }
  }
  return found;
}

// How an operation is named among the batch's: its name, and the card it is
// approved for when it is approved per instance.
export function operationKey(operation: BatchOperation): string {
  return operation.instance
    ? `${operation.name} ${operation.instance}`
    : operation.name;
}

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

const FIELDS: { field: keyof RequestSnapshot; label: string }[] = [
  { field: 'destination', label: 'Destination' },
  { field: 'method', label: 'Method' },
  { field: 'pathTemplate', label: 'Path and query' },
  { field: 'headersTemplate', label: 'Headers' },
  { field: 'placement', label: 'Where the key goes' },
  { field: 'placementName', label: 'Named' },
  { field: 'transform', label: 'Encoded as' },
  { field: 'bodyTemplate', label: 'Body' },
];

// What changed in a slot's request since it was approved, field by field.
export function requestChanges(slot: BatchSlot): FieldChange[] {
  let before = slot.approved?.snapshot;
  if (!before) {
    return [];
  }
  return FIELDS.filter(
    ({ field }) => (before[field] ?? '') !== (slot.snapshot[field] ?? ''),
  ).map(({ field, label }) => ({
    field: label,
    before: displayValue(before[field]),
    after: displayValue(slot.snapshot[field]),
  }));
}

// A request's fields as the page shows them in full.
export function requestFields(
  snapshot: RequestSnapshot,
): { field: string; value: string }[] {
  return FIELDS.filter(({ field }) => snapshot[field]).map(
    ({ field, label }) => ({
      field: label,
      value: displayValue(snapshot[field]),
    }),
  );
}

// A template is canonical JSON; it reads better spread over lines.
function displayValue(value: string | null): string {
  if (value === null || value === '') {
    return '(none)';
  }
  try {
    let parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null
      ? JSON.stringify(parsed, null, 2)
      : String(parsed);
  } catch {
    return value;
  }
}

// Where a slot's key goes in its request, in words: "in the Authorization
// header", "in the body at auth.token".
export function placementPhrase(snapshot: RequestSnapshot): string {
  let name = snapshot.placementName;
  switch (snapshot.placement) {
    case 'header':
      return `in the ${headerName(name)} header`;
    case 'query':
      return `in the ${name} query parameter`;
    case 'path':
      return `in the path, as ${name}`;
    case 'body':
      return `in the body, at ${name}`;
    default:
      return `in the ${snapshot.placement}`;
  }
}

// A header name as it is usually written: `authorization` as `Authorization`.
function headerName(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-');
}

// The confirmation: every ticked operation, each slot filled with its chosen
// key or share and the fingerprint of the request shown.
export function approvalOf(
  batch: ApprovalBatch,
  choices: SlotChoice[],
  chosen: Record<string, string | undefined>,
  ticked: Set<string>,
): OperationApproval[] {
  return batch.groups.flatMap((group) =>
    group.operations
      .filter((o) => ticked.has(operationKey(o)))
      .map((o) => ({
        codeRef: { module: batch.card.module, name: batch.card.exportName },
        operation: o.name,
        ...(o.instance ? { instance: o.instance } : {}),
        expectedDestination: group.destination.href,
        slots: Object.fromEntries(
          o.slots.map((s) => {
            let kind = choices.find((c) => c.slot === s.slot)!.kind;
            let id = chosen[s.slot]!;
            return [
              s.slot,
              kind === 'userKey'
                ? { keyId: id, expectedFingerprint: s.fingerprint }
                : { shareId: id, expectedFingerprint: s.fingerprint },
            ];
          }),
        ),
      })),
  );
}

// Where approved requests may run: only in the card's scheduled pipelines, or
// also when a card is opened (in the browser, the AI assistant or the CLI).
export type ApprovalUse = 'pipelines' | 'interactive';

// What the user confirms, once for the batch, when they allow interactive
// use: one line for their own keys, and one for a workspace's share, whose
// approval reaches every reader of the realm.
export const INTERACTIVE_CONFIRMATION = {
  userKey:
    'Any card you open can make these calls as you and read what comes back.',
  apiKey:
    'Any card a reader of this realm opens, from any realm, can make these calls with this key and read the responses. Allow this only for a key whose responses aren’t private, and that the service limits to reading.',
} as const;

// The batch as the page shows it for `use`. An operation approved for
// pipelines only needs approving only for interactive use, so for pipelines
// it is left out.
export function batchFor(
  batch: ApprovalBatch,
  use: ApprovalUse,
): ApprovalBatch {
  if (use === 'interactive') {
    return batch;
  }
  return {
    ...batch,
    groups: batch.groups
      .map((group) => ({
        ...group,
        operations: group.operations.filter(
          (o) => o.status !== 'pipelines-only',
        ),
      }))
      .filter((group) => group.operations.length > 0),
  };
}

// Where the choice starts. Opened in the browser, it starts on interactive
// use, unless every slot that needs approving was last approved for
// pipelines only, so approving it again keeps that. Opened by `boxel keys
// approve`, it follows the CLI's own default: pipelines only, unless the CLI
// asked for interactive use, or the batch holds nothing to approve for
// pipelines (only operations approved for pipelines already), or every slot
// that needs approving was last approved for interactive use. Either way it
// is only where the choice starts: the confirmation says what interactive use
// allows before anything is approved.
export function initialUse(
  batch: ApprovalBatch,
  {
    cli = false,
    cliInteractive = false,
  }: { cli?: boolean; cliInteractive?: boolean } = {},
): ApprovalUse {
  let needed = allSlots(batchFor(batch, 'pipelines'));
  let lastApprovedFor = (interactive: boolean) =>
    needed.length > 0 &&
    needed.every(
      (s) => s.approved !== undefined && s.approved.interactive === interactive,
    );
  if (!cli) {
    return lastApprovedFor(false) ? 'pipelines' : 'interactive';
  }
  if (cliInteractive || needed.length === 0 || lastApprovedFor(true)) {
    return 'interactive';
  }
  return 'pipelines';
}

// Whether an operation was last approved for interactive use: approving it
// again for pipelines only stops it running when a card is opened.
export function approvedForOpenCards(operation: BatchOperation): boolean {
  return operation.slots.some((s) => s.approved?.interactive);
}

// Which cards the approval covers: only this card (every operation approved
// per instance), every card of its kind, or a mix of the two.
export function approvalScope(
  batch: ApprovalBatch | undefined,
): 'card' | 'kind' | 'mixed' {
  let operations = (batch?.groups ?? []).flatMap((g) => g.operations);
  let perCard = operations.filter((o) => o.instance !== null).length;
  if (perCard === 0) {
    return 'kind';
  }
  return perCard === operations.length ? 'card' : 'mixed';
}

// How many more requests need approving after these, for the choice made:
// those approved for pipelines only count only for interactive use.
export function remainingFor(batch: ApprovalBatch, use: ApprovalUse): number {
  return (
    batch.remaining +
    (use === 'interactive' ? (batch.remainingPipelinesOnly ?? 0) : 0)
  );
}

// Which confirmations the ticked operations need: one for the user's own keys
// and one for shares, each once whatever the number of operations.
export function confirmationsFor(
  operations: BatchOperation[],
): (keyof typeof INTERACTIVE_CONFIRMATION)[] {
  let kinds = new Set(operations.flatMap((o) => o.slots.map((s) => s.key)));
  return (['userKey', 'apiKey'] as const).filter((k) => kinds.has(k));
}

// The shares the ticked operations would approve for interactive use for the
// first time: each needs its daily budget named, starting from the one in
// force.
export function firstInteractiveShares(
  batch: ApprovalBatch,
  operations: BatchOperation[],
  chosen: Record<string, string | undefined>,
): { id: string; label: string; dailyBudget: number }[] {
  return chosenShares(batch, operations, chosen)
    .filter((share) => !share.interactive)
    .map(({ id, label, dailyBudget }) => ({ id, label, dailyBudget }));
}

// The shares the operations send, as chosen for their slots.
export function chosenShares(
  batch: ApprovalBatch,
  operations: BatchOperation[],
  chosen: Record<string, string | undefined>,
): ApprovalBatch['shares'] {
  let ids = new Set(
    operations.flatMap((o) =>
      o.slots
        .filter((s) => s.key === 'apiKey')
        .flatMap((s) => chosen[s.slot] ?? []),
    ),
  );
  return batch.shares.filter((share) => ids.has(share.id));
}

// Who besides signed-in people the operations serve once approved for
// interactive use, by the shares they send. Of the operations the realm's
// policy opens to people who aren't signed in (`openToAnonymous`), `anyone`
// are the shares whose keys allow them, and `signedInOnly` the ones whose keys
// don't, which such people are asked to sign in for. Both are empty where the policy opens none of them.
export function sharesForVisitors(
  batch: ApprovalBatch,
  operations: BatchOperation[],
  chosen: Record<string, string | undefined>,
): { anyone: ApprovalBatch['shares']; signedInOnly: ApprovalBatch['shares'] } {
  let open = operations.filter((o) => o.openToAnonymous);
  if (open.length === 0) {
    return { anyone: [], signedInOnly: [] };
  }
  let shares = chosenShares(batch, open, chosen);
  return {
    anyone: shares.filter((share) => share.anonymous),
    signedInOnly: shares.filter((share) => !share.anonymous),
  };
}

// What the user confirms besides `INTERACTIVE_CONFIRMATION` when the shares
// they approve serve people who aren't signed in, with each key's anonymous
// caps.
export function anonymousConfirmation(
  shares: ({ label: string } & AnonymousCaps)[],
): string {
  let capped = shares.flatMap((share) => {
    let caps = anonymousCapsPhrase(share, { short: true });
    return caps ? [{ label: share.label, caps }] : [];
  });
  let caps =
    capped.length === 0
      ? ''
      : shares.length === 1
        ? anonymousCapsClause(shares[0])
        : `, up to each key’s anonymous caps (${capped.map((s) => `${s.label}: ${s.caps}`).join(', ')})`;
  return `Anyone on the internet who opens this card, including people who aren’t signed in, can make these calls with ${shares.length === 1 ? 'this key' : 'these keys'}${caps}.`;
}

// A daily budget as typed: a whole number of calls, at least one.
export function parseDailyBudget(
  value: string | undefined,
): number | undefined {
  let trimmed = (value ?? '').trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  let budget = Number(trimmed);
  return budget >= 1 && budget <= 2_147_483_647 ? budget : undefined;
}
