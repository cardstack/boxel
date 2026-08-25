/**
 * Holding every tier to one set of records (RP-14.4).
 *
 * Part of the cross-boundary execution conformance harness; see
 * `../boxel-execution-conformance.ts` for what the harness is and what it is
 * not.
 *
 * RP-14.4 is a claim about agreement, and the project's own case for it is
 * that the tiers "conform to the same spec, so they are at parity by
 * construction". This is what turns that from an assertion into a check. It
 * runs over whatever tiers were handed to it, so the Direct↔Capsule half
 * stands up the moment a second adapter exists rather than waiting for a
 * third — and it says, in every report it produces, how much it actually
 * compared, because a harness with one tier has nothing to diff and a green
 * result that does not admit that is worse than no harness at all.
 */

import type { ProtocolRefusalCode } from '../boxel-execution-protocol/refusal.ts';
import { isProtocolRefusal } from '../boxel-execution-protocol/refusal.ts';
import type { BoxelExecutionMode } from '../boxel-execution-protocol/runtime.ts';
import { BOXEL_EXECUTION_MODES } from '../boxel-execution-protocol/runtime.ts';
import type {
  ProtocolEnvelope,
  ProtocolSupport,
} from '../boxel-execution-protocol/version.ts';
import {
  BOXEL_EXECUTION_PROTOCOL_VERSION,
  assertUsableExecutionRecord,
} from '../boxel-execution-protocol/version.ts';
import type { RecordDivergence } from './record-diff.ts';
import { diffRecords, faultInRecord } from './record-diff.ts';

/**
 * The records RP-14.4 requires every tier to agree on.
 *
 * Both are enveloped records a tier produces from an input it was given, which
 * is what makes them comparable across tiers. A `TemplateBundle` is not here:
 * only Capsule produces one, so there is nothing to hold it against.
 */
export const PARITY_RECORD_KINDS = ['description', 'projection'] as const;

export type ParityRecordKind = (typeof PARITY_RECORD_KINDS)[number];

/**
 * The tier every other tier is compared against.
 *
 * Direct is the reference implementation: where the spec is silent, main's
 * Direct behavior is the contract (RP-0.5). So a divergence is always reported
 * as the candidate's, and a run with no Direct tier is a fault rather than a
 * comparison between two candidates.
 */
export const PARITY_REFERENCE_MODE: BoxelExecutionMode = 'direct';

/**
 * Record paths the spec declares tier-specific, and therefore does not
 * compare.
 *
 * Empty, which makes the diff total. An entry is a statement that a member
 * legitimately differs between tiers, and that is a spec change: it needs the
 * statement declaring it, in the change that adds the path. The list exists
 * rather than being left out so RP-14.4's "modulo" clause has somewhere to
 * live, and so a test can hold it to whatever the spec declares.
 */
export const TIER_SPECIFIC_RECORD_PATHS: readonly string[] = [];

/**
 * One tier's answers for one input.
 *
 * Typed `unknown` rather than `BoxelDescription` / `InstanceProjection` on
 * purpose: whether a tier produced a well-formed record is the question, and a
 * parameter typed as the answer cannot ask it.
 */
export interface TierRecords {
  mode: BoxelExecutionMode;
  description: unknown;
  projection: unknown;
}

export type ParityFinding =
  /** No tier answered for the reference mode, so nothing can be held to it. */
  | { kind: 'reference-missing'; mode: BoxelExecutionMode }
  /** Two tiers claimed one mode; whichever lost the tie went unchecked. */
  | { kind: 'mode-repeated'; mode: BoxelExecutionMode }
  /** A tier answered that the registry does not know about. */
  | { kind: 'mode-unregistered'; mode: BoxelExecutionMode }
  /** The registry names a tier that produced nothing to check. */
  | { kind: 'mode-absent'; mode: BoxelExecutionMode }
  /**
   * A tier's record is not one this protocol can use, so it is not compared.
   *
   * Two questions collapse into one finding because they have one consequence.
   * The record may not be inert data — an accessor, a function, a prototype of
   * its own, a value containing itself. Or it may be data and still not a
   * record of this protocol: `{}` carries no envelope, and a record declaring
   * a version the comparing consumer does not implement is refused by RP-14.3's
   * own gate. Either way there is nothing to hold a peer to.
   */
  | {
      kind: 'fault';
      mode: BoxelExecutionMode;
      record: ParityRecordKind;
      code: ProtocolRefusalCode;
      message: string;
    }
  /** A tier's record differs from the reference tier's. */
  | {
      kind: 'divergence';
      mode: BoxelExecutionMode;
      record: ParityRecordKind;
      divergence: RecordDivergence;
    }
  /** Divergences past the diff's report limit, counted but not listed. */
  | {
      kind: 'withheld';
      mode: BoxelExecutionMode;
      record: ParityRecordKind;
      count: number;
    }
  /**
   * Two tiers were handed the same object, so the comparison compared a record
   * with itself. Nothing a real pair of tiers can do — the caller wired one
   * tier's output in twice, and every comparison after it agrees for free.
   */
  | {
      kind: 'records-shared';
      mode: BoxelExecutionMode;
      record: ParityRecordKind;
    };

export interface ParityReport {
  /** What the tiers were given, so a finding can be reproduced. */
  fixture: string;
  referenceMode: BoxelExecutionMode;
  /** The non-reference tiers that were compared, in tier order. */
  comparedModes: BoxelExecutionMode[];
  /**
   * Record pairs actually diffed against the reference. A pair where either
   * side is not a usable record is not counted, because it was not compared.
   */
  comparisons: number;
  /** Records read as inert data, the reference tier's included. */
  inspections: number;
  findings: ParityFinding[];
}

export interface ParityInput {
  fixture: string;
  tiers: readonly TierRecords[];
  /**
   * The modes the caller expects to be answering. A tier missing from this
   * list, or named by it and missing from `tiers`, is a finding — the harness
   * cannot tell "this tier agrees" from "this tier never ran", and only the
   * caller knows which was meant.
   */
  registeredModes: readonly BoxelExecutionMode[];
  /** Defaults to `TIER_SPECIFIC_RECORD_PATHS`. */
  exemptPaths?: readonly string[];
  /**
   * What the comparing consumer implements. Defaults to this module's own
   * protocol version and no optional features, which is what a conformance run
   * of the current protocol wants.
   */
  support?: ProtocolSupport;
}

/**
 * Checks every tier's records against the reference tier's.
 *
 * With one tier there is nothing to diff, and the check that remains is still
 * a real one: every record is read as inert data by the same rule the boundary
 * uses, so a tier answering with a live object fails here whether or not it
 * has a peer to disagree with.
 */
export function checkRecordParity(input: ParityInput): ParityReport {
  let { fixture, tiers, registeredModes } = input;
  let exemptPaths = input.exemptPaths ?? TIER_SPECIFIC_RECORD_PATHS;
  let support = input.support ?? {
    protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
    features: new Set<string>(),
  };
  let findings: ParityFinding[] = [];
  let byMode = new Map<BoxelExecutionMode, TierRecords>();
  for (let tier of tiers) {
    if (byMode.has(tier.mode)) {
      findings.push({ kind: 'mode-repeated', mode: tier.mode });
      continue;
    }
    byMode.set(tier.mode, tier);
  }
  let registered = new Set(registeredModes);
  // Every mode anyone named, not only the ones the protocol declares. A tier's
  // mode is data — a Sandbox child's arrives across the boundary this module
  // exists to distrust — so iterating the declared list alone lets a typo'd or
  // forged mode go uninspected, uncompared and unreported while the run says
  // it found nothing.
  let modes = modesInPlay(byMode, registered);

  for (let mode of modes) {
    if (byMode.has(mode) && !registered.has(mode)) {
      findings.push({ kind: 'mode-unregistered', mode });
    }
    if (registered.has(mode) && !byMode.has(mode)) {
      findings.push({ kind: 'mode-absent', mode });
    }
  }

  let inspections = 0;
  let unusable = new Set<string>();
  for (let mode of modes) {
    let tier = byMode.get(mode);
    if (tier === undefined) {
      continue;
    }
    for (let record of PARITY_RECORD_KINDS) {
      inspections += 1;
      let fault = faultInParityRecord(tier[record], support);
      if (fault !== undefined) {
        unusable.add(`${mode}/${record}`);
        findings.push({ kind: 'fault', mode, record, ...fault });
      }
    }
  }

  let reference = byMode.get(PARITY_REFERENCE_MODE);
  if (reference === undefined) {
    findings.push({ kind: 'reference-missing', mode: PARITY_REFERENCE_MODE });
    return {
      fixture,
      referenceMode: PARITY_REFERENCE_MODE,
      comparedModes: [],
      comparisons: 0,
      inspections,
      findings,
    };
  }

  let comparedModes: BoxelExecutionMode[] = [];
  let comparisons = 0;
  for (let mode of modes) {
    let candidate = byMode.get(mode);
    if (candidate === undefined || mode === PARITY_REFERENCE_MODE) {
      continue;
    }
    comparedModes.push(mode);
    for (let record of PARITY_RECORD_KINDS) {
      if (isSameObject(reference[record], candidate[record])) {
        findings.push({ kind: 'records-shared', mode, record });
      }
      // A record this protocol cannot use is not compared, and the fault above
      // already says why. Comparing it anyway would report divergences beneath
      // a record the run has just declared unusable, and count the pair as
      // checked.
      if (
        unusable.has(`${PARITY_REFERENCE_MODE}/${record}`) ||
        unusable.has(`${mode}/${record}`)
      ) {
        continue;
      }
      comparisons += 1;
      let diff = diffRecords(reference[record], candidate[record], {
        exemptPaths,
      });
      for (let divergence of diff.divergences) {
        findings.push({ kind: 'divergence', mode, record, divergence });
      }
      if (diff.withheld > 0) {
        findings.push({
          kind: 'withheld',
          mode,
          record,
          count: diff.withheld,
        });
      }
    }
  }

  return {
    fixture,
    referenceMode: PARITY_REFERENCE_MODE,
    comparedModes,
    comparisons,
    inspections,
    findings,
  };
}

/**
 * Every mode named by a tier or by the registry, the protocol's own order
 * first and anything else after it, so one report does not depend on the order
 * a caller listed its tiers in.
 */
function modesInPlay(
  byMode: Map<BoxelExecutionMode, TierRecords>,
  registered: Set<BoxelExecutionMode>,
): BoxelExecutionMode[] {
  let declared = new Set<string>(BOXEL_EXECUTION_MODES);
  let named = [...new Set([...byMode.keys(), ...registered])];
  return [
    ...BOXEL_EXECUTION_MODES.filter(
      (mode) => byMode.has(mode) || registered.has(mode),
    ),
    ...named.filter((mode) => !declared.has(mode)).sort(),
  ];
}

/**
 * Why a value is not a usable record of this protocol, or `undefined` when it
 * is.
 *
 * Two questions, because a value can pass one and fail the other. `{}` is
 * inert data and a record, and it is not a `BoxelDescription` — it carries no
 * envelope, so RP-14.3's gate refuses it. Without the second question two
 * tiers that each produced `{}` agree at every path, which is the same false
 * green as two tiers that each produced `null`.
 */
function faultInParityRecord(
  value: unknown,
  support: ProtocolSupport,
): { code: ProtocolRefusalCode; message: string } | undefined {
  let fault = faultInRecord(value);
  if (fault !== undefined) {
    return fault;
  }
  try {
    assertUsableExecutionRecord(value as ProtocolEnvelope, support);
    return undefined;
  } catch (error) {
    // `assertUsableExecutionRecord` wraps whatever it meets in a refusal; the
    // check is what narrows the caught value to one carrying a code.
    if (!isProtocolRefusal(error)) {
      throw error;
    }
    return { code: error.code, message: error.message };
  }
}

/**
 * Whether two tiers were handed the very same object. No pair of real tiers
 * can be — each builds its own record — so this is a caller that wired one
 * tier's output in twice, and every comparison of it agrees for free.
 */
function isSameObject(reference: unknown, candidate: unknown): boolean {
  return (
    typeof reference === 'object' &&
    reference !== null &&
    reference === candidate
  );
}

/** Whether a report found nothing. */
export function reportsParity(report: ParityReport): boolean {
  return report.findings.length === 0;
}

/**
 * Renders a report as the message an assertion carries, passing or failing.
 *
 * The coverage line is there in both cases and on purpose. A report saying
 * only "no findings" reads as "the tiers agree" when it may mean "there was
 * one tier"; the two have to be distinguishable in a CI log without reading
 * the harness.
 */
export function describeParityReport(report: ParityReport): string {
  let against =
    report.comparedModes.length === 0
      ? 'no other tier'
      : report.comparedModes.join(', ');
  let coverage =
    `${report.fixture}: ${report.referenceMode} vs ${against} — ` +
    `${report.comparisons} record comparison(s), ` +
    `${report.inspections} record(s) read as data`;
  if (report.findings.length === 0) {
    return `${coverage}; no findings`;
  }
  return [coverage, ...report.findings.map(describeFinding)].join('\n');
}

function describeFinding(finding: ParityFinding): string {
  switch (finding.kind) {
    case 'reference-missing':
      return `no ${finding.mode} tier answered, so nothing was held to the reference`;
    case 'mode-repeated':
      return `two tiers claimed the ${finding.mode} mode`;
    case 'mode-unregistered':
      return `the ${finding.mode} tier answered but is not registered with the harness`;
    case 'mode-absent':
      return `the ${finding.mode} tier is registered but produced no records`;
    case 'fault':
      return `${finding.mode} ${finding.record} is not a usable record: ${finding.message}`;
    case 'divergence': {
      let { path, reason, reference, candidate } = finding.divergence;
      return (
        `${finding.mode} ${finding.record} ${path} [${reason}] ` +
        `reference=${reference} ${finding.mode}=${candidate}`
      );
    }
    case 'withheld':
      return `${finding.mode} ${finding.record}: and ${finding.count} more divergences not listed`;
    case 'records-shared':
      return `${finding.mode} was handed the reference tier's own ${finding.record}, so the comparison compared it with itself`;
  }
}
