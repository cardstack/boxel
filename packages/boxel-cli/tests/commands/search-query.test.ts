import { describe, it, expect } from 'vitest';
import {
  searchEntryRequestBody,
  itemsFromSearchEntryDoc,
} from '../../src/commands/search.ts';

const SkillRef = {
  module: 'https://cardstack.com/base/skill',
  name: 'Skill',
};
const CardDefRef = {
  module: 'https://cardstack.com/base/card-api',
  name: 'CardDef',
};

describe('searchEntryRequestBody — card-rooted query → entry wire grammar', () => {
  it('always requests the data-only fieldset and the given realms', () => {
    let body = searchEntryRequestBody({}, ['https://realm/a/']);
    expect(body).toEqual({
      realms: ['https://realm/a/'],
      fields: { entry: ['item'] },
    });
  });

  it('rewrites a standalone type filter to the item.on anchor', () => {
    let body = searchEntryRequestBody({ filter: { type: SkillRef } }, [
      'https://realm/a/',
    ]);
    expect(body.filter).toEqual({ 'item.on': SkillRef });
  });

  it('rewrites a node `on` + field operators with the item. prefix', () => {
    let body = searchEntryRequestBody(
      { filter: { on: CardDefRef, eq: { cardTitle: 'Shared Card' } } },
      ['https://realm/a/'],
    );
    expect(body.filter).toEqual({
      'item.on': CardDefRef,
      eq: { 'item.cardTitle': 'Shared Card' },
    });
  });

  it('recurses into any/every/not connectives', () => {
    let body = searchEntryRequestBody(
      {
        filter: {
          every: [
            { type: SkillRef },
            { not: { eq: { status: 'archived' } } },
            {
              any: [
                { contains: { title: 'a' } },
                { range: { rank: { gt: 1 } } },
              ],
            },
          ],
        },
      },
      ['https://realm/a/'],
    );
    expect(body.filter).toEqual({
      every: [
        { 'item.on': SkillRef },
        { not: { eq: { 'item.status': 'archived' } } },
        {
          any: [
            { contains: { 'item.title': 'a' } },
            { range: { 'item.rank': { gt: 1 } } },
          ],
        },
      ],
    });
  });

  it('passes `matches` through unprefixed (whole-document full-text)', () => {
    let body = searchEntryRequestBody({ filter: { matches: 'hello' } }, [
      'https://realm/a/',
    ]);
    expect(body.filter).toEqual({ matches: 'hello' });
  });

  it('prefixes sort `by`, maps sort `on` to item.on, keeps direction', () => {
    let body = searchEntryRequestBody(
      { sort: [{ by: 'title', on: CardDefRef, direction: 'desc' }] },
      ['https://realm/a/'],
    );
    expect(body.sort).toEqual([
      { by: 'item.title', 'item.on': CardDefRef, direction: 'desc' },
    ]);
  });

  it('carries page and cardUrls through verbatim', () => {
    let body = searchEntryRequestBody(
      { page: { size: 10 }, cardUrls: ['https://realm/a/x'] },
      ['https://realm/a/'],
    );
    expect(body.page).toEqual({ size: 10 });
    expect(body.cardUrls).toEqual(['https://realm/a/x']);
  });

  it('throws on a filter member it cannot translate', () => {
    expect(() =>
      searchEntryRequestBody({ filter: { bogus: 1 } }, ['https://realm/a/']),
    ).toThrow(/cannot translate filter member "bogus"/);
  });
});

describe('itemsFromSearchEntryDoc — flatten a data-only entry doc to items', () => {
  it("resolves each entry's item from included, in entry order", () => {
    let doc = {
      data: [
        {
          id: 'https://realm/a/two',
          relationships: {
            item: { data: { type: 'card', id: 'https://realm/a/two' } },
          },
        },
        {
          id: 'https://realm/a/one',
          relationships: {
            item: { data: { type: 'card', id: 'https://realm/a/one' } },
          },
        },
      ],
      included: [
        {
          type: 'card',
          id: 'https://realm/a/one',
          attributes: { title: 'One' },
        },
        {
          type: 'card',
          id: 'https://realm/a/two',
          attributes: { title: 'Two' },
        },
      ],
      meta: { page: { total: 2 } },
    };
    let items = itemsFromSearchEntryDoc(doc);
    expect(items.map((i) => (i as any).id)).toEqual([
      'https://realm/a/two',
      'https://realm/a/one',
    ]);
  });

  it('resolves file-meta items the same way', () => {
    let doc = {
      data: [
        {
          id: 'https://realm/a/f.gts',
          relationships: {
            item: { data: { type: 'file-meta', id: 'https://realm/a/f.gts' } },
          },
        },
      ],
      included: [
        { type: 'file-meta', id: 'https://realm/a/f.gts', attributes: {} },
      ],
    };
    expect(itemsFromSearchEntryDoc(doc).map((i) => (i as any).id)).toEqual([
      'https://realm/a/f.gts',
    ]);
  });

  it('skips entries with no item relationship or no matching included resource', () => {
    let doc = {
      data: [
        { id: 'https://realm/a/html-only', relationships: {} },
        {
          id: 'https://realm/a/missing',
          relationships: {
            item: { data: { type: 'card', id: 'https://realm/a/missing' } },
          },
        },
      ],
      included: [],
    };
    expect(itemsFromSearchEntryDoc(doc)).toEqual([]);
  });

  it('returns an empty array for an empty document', () => {
    expect(itemsFromSearchEntryDoc({})).toEqual([]);
  });
});
