import type {
  BxlBoxelSourceDefinition,
  BxlMutationOverlayReason,
  BxlMutationOverlayTier,
  BxlMutationReadEvent,
  BxlMutationUnavailableOverlay,
} from '@cardstack/bxl/mutation';

import type {
  OverlayTier,
  ProgramReadEvent,
  UnavailableOverlay,
} from './executors.ts';
import type { OperationMissingReason } from './telemetry.ts';
import type { DefinitionKind } from '../definitions.ts';

// `BxlBoxelSourceDefinition` is a loaderless mirror of `Definition`, and it is
// kept in step by hand: no call site hands a `Definition` to the mutation
// planner, so nothing would notice the two drifting apart until the first one
// tried. This record is what notices. `Record<DefinitionKind, …>` fails to
// compile when the definition cache learns a family the mirror has no legal
// value for, which is the direction that strands a caller.
//
// It lives here rather than in `definitions.ts` because reaching for a bxl type
// pulls bxl's sources into the typecheck program of whatever imports it, and
// lowering is the one entry that already pays that. Nothing imports this file:
// the package's own typecheck covers every file under it, which is exactly the
// reach this guard wants.
export const bxlMirroredDefinitionKinds = {
  'card-def': 'card-def',
  'field-def': 'field-def',
  'file-def': 'file-def',
} satisfies Record<
  DefinitionKind,
  NonNullable<BxlBoxelSourceDefinition['type']>
>;

// `executors.ts` states BXL's mutation surface structurally instead of
// importing it, so that reaching an executor does not pull bxl's sources into
// a consumer's typecheck — `executors.ts` says why. Stating a shape twice is
// how the two drift, so the vocabulary the host and the planner have to agree
// on word-for-word is held here: a tier or a reason the two spell differently
// makes every marker of that kind silently inert, and a read event shape that
// drifts makes the telemetry count the wrong layer.
//
// Checked in both directions, because either way round is a defect: a value
// bxl accepts that this module cannot produce is as broken as one this module
// produces that bxl will not take. One alias per direction — a single
// two-sided constraint is circular by construction.
type Assignable<To, From extends To> = From;

export type LocalTierReachesBxl = Assignable<
  BxlMutationOverlayTier,
  OverlayTier
>;
export type BxlTierReachesLocal = Assignable<
  OverlayTier,
  BxlMutationOverlayTier
>;

export type LocalReasonReachesBxl = Assignable<
  BxlMutationOverlayReason,
  OperationMissingReason
>;
export type BxlReasonReachesLocal = Assignable<
  OperationMissingReason,
  BxlMutationOverlayReason
>;

export type LocalMarkerReachesBxl = Assignable<
  BxlMutationUnavailableOverlay,
  UnavailableOverlay
>;
export type BxlMarkerReachesLocal = Assignable<
  UnavailableOverlay,
  BxlMutationUnavailableOverlay
>;

export type LocalReadEventReachesBxl = Assignable<
  BxlMutationReadEvent,
  ProgramReadEvent
>;
export type BxlReadEventReachesLocal = Assignable<
  ProgramReadEvent,
  BxlMutationReadEvent
>;
