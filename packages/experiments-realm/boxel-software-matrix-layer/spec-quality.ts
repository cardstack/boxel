// The spec-quality standard (boxel-catalog/docs/spec-quality-standard.md):
// six mechanical checks computed from crawl-stamped concept fields — no live
// Spec join, so the whole matrix scores synchronously.
import type { MatrixConcept } from './matrix-concept';

export interface QualityCheck {
  key: string;
  label: string;
  pass: boolean;
  detail: string;
}

export type QualityBucket = 'gold' | 'solid' | 'adequate' | 'thin' | 'none';

export const README_FLOOR = 300;

const LANE_KINDS: Record<string, string[]> = {
  'Fields & Types': ['field'],
  'Components & Views': ['component'],
  'Tools & Commands': ['command'],
  'Cards & Models': ['card', 'app'],
};

export function consumerList(c: MatrixConcept): string[] {
  return (c.consumers ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function qualityChecks(c: MatrixConcept): QualityCheck[] {
  let consumers = consumerList(c);
  let kinds = LANE_KINDS[c.lane ?? ''] ?? [];
  let exampleCount = c.specExampleCount ?? 0;
  let readmeChars = c.specReadmeChars ?? 0;
  return [
    {
      key: 'verified',
      label: 'Spec verified',
      pass: Boolean(c.sharedSpec),
      detail: c.sharedSpec
        ? 'A Spec in the shared realm points at this concept'
        : 'No Spec in the shared realm evidences this concept',
    },
    {
      key: 'example',
      label: 'Example populated',
      pass: exampleCount > 0,
      detail:
        exampleCount > 0
          ? `${exampleCount} example${exampleCount === 1 ? '' : 's'} on the Spec`
          : 'The Spec has no linked or contained example — a future consumer cannot see it working',
    },
    {
      key: 'readme',
      label: 'ReadMe substance',
      pass: readmeChars >= README_FLOOR,
      detail:
        readmeChars >= README_FLOOR
          ? `${readmeChars} chars of readMe`
          : `ReadMe is ${readmeChars} chars — below the ${README_FLOOR}-char stub floor`,
    },
    {
      key: 'consumed',
      label: 'Consumed',
      pass: consumers.length >= 1,
      detail:
        consumers.length >= 1
          ? `${consumers.length} consumer${consumers.length === 1 ? '' : 's'} import this block`
          : 'Nothing imports this block yet — stage 2 unproven',
    },
    {
      key: 'reused',
      label: 'Reused (two-consumer rule)',
      pass: consumers.length >= 2,
      detail:
        consumers.length >= 2
          ? 'A second consumer proves the interface'
          : 'One consumer proves it works; a second proves it is reusable',
    },
    {
      key: 'lane',
      label: 'Spec kind matches lane',
      pass: Boolean(c.specKind) && kinds.includes(c.specKind!),
      detail: c.specKind
        ? kinds.includes(c.specKind)
          ? `${c.specKind} spec in ${c.lane}`
          : `A "${c.specKind}" spec answers a different question than the ${c.lane} lane asks`
        : 'Spec kind not stamped by the crawl yet',
    },
  ];
}

export function qualityScore(c: MatrixConcept): number {
  return qualityChecks(c).filter((x) => x.pass).length;
}

export function qualityBucket(c: MatrixConcept): QualityBucket {
  if (!c.sharedSpec) return 'none';
  let score = qualityScore(c);
  if (score >= 6) return 'gold';
  if (score === 5) return 'solid';
  if (score === 4) return 'adequate';
  return 'thin';
}

export const BUCKETS: { key: QualityBucket; label: string; color: string }[] = [
  { key: 'gold', label: 'Gold', color: '#ca8a04' },
  { key: 'solid', label: 'Solid', color: '#16a34a' },
  { key: 'adequate', label: 'Adequate', color: '#2563eb' },
  { key: 'thin', label: 'Thin', color: '#9ca3af' },
  { key: 'none', label: 'No spec', color: '#e5e7eb' },
];

export function bucketLabel(b: QualityBucket): string {
  return BUCKETS.find((x) => x.key === b)?.label ?? b;
}

export function bucketColor(b: QualityBucket): string {
  return BUCKETS.find((x) => x.key === b)?.color ?? '#e5e7eb';
}
