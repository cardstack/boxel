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
import type { BoxelExecutionMode } from '../boxel-execution-protocol/runtime.ts';
import { BOXEL_EXECUTION_MODES } from '../boxel-execution-protocol/runtime.ts';
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
 * Empty, because RP-14.4 currently declares none — so the diff is total. An
 * entry here is a statement that a member legitimately differs between tiers,
 * which is a spec change: it needs the statement declaring it, in the same
 * change that adds the path. Left as a list rather than left out so that the
 * "modulo" clause in RP-14.4 has somewhere to be, and so the fact that it is
 * empty is something a test can hold.
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
  /** A tier's record is not inert data, so it cannot be compared at all. */
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
    };

export interface ParityReport {
  /** What the tiers were given, so a finding can be reproduced. */
  fixture: string;
  referenceMode: BoxelExecutionMode;
  /** The non-reference tiers that were compared, in tier order. */
  comparedModes: BoxelExecutionMode[];
  /** Records diffed against the reference: compared modes × record kinds. */
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
  // Walked in tier order rather than call order, so two callers listing the
  // same tiers differently get the same report.
  for (let mode of BOXEL_EXECUTION_MODES) {
    if (byMode.has(mode) && !registered.has(mode)) {
      findings.push({ kind: 'mode-unregistered', mode });
    }
    if (registered.has(mode) && !byMode.has(mode)) {
      findings.push({ kind: 'mode-absent', mode });
    }
  }

  let inspections = 0;
  for (let mode of BOXEL_EXECUTION_MODES) {
    let tier = byMode.get(mode);
    if (tier === undefined) {
      continue;
    }
    for (let record of PARITY_RECORD_KINDS) {
      inspections += 1;
      let fault = faultInRecord(tier[record]);
      if (fault !== undefined) {
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
  for (let mode of BOXEL_EXECUTION_MODES) {
    let candidate = byMode.get(mode);
    if (candidate === undefined || mode === PARITY_REFERENCE_MODE) {
      continue;
    }
    comparedModes.push(mode);
    for (let record of PARITY_RECORD_KINDS) {
      let diff = diffRecords(reference[record], candidate[record], {
        exemptPaths,
      });
      // Faults were already reported per tier above; repeating them per
      // comparison would say the same thing once per peer.
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
    comparisons: comparedModes.length * PARITY_RECORD_KINDS.length,
    inspections,
    findings,
  };
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
      return `${finding.mode} ${finding.record} is not a record: ${finding.message}`;
    case 'divergence': {
      let { path, reason, reference, candidate } = finding.divergence;
      return (
        `${finding.mode} ${finding.record} ` +
        `${path === '' ? '(the record)' : path} [${reason}] ` +
        `reference=${reference} ${finding.mode}=${candidate}`
      );
    }
    case 'withheld':
      return `${finding.mode} ${finding.record}: and ${finding.count} more divergences not listed`;
  }
}
