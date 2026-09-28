import type { BxlTransformContext } from '@cardstack/bxl/transform';
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
import type { BxlTransformModule } from './transforms.ts';
import type { BxlPolicyParser } from './policy.ts';
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

// The same guard for the transform surface. `transforms.ts` states BXL's
// transform entry structurally for the same reason `executors.ts` states the
// mutation one — it says why — and the two halves of the restatement that
// would fail silently are the request-context slot names and the error's
// `phase`, since a slot spelled differently reaches a program as "the host
// supplied none" and a phase spelled differently maps a refusal to the wrong
// status rather than to nothing at all.
export type BxlTransformEntryReachesLocal = Assignable<
  BxlTransformModule,
  typeof import('@cardstack/bxl/transform')
>;

export type LocalTransformContextReachesBxl = Assignable<
  BxlTransformContext,
  LocalTransformProgramContext
>;
export type BxlTransformContextReachesLocal = Assignable<
  LocalTransformProgramContext,
  BxlTransformContext
>;

// The slot NAMES, held separately from their types, because the pair above
// cannot see a rename: every slot is optional, so one side gaining a key and
// losing another is assignable in both directions. A retyped slot the pair
// catches; a renamed one only this does — and a renamed one is the drift that
// fails silently, since a slot the host fills under a name the builtin does
// not read reaches the program as "the host supplied none".
export type LocalTransformSlotsReachBxl = Assignable<
  Record<keyof BxlTransformContext, unknown>,
  Record<keyof LocalTransformProgramContext, unknown>
>;
export type BxlTransformSlotsReachLocal = Assignable<
  Record<keyof LocalTransformProgramContext, unknown>,
  Record<keyof BxlTransformContext, unknown>
>;

// The context shape as `transforms.ts` hands it over, named here because the
// runner builds it inline rather than exporting a type for it.
type LocalTransformProgramContext = NonNullable<
  Parameters<BxlTransformModule['runBxlTransform']>[2]
>;

// The same guard for the policy compiler. `policy.ts` states the two calls it
// makes structurally, the parse and the profile check a query grant's filter
// passes, and a profile issue whose `code` or `message` changed shape would
// change which predicates it refuses without anything failing to compile.
export type BxlPolicyParserReachesLocal = Assignable<
  BxlPolicyParser,
  typeof import('@cardstack/bxl')
>;
