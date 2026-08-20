import ScaleIcon from '@cardstack/boxel-icons/scale';

import { statusField, type StatusOption } from './status-field';

/**
 * The contract lifecycle, as a status field that knows its own legal moves.
 *
 * This is a CONFIGURATION of the shared `statusField` factory
 * (status-field.gts), not a new status implementation. The factory already
 * supplies the constrained dropdown, the StatePill rendering for atom and
 * embedded, and the transition graph. All this module contributes is one
 * domain's vocabulary.
 *
 * WHY THESE EXACT SPELLINGS. `contract.gts` previously declared its status
 * with base `enumField` over five values — draft, out for signature, signed,
 * expired, terminated — with no transitions map, so nothing stopped a draft
 * being marked signed without ever having been reviewed. This closes that gap
 * WITHOUT renaming a single existing value: all five are carried over
 * byte-for-byte, spaces and all, and the three missing lifecycle stages are
 * added around them. Every Contract instance already on the realm keeps
 * deserializing, and no migration is needed.
 *
 * The spaces are safe here because the factory colours through `StatePill`'s
 * `@hue` argument rather than interpolating the value into a class name — the
 * usual reason enum values avoid spaces does not apply.
 */

export const CONTRACT_STATUSES: StatusOption[] = [
  {
    value: 'draft',
    label: 'Draft',
    hue: 'slate',
    meaning: 'Being written. Nothing has been shown to the counterparty yet.',
  },
  {
    value: 'negotiating',
    label: 'Negotiating',
    hue: 'purple',
    meaning: 'With the counterparty. Terms are still moving.',
  },
  {
    value: 'in review',
    label: 'In review',
    hue: 'purple',
    meaning: 'Legal is checking it for risk and non-standard language.',
  },
  {
    value: 'approved',
    label: 'Approved',
    hue: 'teal',
    meaning: 'Every internal approver has signed off. Not yet binding.',
  },
  {
    value: 'out for signature',
    label: 'Out for signature',
    hue: 'teal',
    meaning: 'Sent to the signatories. Waiting on someone outside this app.',
  },
  {
    value: 'signed',
    label: 'Signed & in force',
    hue: 'blue',
    meaning: 'Executed and binding. Its obligations are live and owned.',
  },
  {
    value: 'expired',
    label: 'Expired',
    hue: 'slate',
    meaning: 'The term ran out. Renewable, but nothing is in force today.',
  },
  {
    value: 'terminated',
    label: 'Terminated',
    hue: 'red',
    terminal: true,
    meaning: 'Ended early and deliberately. Does not come back.',
  },
];

/**
 * Ordered lifecycle, for anything that needs the shape rather than the set —
 * board columns, a progress rail, the flow diagram. Terminal and post-term
 * states are excluded: they are outcomes, not stages.
 */
export const CONTRACT_PIPELINE = [
  'draft',
  'negotiating',
  'in review',
  'approved',
  'out for signature',
  'signed',
];

/**
 * value → what may legally follow it.
 *
 * Two rules worth naming, because they are what a free-text dropdown gets
 * wrong. Every non-terminal state can reach `terminated`, because a deal can
 * always collapse. And backward moves are legal but narrow: review can send a
 * contract back to negotiation, signature can fall back to negotiation — but
 * nothing returns to `draft` once the counterparty has seen it, because the
 * document is no longer ours alone.
 */
export const CONTRACT_TRANSITIONS: Record<string, string[]> = {
  draft: ['negotiating', 'in review', 'terminated'],
  negotiating: ['in review', 'terminated'],
  'in review': ['approved', 'negotiating', 'terminated'],
  approved: ['out for signature', 'in review', 'terminated'],
  'out for signature': ['signed', 'negotiating', 'terminated'],
  signed: ['expired', 'terminated'],
  // Renewal is a real path back into force — an expired contract both parties
  // want again does not need a new record, it needs a new term.
  expired: ['signed', 'terminated'],
  terminated: [],
};

export const ContractStatusField = statusField({
  options: CONTRACT_STATUSES,
  transitions: CONTRACT_TRANSITIONS,
  displayName: 'Contract Status',
  icon: ScaleIcon,
});

export function contractStatusOption(
  value?: string | null,
): StatusOption | undefined {
  return CONTRACT_STATUSES.find((o) => o.value === value);
}

export function contractStatusLabel(value?: string | null): string {
  return contractStatusOption(value)?.label ?? value ?? '—';
}

/** True once the contract is binding — the state obligations depend on. */
export function isInForce(value?: string | null): boolean {
  return value === 'signed';
}

/**
 * How far along the pipeline a contract is, 0–1.
 *
 * Terminal and post-term states are not points on the pipeline, so they get an
 * explicit answer rather than falling through to 0: terminated is 0 because
 * nothing was achieved, expired is 1 because the contract ran its full course.
 */
export function contractProgress(value?: string | null): number {
  if (value === 'terminated') return 0;
  if (value === 'expired') return 1;
  let i = CONTRACT_PIPELINE.indexOf(value ?? '');
  return i === -1 ? 0 : (i + 1) / CONTRACT_PIPELINE.length;
}

export default ContractStatusField;
