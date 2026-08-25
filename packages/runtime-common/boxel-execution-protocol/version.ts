/**
 * The envelope every crossing record carries, and the gate a consumer passes
 * before it reads any of one.
 *
 * Part of the cross-boundary execution protocol (RP-14); see
 * `../boxel-execution-protocol.ts` for the properties every file here holds.
 */

import type { Cloneable } from './cloneable.ts';
import {
  ProtocolRefusal,
  describeValue,
  joinTokens,
  newOffenderList,
  recordOffender,
} from './refusal.ts';
import {
  asRefusal,
  newNormalizationBudget,
  normalizeStringArray,
  readMember,
} from './untrusted-input.ts';
import type { NormalizationBudget } from './untrusted-input.ts';

// The semantic version: the meaning of the records below — what a
// description, a projection, or a template bundle says about a card.
export const BOXEL_EXECUTION_PROTOCOL_VERSION = 1;

// The transport version: the envelope shape of messages on the Sandbox
// tier's private channel. Deliberately a separate number, because the wire
// format and the card semantics it carries change for unrelated reasons and
// on unrelated schedules (RP-14.3). Both are enforced.
export const BOXEL_EXECUTION_TRANSPORT_VERSION = 1;

/**
 * Optional semantics a producer may depend on and a consumer may lack. A
 * record names the ones it needs in `requiredFeatures`; a consumer that does
 * not recognize one of them rejects the entire record.
 *
 * Version 1 defines none: every v1 producer emits an empty list. The
 * mechanism exists ahead of its first feature because the alternative —
 * introducing it with the feature — leaves every already-deployed consumer
 * unable to recognize that it is missing something.
 *
 * There is no central registry of supported features, by design. Support is a
 * property of a consumer, not of the protocol, so each consumer passes the
 * set it implements (see `ProtocolSupport`).
 */
export type ProtocolEnvelope = Cloneable<{
  protocolVersion: number;
  requiredFeatures: string[];
}>;

/**
 * What one consumer can honor. Consumers differ; the protocol does not.
 *
 * The one shape here that is not a record: support is a fact about the local
 * endpoint, so it never crosses a boundary and carries a `Set` rather than
 * the JSON a record is limited to.
 */
export interface ProtocolSupport {
  protocolVersion: number;
  features: ReadonlySet<string>;
}

/**
 * The gate every consumer of a versioned record passes before it reads any
 * member of that record (RP-14.3).
 *
 * Rejection is atomic by construction: this throws, so a caller that gates
 * first has applied nothing and its previous output still stands. Unknown
 * features are collected and reported together rather than one per call, so
 * the single diagnostic a fail-closed consumer emits names everything it
 * could not honor.
 */
export function assertUsableExecutionRecord(
  record: ProtocolEnvelope,
  support: ProtocolSupport,
  budget: NormalizationBudget = newNormalizationBudget(),
): ProtocolEnvelope {
  return asRefusal(() => gateEnvelope(record, support, budget));
}

function gateEnvelope(
  record: ProtocolEnvelope,
  support: ProtocolSupport,
  budget: NormalizationBudget,
): ProtocolEnvelope {
  // Read once, up front: the envelope is the whole basis of the decision, and
  // reading it exactly once is what makes that checkable.
  let { protocolVersion, requiredFeatures } = readEnvelope(record, budget);
  if (protocolVersion !== support.protocolVersion) {
    throw new ProtocolRefusal(
      'BOXEL_PROTOCOL_VERSION_UNSUPPORTED',
      `record declares protocol version ${protocolVersion}; this consumer implements ${support.protocolVersion}`,
    );
  }
  // Collected into a bounded list rather than filtered into a full one. The
  // feature array itself is charged against the record's budget, so this is no
  // longer where a producer buys unbounded work — but a filter builds one
  // string per unrecognized feature, each through `JSON.stringify`, to render
  // ten of them, and the count a diagnostic reports has to be the count the
  // producer sent rather than the count it printed.
  let unsupported = newOffenderList();
  for (let feature of requiredFeatures) {
    if (!support.features.has(feature)) {
      recordOffender(unsupported, describeValue(feature));
    }
  }
  if (unsupported.total > 0) {
    throw new ProtocolRefusal(
      'BOXEL_PROTOCOL_FEATURE_UNSUPPORTED',
      `record requires features this consumer does not implement: ${joinTokens(
        unsupported,
      )}`,
    );
  }
  return { protocolVersion, requiredFeatures };
}

/**
 * The envelope, read as untrusted input rather than as the type it claims.
 *
 * A record's producer is on the far side of a trust boundary, so the record's
 * own shape is the first thing in doubt. Every refusal here has to be a
 * `ProtocolRefusal` for the same reason the version and feature refusals do:
 * a consumer catches that one type, and a `TypeError` from an absent or
 * mistyped member would escape it unhandled — discarding the last-known-good
 * output the refusal exists to protect, and skipping the one diagnostic
 * RP-14.3 asks for.
 */
function readEnvelope(
  record: ProtocolEnvelope,
  budget: NormalizationBudget,
): {
  protocolVersion: number;
  requiredFeatures: string[];
} {
  let candidate: unknown = record;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `expected a record object, received ${describeValue(candidate)}`,
    );
  }
  let protocolVersion = readMember(candidate, 'protocolVersion');
  let requiredFeatures = readMember(candidate, 'requiredFeatures');
  if (
    typeof protocolVersion !== 'number' ||
    !Number.isFinite(protocolVersion)
  ) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `protocolVersion must be a finite number, received ${describeValue(protocolVersion)}`,
    );
  }
  // Index-by-index rather than `some`/`every`, which skip the holes in a
  // sparse array — `[, ,]` would otherwise pass as "an array of strings" and
  // be carried as two features named `undefined`.
  return {
    protocolVersion,
    requiredFeatures: normalizeStringArray(
      requiredFeatures,
      'requiredFeatures',
      budget,
    ),
  };
}

/**
 * The transport counterpart, checked on a message envelope before its payload
 * is dispatched to a lane.
 *
 * The supported version is the constant, not a parameter: one build carries
 * one transport implementation, so a caller-supplied "supported" value could
 * only ever weaken the gate.
 */
export function assertExecutionTransportVersion(
  transportVersion: number,
): void {
  if (transportVersion !== BOXEL_EXECUTION_TRANSPORT_VERSION) {
    throw new ProtocolRefusal(
      'BOXEL_TRANSPORT_VERSION_UNSUPPORTED',
      `message declares transport version ${describeValue(
        transportVersion,
      )}; this endpoint implements ${BOXEL_EXECUTION_TRANSPORT_VERSION}`,
    );
  }
}
