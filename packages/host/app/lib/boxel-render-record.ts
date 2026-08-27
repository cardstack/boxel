import type {
  BoxelDescription,
  InstanceProjection,
  ResolvedField,
} from '@cardstack/runtime-common/boxel-execution-protocol';
import { BOXEL_EXECUTION_PROTOCOL_VERSION } from '@cardstack/runtime-common/boxel-execution-protocol';
import {
  newNormalizationBudget,
  normalizeJsonData,
} from '@cardstack/runtime-common/boxel-execution-protocol/untrusted-input';

import type {
  CapturedBoxelInstance,
  CapturedBoxelType,
} from './boxel-projection';

/**
 * The second half of the projection pipeline: the pure assembler that turns a
 * capture into the protocol's records.
 *
 * Nothing here reads a live object. Its whole input is what
 * `boxel-projection.ts` already captured, which is what makes it checkable:
 * given one capture, the records are a function of that capture alone, so two
 * runs cannot differ and two tiers handed the same capture cannot disagree.
 *
 * The assembly is where two guarantees are actually established, rather than
 * being left to each caller to remember:
 *
 * 1. **The envelope.** Every record that crosses on its own carries the
 *    protocol version and the features it requires (RP-14.3). Stamping it in
 *    one place is what makes "which version did this tier produce" a property
 *    of the pipeline rather than of the call site.
 * 2. **Inertness.** Each record is rebuilt through the protocol's own
 *    normalizer, so what comes out is a fresh plain graph of already-read
 *    values — never the captured object, never a `Box`-resolved path left
 *    behind as a getter, never a class instance. That is the rule the boundary
 *    enforces (`normalizeJsonData` refuses an accessor, a prototype of its own,
 *    a symbol-keyed member, a function, and a value containing itself), and a
 *    producer that holds it locally fails at the point of production — where
 *    the offending member's origin is still in the stack — instead of at the
 *    far side of a message port, where the diagnostic names only a path.
 *
 * The normalization is a second walk over a graph the capture just built, and
 * it is worth it for the same reason the gate on the consuming side is: an
 * inertness bug is invisible until something clones, and by then the record is
 * somewhere no one can see where it came from.
 */

/**
 * One instance's rendering inputs: the three things a tier answers with,
 * assembled together so they cannot disagree.
 *
 * Not itself a crossing record, and deliberately carries no envelope of its
 * own. Each member crosses on its own as an operation's result — `description`
 * from `describeBoxel`, `projection` from `projectInstance`, `fields` from
 * `getFields` — and the two enveloped ones carry their version with them
 * (RP-14.3), while `ResolvedField` is versioned by the response carrying it
 * (RP-14.1).
 */
export interface BoxelRenderRecord {
  description: BoxelDescription;
  projection: InstanceProjection;
  fields: ResolvedField[];
}

export interface BuildBoxelRenderRecordInput {
  type: CapturedBoxelType;
  instance: CapturedBoxelInstance;
  fields: ResolvedField[];
  /**
   * Orders this runtime's projections of one instance against each other
   * (RP-14.1), so a recipient can drop one a newer projection has already
   * superseded in flight. It is not an etag and carries no server meaning —
   * main's write path has no revision token (RP-9.6).
   */
  revision: number;
}

/**
 * Assembles every record one instance answers with.
 *
 * The entry point for a caller that wants all three at once. Nothing on a
 * render path does yet — each operation asks for the one record it answers
 * with, which is why `describeBoxel`, `getFields` and `projectInstance` each
 * call the builder for theirs — so today this composes them for the suite that
 * holds the three to one input.
 *
 * It is one builder per record either way: a caller assembling a description
 * here and a projection somewhere else would have two, which is the shape this
 * file exists to make unnecessary.
 */
export function buildBoxelRenderRecord(
  input: BuildBoxelRenderRecordInput,
): BoxelRenderRecord {
  return {
    description: buildBoxelDescription(input.type),
    projection: buildInstanceProjection(input.instance, input.revision),
    fields: buildResolvedFields(input.fields),
  };
}

/** The type's description, enveloped and inert (RP-14.1). */
export function buildBoxelDescription(
  type: CapturedBoxelType,
): BoxelDescription {
  return asRecord({
    protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
    // Version 1 defines no optional features, so every v1 producer emits an
    // empty list. The member is present rather than omitted because a consumer
    // reads it before it reads anything else (RP-14.3), and an absent list is
    // a malformed envelope rather than an empty one.
    requiredFeatures: [],
    ref: type.ref,
    boxelKind: type.boxelKind,
    ancestors: type.ancestors,
    fields: type.fields,
    formats: type.formats,
    presentation: type.presentation,
    executionHints: type.executionHints,
  });
}

/** The instance's projection, enveloped and inert (RP-14.1). */
export function buildInstanceProjection(
  instance: CapturedBoxelInstance,
  revision: number,
): InstanceProjection {
  return asRecord({
    protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
    requiredFeatures: [],
    id: instance.id,
    type: instance.type,
    revision,
    model: instance.model,
    presentation: instance.presentation,
  });
}

/**
 * The instance's fields, inert.
 *
 * Enveloped by the response that carries them rather than individually
 * (RP-14.1), so this stamps no version — but it holds the same inertness rule,
 * because a resolved configuration is the one member of a field whose shape
 * the author controls.
 */
export function buildResolvedFields(fields: ResolvedField[]): ResolvedField[] {
  return asRecord(fields);
}

/**
 * Rebuilds `value` as inert data.
 *
 * The cast is the one place this file rests on something the type system does
 * not prove, and it is narrow: `normalizeJsonData` preserves the shape of
 * anything it accepts, member for member and element for element, so the
 * result differs from its input only in the ways the input was not data — and
 * in those cases it throws rather than returning a different shape.
 *
 * Each record gets its own budget, so the protocol's per-record value ceiling
 * is per record here as it is at the boundary, rather than being spent across
 * the three records one call assembles.
 */
function asRecord<T>(value: T): T {
  return normalizeJsonData(value, newNormalizationBudget()) as T;
}
