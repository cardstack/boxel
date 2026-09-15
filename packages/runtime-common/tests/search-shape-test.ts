import type { SharedTests } from '../helpers/index.ts';
import type { Filter, Sort } from '../query.ts';
import type { RealmResourceIdentifier } from '../realm-identifiers.ts';
import type { SearchEntryQuery } from '../search-entry.ts';
import {
  describeFilterShape,
  describeHtmlQuery,
  describeSearchShape,
  describeSortShape,
} from '../search-shape.ts';

const personRef = {
  module: 'http://localhost:4201/test/person' as RealmResourceIdentifier,
  name: 'Person',
};
const postRef = {
  module: 'http://localhost:4201/test/post' as RealmResourceIdentifier,
  name: 'Post',
};

function entryQuery(overrides: Partial<SearchEntryQuery>): SearchEntryQuery {
  return {
    itemQuery: {},
    htmlQuery: { eq: { format: 'fitted' } },
    fieldset: { html: true, item: { kind: 'none' }, itemAsFallback: true },
    ...overrides,
  };
}

function shapeOf(overrides: Partial<SearchEntryQuery>) {
  return describeSearchShape({
    query: entryQuery(overrides),
    realms: ['http://localhost:4201/test/'],
    correlationId: null,
    jobId: null,
    consumingRealm: null,
    jobPriority: null,
  });
}

const tests = Object.freeze({
  'a filter-less query has no filter shape': async (assert) => {
    assert.strictEqual(describeFilterShape(undefined), null);
  },

  'a card-type filter renders its type ref': async (assert) => {
    assert.strictEqual(
      describeFilterShape({ type: personRef }),
      'type(http://localhost:4201/test/person/Person)',
    );
  },

  'eq renders its field paths and not its values': async (assert) => {
    let shape = describeFilterShape({
      on: personRef,
      eq: { firstName: 'Mango', 'address.city': 'Bandung' },
    } as Filter);
    assert.strictEqual(
      shape,
      'on(http://localhost:4201/test/person/Person):eq(address.city,firstName)',
    );
    assert.false(shape!.includes('Mango'), 'no filter value appears');
    assert.false(shape!.includes('Bandung'), 'no filter value appears');
  },

  'contains renders its field paths and not its values': async (assert) => {
    let shape = describeFilterShape({
      contains: { title: 'secret project' },
    } as Filter);
    assert.strictEqual(shape, 'contains(title)');
    assert.false(shape!.includes('secret'), 'no filter value appears');
  },

  'in renders its field paths and neither its members nor their count': async (
    assert,
  ) => {
    let shape = describeFilterShape({
      in: { id: ['http://localhost:4201/test/mango', 'http://x/vangogh'] },
    } as Filter);
    assert.strictEqual(shape, 'in(id)');
    assert.false(shape!.includes('mango'), 'no card URL appears');
  },

  'range renders its bound operators and not its bounds': async (assert) => {
    let shape = describeFilterShape({
      range: { age: { gte: 21, lt: 65 }, createdAt: { gt: '2026-01-01' } },
    } as Filter);
    assert.strictEqual(shape, 'range(age:gte+lt,createdAt:gt)');
    assert.false(shape!.includes('21'), 'no bound value appears');
    assert.false(shape!.includes('2026'), 'no bound value appears');
  },

  'a full-text matches renders as the bare operator': async (assert) => {
    let shape = describeFilterShape({ matches: 'my private search term' });
    assert.strictEqual(shape, 'matches');
  },

  'connectives render their branches': async (assert) => {
    assert.strictEqual(
      describeFilterShape({
        on: personRef,
        every: [{ eq: { firstName: 'Mango' } }, { range: { age: { gt: 3 } } }],
      } as Filter),
      'on(http://localhost:4201/test/person/Person):every(eq(firstName),range(age:gt))',
    );
    assert.strictEqual(
      describeFilterShape({ not: { eq: { firstName: 'Mango' } } } as Filter),
      'not(eq(firstName))',
    );
  },

  'a node constraining nothing renders as *': async (assert) => {
    assert.strictEqual(describeFilterShape({} as Filter), '*');
  },

  'ancestor and field code refs render their derivation': async (assert) => {
    assert.strictEqual(
      describeFilterShape({ type: { type: 'ancestorOf', card: personRef } }),
      'type(http://localhost:4201/test/person/Person/ancestor)',
    );
    assert.strictEqual(
      describeFilterShape({
        type: { type: 'fieldOf', card: personRef, field: 'address' },
      }),
      'type(http://localhost:4201/test/person/Person/fields/address)',
    );
  },

  'structurally identical filters render identically however spelled': async (
    assert,
  ) => {
    let left = describeFilterShape({
      every: [
        { eq: { firstName: 'Mango', lastName: 'Abdel-Rahman' } },
        { range: { age: { gt: 3, lte: 9 } } },
      ],
    } as Filter);
    let right = describeFilterShape({
      every: [
        { range: { age: { lte: 100, gt: 0 } } },
        { eq: { lastName: 'Van Gogh', firstName: 'Paper' } },
      ],
    } as Filter);
    assert.strictEqual(
      left,
      right,
      'branch order, field order and operator order are canonicalized away',
    );
  },

  'sort renders in precedence order and is not canonicalized': async (
    assert,
  ) => {
    let sort: Sort = [
      { by: 'lastName', on: personRef, direction: 'desc' },
      { by: 'createdAt' },
    ] as Sort;
    assert.strictEqual(
      describeSortShape(sort),
      'http://localhost:4201/test/person/Person:lastName:desc,createdAt:asc',
    );
    assert.notStrictEqual(
      describeSortShape(sort),
      describeSortShape([...sort].reverse() as Sort),
      'reordering a sort list makes a different shape',
    );
    assert.strictEqual(describeSortShape([]), null);
    assert.strictEqual(describeSortShape(undefined), null);
  },

  'htmlQuery renders format and renderType': async (assert) => {
    assert.strictEqual(
      describeHtmlQuery({ eq: { format: 'fitted' } }),
      'eq(format=fitted)',
    );
    assert.strictEqual(
      describeHtmlQuery({
        any: [
          { eq: { format: 'embedded' } },
          { eq: { format: 'fitted', renderType: postRef } },
        ],
      }),
      'any(eq(format=embedded),eq(format=fitted,renderType=http://localhost:4201/test/post/Post))',
    );
  },

  'the descriptor reports the page, fieldset, scope and realms': async (
    assert,
  ) => {
    let shape = describeSearchShape({
      query: entryQuery({
        itemQuery: {
          filter: { type: personRef },
          page: { number: 2, size: 20, generation: 7 },
        },
        fieldset: {
          html: false,
          item: { kind: 'sparse', fields: ['title', 'firstName'] },
          itemAsFallback: false,
        },
        scope: 'cards',
        cardUrls: ['http://localhost:4201/test/mango'],
      }),
      realms: ['http://localhost:4201/test/', 'http://localhost:4201/other/'],
      correlationId: 'corr-1',
      jobId: '42.1',
      consumingRealm: 'http://localhost:4201/test/',
      jobPriority: 5,
    });
    assert.strictEqual(shape.pageSize, 20);
    assert.strictEqual(shape.pageNumber, 2);
    assert.true(shape.pageGeneration);
    assert.false(shape.html);
    assert.strictEqual(shape.item, 'sparse');
    assert.strictEqual(shape.itemFields, 'firstName,title');
    assert.strictEqual(shape.scope, 'cards');
    assert.strictEqual(shape.cardUrlCount, 1);
    assert.strictEqual(
      shape.realms,
      'http://localhost:4201/test/,http://localhost:4201/other/',
    );
    assert.strictEqual(shape.realmCount, 2);
    assert.strictEqual(shape.correlationId, 'corr-1');
    assert.strictEqual(shape.jobId, '42.1');
    assert.strictEqual(shape.consumingRealm, 'http://localhost:4201/test/');
    assert.strictEqual(shape.jobPriority, 5);
  },

  'the htmlQuery is reported only where the fieldset selects html': async (
    assert,
  ) => {
    assert.strictEqual(
      shapeOf({
        fieldset: { html: true, item: { kind: 'none' }, itemAsFallback: false },
      }).htmlQuery,
      'eq(format=fitted)',
    );
    assert.strictEqual(
      shapeOf({
        fieldset: {
          html: false,
          item: { kind: 'full' },
          itemAsFallback: false,
        },
      }).htmlQuery,
      null,
      'an unselected html branch makes the htmlQuery inert',
    );
  },

  'the shape hash folds the members that decide the work': async (assert) => {
    let base = shapeOf({ itemQuery: { filter: { type: personRef } } });
    assert.strictEqual(
      base.shapeHash,
      shapeOf({ itemQuery: { filter: { type: personRef } } }).shapeHash,
      'the same query hashes the same',
    );
    assert.notStrictEqual(
      base.shapeHash,
      shapeOf({ itemQuery: { filter: { type: postRef } } }).shapeHash,
      'a different type anchor is a different shape',
    );
    assert.notStrictEqual(
      base.shapeHash,
      shapeOf({
        itemQuery: { filter: { type: personRef }, page: { size: 100 } },
      }).shapeHash,
      'a different page size is a different shape',
    );
    assert.notStrictEqual(
      base.shapeHash,
      shapeOf({ itemQuery: { filter: { type: personRef } }, scope: 'files' })
        .shapeHash,
      'a different scope is a different shape',
    );
  },

  'the shape hash ignores what varies across requests of one query': async (
    assert,
  ) => {
    let filter: Filter = { type: personRef };
    let first = describeSearchShape({
      query: entryQuery({
        itemQuery: { filter, page: { number: 0, size: 20 } },
      }),
      realms: ['http://localhost:4201/test/'],
      correlationId: 'corr-1',
      jobId: '1.0',
      consumingRealm: 'http://localhost:4201/test/',
      jobPriority: 0,
    });
    let second = describeSearchShape({
      query: entryQuery({
        itemQuery: { filter, page: { number: 3, size: 20, generation: 9 } },
      }),
      realms: ['http://localhost:4201/other/', 'http://localhost:4201/test/'],
      correlationId: 'corr-2',
      jobId: '2.0',
      consumingRealm: 'http://localhost:4201/other/',
      jobPriority: 9,
    });
    assert.strictEqual(
      first.shapeHash,
      second.shapeHash,
      'page number, pinned generation, realms and request identity stay out',
    );
  },
} as SharedTests<{}>);

export default tests;
