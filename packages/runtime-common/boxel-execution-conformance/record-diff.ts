/**
 * Whether two producers built the same record, and where they parted (RP-14.4).
 *
 * Part of the cross-boundary execution conformance harness; see
 * `../boxel-execution-conformance.ts` for what the harness is and what it is
 * not.
 *
 * The equality this implements is equality *as a record*, which is narrower
 * than `===` and wider than `JSON.stringify` on both sides:
 *
 * - **Member order is not part of a record.** Two producers that build the
 *   same description through different code order their keys differently, and
 *   a stringified comparison calls that a divergence. Members are compared by
 *   name.
 * - **Element order is.** `ancestors`, `fields` and `formats` are sequences a
 *   consumer renders in order, so a tier that enumerates them differently has
 *   diverged.
 * - **Absent, `undefined` and `null` are three states, not one.** A member
 *   with an `undefined` value survives `structuredClone` with its name intact,
 *   so `'x' in record` distinguishes it from an absent one, and a consumer
 *   reading it distinguishes both from `null`.
 * - **`Object.is`, not `===`, compares scalars.** `NaN` and `-0` both cross a
 *   boundary intact, so two producers can genuinely differ by `0` vs `-0` —
 *   which is what a lane that JSON round-trips where it claims to
 *   `structuredClone` looks like from here.
 *
 * Before anything is compared, each side is reduced to inert data by the
 * protocol's own normalizer — the same call every gate makes. That is
 * deliberate: a diff judging records by a looser rule than the boundary would
 * call two records equal that the boundary then refuses. So a value carrying
 * an accessor, a symbol-keyed member, a prototype of its own, or a reference
 * to itself is not compared at all. It is reported as a fault, naming the
 * member and the refusal code, because "these two records differ at every
 * path" says nothing that "this record is not data" has not already said.
 *
 * The root itself must be a record, and that is load-bearing rather than
 * tidy. `null`, a string and an empty array are all inert data, so two
 * producers that answered with the same one of them agree at every path — and
 * a harness reporting parity over two tiers that each produced no record is
 * exactly the false green this exists to prevent. A root that is not a record
 * is a fault about that side.
 */

import stringify from 'safe-stable-stringify';

import type { ProtocolRefusalCode } from '../boxel-execution-protocol/refusal.ts';
import { isProtocolRefusal } from '../boxel-execution-protocol/refusal.ts';
import {
  asRefusal,
  normalizeJsonRecord,
} from '../boxel-execution-protocol/untrusted-input.ts';

/**
 * How many divergences one comparison names before counting the rest.
 *
 * Two wholly unrelated records diverge at every leaf, and a producer chooses
 * how many leaves it sent. A report is read by a person, so it is bounded in
 * count the way the protocol's own diagnostics are — and, like those, it
 * reports the number it *found* rather than the number it printed. A tier
 * developer told they have twenty-five divergences when they have four hundred
 * fixes twenty-five of them and re-runs.
 */
export const REPORTED_DIVERGENCE_LIMIT = 25;

/**
 * How much of a divergent value a report repeats. The value is chosen by the
 * producer under test, so a single string field can otherwise put a megabyte
 * into a CI log.
 */
const RENDERED_VALUE_LIMIT = 160;

export type DivergenceReason =
  /** Both sides carry a scalar at this path and the scalars differ. */
  | 'value'
  /** One side carries a record, an array, or a scalar where the other does not. */
  | 'shape'
  /** One side has no member of this name at all. */
  | 'absent'
  /** Both sides carry an array here and the arrays are different lengths. */
  | 'length';

/** One place two records disagree, named by the path that reaches it. */
export interface RecordDivergence {
  /**
   * Where the disagreement is, as a reader would address it: `''` for the
   * record itself, then `fields[2].kind`, `presentation.themeScope`,
   * `model.summary`.
   */
  path: string;
  reason: DivergenceReason;
  /** The reference side's value, rendered and bounded. */
  reference: string;
  /** The candidate side's value, rendered and bounded. */
  candidate: string;
}

/**
 * A record that is not inert data, so nothing about it can be compared.
 *
 * Distinct from a divergence on purpose. A divergence is a claim about two
 * records; this is a claim about one, and it holds whether or not there is
 * another record to compare it to.
 */
export interface RecordFault {
  side: 'reference' | 'candidate';
  code: ProtocolRefusalCode;
  /** The refusal's own message, which names the offending member. */
  message: string;
}

export interface RecordDiff {
  divergences: RecordDivergence[];
  /** Divergences found past `REPORTED_DIVERGENCE_LIMIT` and not listed. */
  withheld: number;
  faults: RecordFault[];
}

export interface RecordDiffOptions {
  /**
   * Paths the spec declares tier-specific, which are therefore not compared
   * (RP-14.4). An exemption covers the path it names and everything under it,
   * and array indices are wildcarded on both sides — `fields[].kind` and
   * `fields[0].kind` both exempt that member of every element, since a
   * tier-specific member is a property of the record shape rather than of one
   * element's position, and an exemption that matched no position at all would
   * be a rule that reads as satisfied while doing nothing. An empty entry is
   * dropped: it would cover every path and silence the whole record.
   */
  exemptPaths?: readonly string[];
}

/**
 * Compares two records built for the same input, and reports where they part.
 *
 * `reference` is the side the contract is written against — Direct, where a
 * tier is under test (RP-0.5) — so a divergence reads as "the candidate did
 * this instead".
 */
export function diffRecords(
  reference: unknown,
  candidate: unknown,
  options: RecordDiffOptions = {},
): RecordDiff {
  let faults: RecordFault[] = [];
  let referenceData = readAsData(reference, 'reference', faults);
  let candidateData = readAsData(candidate, 'candidate', faults);
  if (faults.length > 0) {
    return { divergences: [], withheld: 0, faults };
  }
  let walk: Walk = {
    divergences: [],
    withheld: 0,
    compared: new Map(),
    exemptions: activeExemptions(options.exemptPaths),
  };
  compareValue(walk, '', referenceData, candidateData);
  return { divergences: walk.divergences, withheld: walk.withheld, faults };
}

/**
 * The exemptions that can cover a path, wildcarded so an index names the
 * record's shape rather than one position.
 *
 * An empty entry is dropped rather than honored. Coverage is prefix-closed —
 * an exemption covers the path it names and everything under it — and the
 * empty path is a prefix of every path, so honoring one would silence the
 * whole record and report parity. Nothing legitimately names it: the root of a
 * record is not a member, and a member that differs is always named by a
 * non-empty path.
 */
function activeExemptions(
  exemptPaths: readonly string[] | undefined,
): string[] {
  return [...(exemptPaths ?? [])]
    .map(wildcardIndices)
    .filter((exemption) => exemption !== '');
}

/** Whether a diff found nothing to report. */
export function recordsAgree(diff: RecordDiff): boolean {
  return (
    diff.faults.length === 0 &&
    diff.divergences.length === 0 &&
    diff.withheld === 0
  );
}

/**
 * Why one value is not a record of inert data, or `undefined` when it is.
 *
 * Worth asking on its own: a harness with a single tier has nothing to diff,
 * and "the one record we have is a record" is still a claim about it that can
 * fail — and it is the claim that fails when a producer answered with `null`.
 */
export function faultInRecord(
  value: unknown,
): Omit<RecordFault, 'side'> | undefined {
  let faults: RecordFault[] = [];
  readAsData(value, 'reference', faults);
  let [fault] = faults;
  return fault === undefined
    ? undefined
    : { code: fault.code, message: fault.message };
}

/**
 * Renders a diff as the message an assertion fails with.
 *
 * One line per finding, each self-contained: a path with no value beside it
 * sends the reader back to the two records to work out what changed.
 */
export function describeRecordDiff(diff: RecordDiff): string {
  let lines = diff.faults.map(
    (fault) => `${fault.side} is not a record: ${fault.message}`,
  );
  for (let divergence of diff.divergences) {
    lines.push(
      `${divergence.path} [${divergence.reason}] ` +
        `reference=${divergence.reference} candidate=${divergence.candidate}`,
    );
  }
  if (diff.withheld > 0) {
    lines.push(`(and ${diff.withheld} more divergences not listed)`);
  }
  return lines.length === 0 ? 'the records agree' : lines.join('\n');
}

interface Walk {
  divergences: RecordDivergence[];
  withheld: number;
  /**
   * Pairs already compared, so a subgraph both records share is walked once.
   *
   * `structuredClone` preserves sharing, so a normalized record is a directed
   * acyclic graph rather than a tree, and a graph whose every node has two
   * parents has a number of *paths* exponential in its depth. Without this the
   * harness stops answering on a record it accepted.
   *
   * Two consequences to know. A divergence inside a shared subgraph is
   * reported at the first path that reaches it, not at every path. And the
   * memo must never be reached for an exempt path, or exempting one member
   * silences divergences at unrelated ones — which is why exemption prunes the
   * descent in `compareValue` rather than filtering in `report`.
   */
  compared: Map<object, Set<object>>;
  exemptions: string[];
}

/**
 * A member that is not there, kept distinct from one whose value is
 * `undefined` — `structuredClone` carries the second with its name, so a
 * consumer can tell them apart and so must this.
 */
const ABSENT = Symbol('absent');

// Resolves to `unknown`, so it constrains nothing. It is here to say which
// parameters may be handed the sentinel, since that is not visible from the
// type.
type Compared = unknown | typeof ABSENT;

function readAsData(
  value: unknown,
  side: RecordFault['side'],
  faults: RecordFault[],
): unknown {
  try {
    return asRefusal(() => normalizeJsonRecord(value, 'a protocol record'));
  } catch (error) {
    // `asRefusal` is what makes the other branch unreachable; the check is
    // here because it is also what narrows `error` to something with a `code`.
    if (!isProtocolRefusal(error)) {
      throw error;
    }
    faults.push({ side, code: error.code, message: error.message });
    return undefined;
  }
}

function compareValue(
  walk: Walk,
  path: string,
  reference: Compared,
  candidate: Compared,
): void {
  // Exemption prunes the descent rather than filtering the report, and that
  // ordering is the whole of its correctness. Filtering at the report meant an
  // exempt path still walked its subtree and still entered the compared-pair
  // memo — so a subgraph two records share, reached first through an exempt
  // path, was recorded as compared and every later non-exempt path to it was
  // skipped. Exempting one member silenced divergences at unrelated members,
  // and which ones depended on visit order.
  if (isExempt(walk, path)) {
    return;
  }
  if (reference === ABSENT || candidate === ABSENT) {
    report(walk, path, 'absent', reference, candidate);
    return;
  }
  // One branch per container kind, each asking about both sides, rather than
  // four booleans compared pairwise: a shape divergence and a recursion into
  // the same shape are the same question asked once.
  if (Array.isArray(reference) || Array.isArray(candidate)) {
    if (!Array.isArray(reference) || !Array.isArray(candidate)) {
      report(walk, path, 'shape', reference, candidate);
      return;
    }
    compareArray(walk, path, reference, candidate);
    return;
  }
  if (isRecord(reference) || isRecord(candidate)) {
    if (!isRecord(reference) || !isRecord(candidate)) {
      report(walk, path, 'shape', reference, candidate);
      return;
    }
    compareRecord(walk, path, reference, candidate);
    return;
  }
  if (!Object.is(reference, candidate)) {
    report(walk, path, 'value', reference, candidate);
  }
}

function compareArray(
  walk: Walk,
  path: string,
  reference: unknown[],
  candidate: unknown[],
): void {
  if (alreadyCompared(walk, reference, candidate)) {
    return;
  }
  if (reference.length !== candidate.length) {
    report(walk, path, 'length', reference.length, candidate.length);
  }
  // The shared prefix, rather than the union: a longer array would otherwise
  // report the length once and then once more per element the other side never
  // had, which is the same fact told N times. An element *inserted* in the
  // middle still shifts everything after it and reports per position — that is
  // two records genuinely disagreeing at those positions, and the report limit
  // is what keeps it readable.
  let shared = Math.min(reference.length, candidate.length);
  for (let index = 0; index < shared; index++) {
    compareValue(walk, `${path}[${index}]`, reference[index], candidate[index]);
  }
}

function compareRecord(
  walk: Walk,
  path: string,
  reference: Record<string, unknown>,
  candidate: Record<string, unknown>,
): void {
  if (alreadyCompared(walk, reference, candidate)) {
    return;
  }
  // Sorted, so the report reads the same however the two producers happened to
  // lay their keys out. Unsorted, the same pair of records yields a different
  // report depending on which side is the reference.
  let names = [
    ...new Set([...Object.keys(reference), ...Object.keys(candidate)]),
  ].sort();
  for (let name of names) {
    compareValue(
      walk,
      path === '' ? name : `${path}.${name}`,
      ownValue(reference, name),
      ownValue(candidate, name),
    );
  }
}

function ownValue(source: Record<string, unknown>, name: string): Compared {
  return Object.prototype.hasOwnProperty.call(source, name)
    ? source[name]
    : ABSENT;
}

function alreadyCompared(
  walk: Walk,
  reference: object,
  candidate: object,
): boolean {
  let against = walk.compared.get(reference);
  if (against === undefined) {
    walk.compared.set(reference, new Set([candidate]));
    return false;
  }
  if (against.has(candidate)) {
    return true;
  }
  against.add(candidate);
  return false;
}

function report(
  walk: Walk,
  path: string,
  reason: DivergenceReason,
  reference: Compared,
  candidate: Compared,
): void {
  if (walk.divergences.length >= REPORTED_DIVERGENCE_LIMIT) {
    walk.withheld += 1;
    return;
  }
  walk.divergences.push({
    path,
    reason,
    reference: render(reference),
    candidate: render(candidate),
  });
}

/**
 * Whether a path is covered by an exemption: the exact path, or anything
 * beneath it.
 *
 * Both sides have their array indices removed, so an exemption describes the
 * record's shape rather than one element's position — and one written with a
 * concrete index means the member of every element rather than silently
 * matching nothing.
 */
function isExempt(walk: Walk, path: string): boolean {
  if (walk.exemptions.length === 0) {
    return false;
  }
  let wildcarded = wildcardIndices(path);
  return walk.exemptions.some(
    (exemption) =>
      wildcarded === exemption ||
      wildcarded.startsWith(`${exemption}.`) ||
      wildcarded.startsWith(`${exemption}[`),
  );
}

function wildcardIndices(path: string): string {
  return path.replace(/\[\d+\]/g, '[]');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Renders one side of a divergence.
 *
 * Numbers go through `String` rather than JSON, and `-0` is spelled out: JSON
 * writes `NaN` and both infinities as `null` and `-0` as `0`, so a report of
 * the very divergences `Object.is` exists to catch would read
 * `reference=0 candidate=0`. Everything else is stable-stringified, so member
 * order in a rendered subtree does not depend on which producer built it.
 */
function render(value: Compared): string {
  if (value === ABSENT) {
    return 'absent';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'number') {
    return Object.is(value, -0) ? '-0' : String(value);
  }
  return bound(stringify(value) ?? String(value));
}

function bound(rendered: string): string {
  return rendered.length > RENDERED_VALUE_LIMIT
    ? `${rendered.slice(0, RENDERED_VALUE_LIMIT)}…`
    : rendered;
}
