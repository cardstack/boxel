import { describe, it, expect } from 'vitest';
import {
  computeEmissionPlan,
  getSkillDescription,
  type SkillCard,
} from '../../scripts/build-skills';

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
