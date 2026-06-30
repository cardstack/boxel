// Unit tests for the schema-free search-doc → `searchable` derivation.
// Pure logic, no DB / stack: run with
//   NODE_NO_WARNINGS=1 node --test scripts/codemod/searchable/derive.test.ts
// from packages/realm-server.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  routesForSearchDoc,
  routesToFieldSearchable,
  DerivationAccumulator,
} from './derive.ts';

// Convenience: derive the per-field Searchable for a single search doc.
function deriveOne(doc: unknown): Record<string, unknown> {
  return routesToFieldSearchable(routesForSearchDoc(doc));
}

test('scalar + contained fields produce no annotations', () => {
  let doc = {
    id: 'http://r/Card/1',
    title: 'hello',
    count: 3,
    flag: true,
    nothing: null,
    cardInfo: { name: 'X', notes: null, theme: null }, // contains, no id
  };
  assert.deepEqual(deriveOne(doc), {});
});

test('{id}-only link → no annotation (shallow default reproduces it)', () => {
  let doc = {
    id: 'http://r/Card/1',
    author: { id: 'http://r/Author/1' },
  };
  assert.deepEqual(deriveOne(doc), {});
});

test('{id, _meta}-only link is still treated as shallow', () => {
  let doc = {
    id: 'http://r/Card/1',
    author: { id: 'http://r/Author/1', _cardType: 'Author' },
  };
  assert.deepEqual(deriveOne(doc), {});
});

test('expanded link with no deeper links → searchable: true (self)', () => {
  let doc = {
    id: 'http://r/Card/1',
    author: {
      id: 'http://r/Author/1',
      name: 'Jane',
      bio: 'writer',
      address: { id: 'http://r/Address/1' }, // {id}-only: not deeper
    },
  };
  assert.deepEqual(deriveOne(doc), { author: true });
});

test('expanded link with a deeper expanded link → dotted path', () => {
  let doc = {
    id: 'http://r/Card/1',
    author: {
      id: 'http://r/Author/1',
      name: 'Jane',
      address: { id: 'http://r/Address/1', city: 'NYC' }, // expanded
    },
  };
  assert.deepEqual(deriveOne(doc), { author: 'address' });
});

test('two-level deep route through links', () => {
  let doc = {
    id: 'http://r/Claim/1',
    policy: {
      id: 'http://r/Policy/1',
      policyId: 'P1',
      customer: { id: 'http://r/Customer/1', name: 'Acme' }, // expanded
      territory: { id: 'http://r/Territory/1' }, // {id}-only
    },
  };
  // policy is expanded AND policy.customer is expanded → route policy.customer.
  // The bare-self route on policy is subsumed by the deeper route.
  assert.deepEqual(deriveOne(doc), { policy: 'customer' });
});

test('multiple deeper routes through one link → sorted array', () => {
  let doc = {
    id: 'http://r/Claim/1',
    policy: {
      id: 'http://r/Policy/1',
      underwriter: { id: 'http://r/UW/1', name: 'U' }, // expanded
      customer: { id: 'http://r/Customer/1', name: 'C' }, // expanded
      territory: { id: 'http://r/Territory/1' }, // {id}-only
    },
  };
  assert.deepEqual(deriveOne(doc), {
    policy: ['customer', 'underwriter'],
  });
});

test('route through a contained composite to reach a deeper link', () => {
  let doc = {
    id: 'http://r/Article/1',
    // contains(Signoff): no id, always present; its `editor` link is expanded.
    signOff: {
      note: 'lgtm',
      editor: { id: 'http://r/Editor/1', name: 'Ed' },
    },
  };
  assert.deepEqual(deriveOne(doc), { signOff: 'editor' });
});

test('contained composite whose links are {id}-only → no annotation', () => {
  let doc = {
    id: 'http://r/Article/1',
    signOff: {
      note: 'lgtm',
      editor: { id: 'http://r/Editor/1' }, // {id}-only
    },
  };
  assert.deepEqual(deriveOne(doc), {});
});

test('linksToMany: any expanded slot, no deeper → searchable: true', () => {
  let doc = {
    id: 'http://r/Card/1',
    authors: [
      { id: 'http://r/Author/1', name: 'A' }, // expanded
      { id: 'http://r/Author/2' }, // {id}-only
    ],
  };
  assert.deepEqual(deriveOne(doc), { authors: true });
});

test('linksToMany: all slots {id}-only → no annotation', () => {
  let doc = {
    id: 'http://r/Card/1',
    authors: [{ id: 'http://r/Author/1' }, { id: 'http://r/Author/2' }],
  };
  assert.deepEqual(deriveOne(doc), {});
});

test('linksToMany with deeper expanded link → dotted path', () => {
  let doc = {
    id: 'http://r/Card/1',
    authors: [
      {
        id: 'http://r/Author/1',
        address: { id: 'http://r/Address/1', city: 'NYC' },
      },
    ],
  };
  assert.deepEqual(deriveOne(doc), { authors: 'address' });
});

test('empty / null plural arrays carry no signal', () => {
  assert.deepEqual(deriveOne({ id: 'x', authors: [] }), {});
  assert.deepEqual(deriveOne({ id: 'x', authors: null }), {});
  assert.deepEqual(deriveOne({ id: 'x', tags: ['a', 'b'] }), {}); // containsMany primitive
});

test('containsMany of composites routes through to deeper links, unioned', () => {
  let doc = {
    id: 'http://r/Card/1',
    citations: [
      { note: 'a', article: { id: 'http://r/Article/1', title: 'T' } }, // expanded
      { note: 'b', article: { id: 'http://r/Article/2' } }, // {id}-only
    ],
  };
  assert.deepEqual(deriveOne(doc), { citations: 'article' });
});

test('union across instances takes the maximal observed depth', () => {
  let acc = new DerivationAccumulator();
  let realm = 'http://r/';
  let def = 'http://r/policy/Policy';
  // instance 1: customer shallow ({id}), territory expanded(self)
  acc.add(def, realm, {
    id: 'http://r/Policy/1',
    customer: { id: 'http://r/Customer/1' },
    territory: { id: 'http://r/Territory/1', name: 'T' },
  });
  // instance 2: customer expanded with a deeper link, territory {id}-only
  acc.add(def, realm, {
    id: 'http://r/Policy/2',
    customer: {
      id: 'http://r/Customer/2',
      region: { id: 'http://r/Region/1', code: 'EU' },
    },
    territory: { id: 'http://r/Territory/2' },
  });
  let results = acc.results();
  assert.equal(results.length, 1);
  assert.equal(results[0].defKey, def);
  assert.equal(results[0].instanceCount, 2);
  // union: customer gains the deeper 'region' route; territory keeps self.
  assert.deepEqual(results[0].fields, {
    customer: 'region',
    territory: true,
  });
});

test('cycle-clipped link (stored as {id}) reads as shallow', () => {
  // The generator clips cycles to { id }; the codemod sees only { id } and
  // emits no annotation — reproduced by the shallow default.
  let doc = {
    id: 'http://r/Node/1',
    next: {
      id: 'http://r/Node/2',
      label: 'b',
      next: { id: 'http://r/Node/1' },
    },
  };
  // next is expanded; next.next is {id}-only (clipped) → route is just `next`.
  assert.deepEqual(deriveOne(doc), { next: true });
});

test('accumulator reports which defs have instances', () => {
  let acc = new DerivationAccumulator();
  acc.add('http://r/a/A', 'http://r/', { id: 'http://r/A/1' });
  assert.equal(acc.hasInstances('http://r/a/A'), true);
  assert.equal(acc.hasInstances('http://r/b/B'), false);
});
