import { describe, it, expect } from 'vitest';
import {
  computeEmissionPlan,
  computeStaleIds,
  getSkillDescription,
  isExcluded,
  type Manifest,
  type SkillCard,
} from '../../scripts/build-skills.ts';

function makeSkillSet(
  id: string,
  childIds: string[],
  attrs: Record<string, any> = {},
): SkillCard {
  const relatedSkills = childIds.map(() => ({
    inclusionMode: 'full' as const,
  }));
  const relationships: Record<string, unknown> = {};
  childIds.forEach((childId, i) => {
    relationships[`relatedSkills.${i}.skill`] = {
      links: { self: `./${childId}` },
    };
  });
  return {
    id,
    kind: 'SkillSet',
    json: {
      data: {
        attributes: { ...attrs, relatedSkills },
        relationships,
      },
    },
  };
}

function makeLeaf(id: string, attrs: Record<string, any> = {}): SkillCard {
  return {
    id,
    kind: 'SkillPlusMarkdown',
    json: { data: { attributes: attrs } },
  };
}

function makeBogus(id: string): SkillCard {
  return {
    id,
    kind: 'SomeFutureCardType',
    json: { data: { attributes: {} } },
  };
}

function asMap(cards: SkillCard[]): Map<string, SkillCard> {
  return new Map(cards.map((c) => [c.id, c]));
}

describe('computeEmissionPlan', () => {
  it('emits aggregators and only the unparented leaves', () => {
    const cards = asMap([
      makeSkillSet('parent', ['child-a', 'child-b']),
      makeLeaf('child-a'),
      makeLeaf('child-b'),
      makeLeaf('standalone'),
    ]);

    const plan = computeEmissionPlan(cards);
    const emittedIds = plan.emit.map((c) => c.id).sort();

    expect(emittedIds).toEqual(['parent', 'standalone']);
    expect(plan.aggregatorChildren.has('child-a')).toBe(true);
    expect(plan.aggregatorChildren.has('child-b')).toBe(true);
    expect(plan.unsupported).toEqual([]);
  });

  it('emits all unparented leaves when no aggregator claims them', () => {
    const cards = asMap([makeLeaf('one'), makeLeaf('two'), makeLeaf('three')]);

    const plan = computeEmissionPlan(cards);
    const emittedIds = plan.emit.map((c) => c.id).sort();

    expect(emittedIds).toEqual(['one', 'three', 'two']);
    expect(plan.aggregatorChildren.size).toBe(0);
  });

  it('records cards with unknown kinds as unsupported rather than throwing', () => {
    const cards = asMap([makeLeaf('known-leaf'), makeBogus('future-card')]);

    const plan = computeEmissionPlan(cards);

    expect(plan.emit.map((c) => c.id)).toEqual(['known-leaf']);
    expect(plan.unsupported.map((c) => c.id)).toEqual(['future-card']);
  });

  it('returns cards in a stable sorted order', () => {
    const cards = asMap([
      makeLeaf('zebra'),
      makeLeaf('alpha'),
      makeSkillSet('mango', []),
    ]);

    const plan = computeEmissionPlan(cards);

    expect(plan.emit.map((c) => c.id)).toEqual(['alpha', 'mango', 'zebra']);
  });

  it('drops excluded cards and does not promote their aggregator children', () => {
    const cards = asMap([
      makeSkillSet('boxel-environment', [
        'env-calling-commands',
        'source-code-editing',
      ]),
      makeLeaf('env-calling-commands'),
      makeLeaf('source-code-editing'),
      makeLeaf('env-creating-and-editing-cards'),
      makeLeaf('boxel-development'),
    ]);

    const plan = computeEmissionPlan(cards);
    const emittedIds = plan.emit.map((c) => c.id).sort();

    // boxel-environment + its references + env-creating-and-editing-cards
    // are all in EXCLUDED_IDS. source-code-editing is also excluded — even
    // if it weren't, it's claimed by the (excluded) aggregator and must NOT
    // get promoted to a top-level leaf.
    expect(emittedIds).toEqual(['boxel-development']);
  });
});

describe('isExcluded', () => {
  it('rejects the boxel-environment aggregator by name', () => {
    expect(isExcluded('boxel-environment')).toBe(true);
  });

  it('rejects every listed boxel-environment reference and host-only top-level leaf', () => {
    const expectedRejected = [
      'env-assistant-persona',
      'env-calling-commands',
      'env-choosing-llm-models',
      'env-indexing-operations',
      'env-markdown-edit',
      'env-searching-and-querying',
      'env-user-environment-awareness',
      'env-workflows-and-orchestration-patterns',
      'source-code-editing',
      'env-creating-and-editing-cards',
      'env-sim-boxel-environment-guide',
    ];
    for (const id of expectedRejected) {
      expect(isExcluded(id), `${id} should be excluded`).toBe(true);
    }
  });

  it('does NOT exclude future env-* additions (no prefix rule)', () => {
    // Encodes the policy that the exclusion is an explicit allowlist of
    // host-only IDs, not a blanket `env-*` ban — future upstream cards
    // with the env- prefix should ship by default.
    expect(isExcluded('env-something-future')).toBe(false);
    expect(isExcluded('env-cli-friendly')).toBe(false);
  });

  it('accepts unrelated cards', () => {
    expect(isExcluded('boxel-development')).toBe(false);
    expect(isExcluded('catalog-listing')).toBe(false);
    expect(isExcluded('dev-bfm-syntax')).toBe(false);
    expect(isExcluded('environment-other')).toBe(false);
  });
});

describe('computeStaleIds', () => {
  it('returns [] when there is no prior manifest', () => {
    expect(computeStaleIds(null, ['a', 'b'])).toEqual([]);
  });

  it('returns prior ids that are no longer in the emit set', () => {
    const prior: Manifest = {
      version: 'v0.0.22',
      skills: ['boxel-environment', 'boxel-development', 'env-old'],
    };
    expect(
      computeStaleIds(prior, ['boxel-development', 'catalog-listing']),
    ).toEqual(['boxel-environment', 'env-old']);
  });

  it('returns [] when the new emit set is a superset', () => {
    const prior: Manifest = {
      version: 'v0.0.22',
      skills: ['a', 'b'],
    };
    expect(computeStaleIds(prior, ['a', 'b', 'c'])).toEqual([]);
  });

  it('sorts the stale id list deterministically', () => {
    const prior: Manifest = {
      version: 'v0.0.22',
      skills: ['zebra', 'alpha', 'mango'],
    };
    expect(computeStaleIds(prior, [])).toEqual(['alpha', 'mango', 'zebra']);
  });
});

describe('getSkillDescription', () => {
  it('prefers DESCRIPTION_OVERRIDES for the curated entries', () => {
    const card = makeLeaf('boxel-design', {
      cardInfo: { name: 'Boxel Design', summary: 'too generic' },
    });
    expect(getSkillDescription(card)).toMatch(/Boxel UI design discovery/);
  });

  it('falls back to cardInfo.summary when no override exists', () => {
    const card = makeLeaf('new-skill', {
      cardInfo: { name: 'New Skill', summary: 'Helpful upstream summary.' },
    });
    expect(getSkillDescription(card)).toBe('Helpful upstream summary.');
  });

  it('falls back to cardInfo.name for leaves with no summary', () => {
    const card = makeLeaf('bare-leaf', {
      cardInfo: { name: 'Bare Leaf' },
    });
    expect(getSkillDescription(card)).toBe('Bare Leaf');
  });

  it('uses the SkillSet-flavored fallback for aggregators with no summary', () => {
    const card = makeSkillSet('agg', ['c-a'], {
      cardInfo: { name: 'Aggregator' },
    });
    expect(getSkillDescription(card)).toBe(
      'Aggregator skill from boxel-skills.',
    );
  });
});
