// The spec-quality standard (boxel-catalog/docs/spec-quality-standard.md):
// six checks computed from crawl-stamped concept fields — no live Spec join,
// so the whole matrix scores synchronously. Each check is pass, fail, or not
// applicable to the concept's kind, and the score is passed-over-applicable:
// a kind with fewer applicable checks still has to clear all of them.
import type { MatrixConcept } from './matrix-concept';

export interface QualityCheck {
  key: string;
  label: string;
  state: CheckState;
  pass: boolean;
  detail: string;
}

export type CheckState = 'pass' | 'fail' | 'na';
export type QualityBucket =
  | 'gold'
  | 'solid'
  | 'adequate'
  | 'thin'
  | 'none'
  | 'out';
export type ConceptKind =
  | 'field'
  | 'card'
  | 'app'
  | 'component'
  | 'command'
  | 'filedef';
export type ConceptScope = 'block' | 'primitive' | 'internal' | 'alias';

export const README_FLOOR = 300;

const LANE_KINDS: Record<string, ConceptKind[]> = {
  'Fields & Types': ['field'],
  'Components & Views': ['component'],
  'Tools & Commands': ['command'],
  'Cards & Models': ['card', 'app', 'filedef'],
};

const LANE_DEFAULT_KIND: Record<string, ConceptKind> = {
  'Fields & Types': 'field',
  'Components & Views': 'component',
  'Tools & Commands': 'command',
  'Cards & Models': 'card',
};

export function consumerList(c: MatrixConcept): string[] {
  return (c.consumers ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Crawl-stamped when known; derived from the lane otherwise so a concept the
// crawl has not re-visited still scores against the right rubric.
export function conceptKindOf(c: MatrixConcept): ConceptKind {
  let stamped = (c.conceptKind ?? '').trim() as ConceptKind;
  if (stamped) return stamped;
  if (/\bFile$/.test(c.concept ?? '')) return 'filedef';
  return LANE_DEFAULT_KIND[c.lane ?? ''] ?? 'card';
}

export function conceptScopeOf(c: MatrixConcept): ConceptScope {
  let stamped = (c.scope ?? '').trim() as ConceptScope;
  return stamped || 'block';
}

export function isInScope(c: MatrixConcept): boolean {
  return conceptScopeOf(c) === 'block';
}

function check(
  key: string,
  label: string,
  state: CheckState,
  detail: string,
): QualityCheck {
  return { key, label, state, pass: state === 'pass', detail };
}

function exampleCheck(c: MatrixConcept, kind: ConceptKind): QualityCheck {
  let examples = c.specExampleCount ?? 0;
  let files = c.specFileExampleCount ?? 0;
  let fences = c.specReadmeCodeBlocks ?? 0;
  let usage = (c.specUsageRef ?? '').trim();

  if (kind === 'filedef') {
    return check(
      'example',
      'File attached as example',
      files > 0 ? 'pass' : 'fail',
      files > 0
        ? `${files} file${files === 1 ? '' : 's'} attached to the Spec`
        : 'No file attached — a file def is shown by an actual file, not a card (needs Spec.fileExamples)',
    );
  }
  if (kind === 'command') {
    let ok = examples > 0 || fences > 0;
    return check(
      'example',
      'Invocation shown',
      ok ? 'pass' : 'fail',
      ok
        ? examples > 0
          ? `${examples} example${examples === 1 ? '' : 's'} on the Spec`
          : `${fences} code block${fences === 1 ? '' : 's'} in the readMe showing a call`
        : 'Neither an example nor a copy-pasteable call in the readMe — a consumer cannot see how to invoke it',
    );
  }
  if (kind === 'component') {
    let ok = examples > 0 || Boolean(usage);
    return check(
      'example',
      'Example or usage page',
      ok ? 'pass' : 'fail',
      ok
        ? examples > 0
          ? `${examples} example${examples === 1 ? '' : 's'} on the Spec`
          : 'A usage page renders this component in its states'
        : 'No Spec example and no usage page — nothing shows this component rendering',
    );
  }
  return check(
    'example',
    'Example populated',
    examples > 0 ? 'pass' : 'fail',
    examples > 0
      ? `${examples} example${examples === 1 ? '' : 's'} on the Spec`
      : 'The Spec has no linked or contained example — a future consumer cannot see it working',
  );
}

export function qualityChecks(c: MatrixConcept): QualityCheck[] {
  let kind = conceptKindOf(c);
  let consumers = consumerList(c);
  let kinds = LANE_KINDS[c.lane ?? ''] ?? [];
  let readmeChars = c.specReadmeChars ?? 0;
  // A file def is reached through the base FileDef contract, so a consumer
  // naming this exact format is rare and proves nothing about reusability.
  let consumptionApplies = kind !== 'filedef';

  return [
    check(
      'verified',
      'Spec verified',
      c.sharedSpec ? 'pass' : 'fail',
      c.sharedSpec
        ? 'A Spec in the shared realm points at this concept'
        : 'No Spec in the shared realm evidences this concept',
    ),
    exampleCheck(c, kind),
    check(
      'readme',
      'ReadMe substance',
      readmeChars >= README_FLOOR ? 'pass' : 'fail',
      readmeChars >= README_FLOOR
        ? `${readmeChars} chars of readMe`
        : `ReadMe is ${readmeChars} chars — below the ${README_FLOOR}-char stub floor`,
    ),
    check(
      'consumed',
      'Consumed',
      !consumptionApplies ? 'na' : consumers.length >= 1 ? 'pass' : 'fail',
      !consumptionApplies
        ? 'Not applicable: file defs are consumed through the base FileDef contract'
        : consumers.length >= 1
          ? `${consumers.length} consumer${consumers.length === 1 ? '' : 's'} use this block`
          : 'Nothing uses this block yet — stage 2 unproven',
    ),
    check(
      'reused',
      'Reused (two-consumer rule)',
      !consumptionApplies ? 'na' : consumers.length >= 2 ? 'pass' : 'fail',
      !consumptionApplies
        ? 'Not applicable: see Consumed'
        : consumers.length >= 2
          ? 'A second consumer proves the interface'
          : 'One consumer proves it works; a second proves it is reusable',
    ),
    check(
      'lane',
      'Spec kind matches lane',
      Boolean(c.specKind) && kinds.includes(c.specKind as ConceptKind)
        ? 'pass'
        : 'fail',
      c.specKind
        ? kinds.includes(c.specKind as ConceptKind)
          ? `${c.specKind} spec in ${c.lane}`
          : `A "${c.specKind}" spec answers a different question than the ${c.lane} lane asks`
        : 'Spec kind not stamped by the crawl yet',
    ),
  ];
}

export function qualityScore(c: MatrixConcept): number {
  return qualityChecks(c).filter((x) => x.state === 'pass').length;
}

export function qualityApplicable(c: MatrixConcept): number {
  return qualityChecks(c).filter((x) => x.state !== 'na').length;
}

export function qualityBucket(c: MatrixConcept): QualityBucket {
  if (!isInScope(c)) return 'out';
  if (!c.sharedSpec) return 'none';
  let shortfall = qualityApplicable(c) - qualityScore(c);
  if (shortfall === 0) return 'gold';
  if (shortfall === 1) return 'solid';
  if (shortfall === 2) return 'adequate';
  return 'thin';
}

export const BUCKETS: { key: QualityBucket; label: string; color: string }[] = [
  { key: 'gold', label: 'Gold', color: '#ca8a04' },
  { key: 'solid', label: 'Solid', color: '#16a34a' },
  { key: 'adequate', label: 'Adequate', color: '#2563eb' },
  { key: 'thin', label: 'Thin', color: '#9ca3af' },
  { key: 'none', label: 'No spec', color: '#e5e7eb' },
  { key: 'out', label: 'Out of scope', color: '#f3f4f6' },
];

export function bucketLabel(b: QualityBucket): string {
  return BUCKETS.find((x) => x.key === b)?.label ?? b;
}

export function bucketColor(b: QualityBucket): string {
  return BUCKETS.find((x) => x.key === b)?.color ?? '#e5e7eb';
}

// Where a concept sits on the road to Gold. The bucket answers "how good is
// the Spec"; the stage answers "what is the next move", which is what a
// planning export is read for. Numbered so a spreadsheet sorts them in order.
export type ConceptStage =
  | '0-out-of-scope'
  | '1-no-code'
  | '2-code-no-spec'
  | '3-spec-thin'
  | '4-one-check-off'
  | '5-done';

export function conceptStage(c: MatrixConcept): ConceptStage {
  if (!isInScope(c)) return '0-out-of-scope';
  if (!c.evidenceTier) return '1-no-code';
  if (!c.sharedSpec) return '2-code-no-spec';
  switch (qualityBucket(c)) {
    case 'gold':
      return '5-done';
    case 'solid':
      return '4-one-check-off';
    default:
      return '3-spec-thin';
  }
}

export function failingChecks(c: MatrixConcept): string[] {
  return qualityChecks(c)
    .filter((x) => x.state === 'fail')
    .map((x) => x.key);
}
