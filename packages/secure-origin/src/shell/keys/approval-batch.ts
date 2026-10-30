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
    let options: SlotOption[] =
      kind === 'userKey'
        ? batch.keys.map(({ id, name, covers, state }) => ({
            id,
            name,
            covers,
            ...(state === 'rejected' ? { rejected: true } : {}),
          }))
        : batch.shares.map(({ id, label, keyName, covers }) => ({
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
