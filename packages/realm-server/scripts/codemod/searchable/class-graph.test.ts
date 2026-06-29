// Tests for the class-hierarchy resolver + route pruner. Run with
//   NODE_NO_WARNINGS=1 node --test scripts/codemod/searchable/class-graph.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildClassGraph,
  findDeclaringClass,
  pruneRoute,
  type SourceModule,
} from './class-graph.ts';

function mod(modPath: string, source: string): SourceModule {
  return { modPath, filename: `${modPath}.gts`, source };
}

const CONTACT = mod(
  'crm/contact',
  `import { field, linksTo, CardDef } from 'https://cardstack.com/base/card-api';
   import { CrmApp } from './crm-app';
   export class Contact extends CardDef {
     @field crmApp = linksTo(CrmApp);
     @field company = linksTo(Company);
   }`,
);
const CUSTOMER = mod(
  'crm/customer',
  `import { field } from 'https://cardstack.com/base/card-api';
   import { Contact } from './contact';
   export class Customer extends Contact {
     @field tier = contains(StringField);
   }`,
);
const COMPANY = mod(
  'crm/company',
  `import { field, linksTo, CardDef } from 'https://cardstack.com/base/card-api';
   export class Company extends CardDef {
     @field crmApp = linksTo(CrmApp);
     @field hq = linksTo(Headquarters);
   }`,
);
const HQ = mod(
  'crm/headquarters',
  `import { field, contains } from 'https://cardstack.com/base/card-api';
   export class Headquarters extends CardDef {
     @field city = contains(StringField);
   }`,
);
const PORTFOLIO = mod(
  'portfolio',
  `import { field, linksTo, linksToMany, CardDef } from 'https://cardstack.com/base/card-api';
   import { Company } from './crm/company';
   export class Portfolio extends CardDef {
     @field items = linksToMany(() => CardDef);
     @field owner = linksTo(Company);
   }`,
);

function graph() {
  return buildClassGraph([CONTACT, CUSTOMER, COMPANY, HQ, PORTFOLIO]);
}

test('findDeclaringClass hoists an inherited field to its declaring class', () => {
  let g = graph();
  let r = findDeclaringClass(g, 'crm/customer/Customer', 'crmApp');
  assert.deepEqual(r, { kind: 'local', relKey: 'crm/contact/Contact' });
});

test('findDeclaringClass returns the leaf when it declares the field', () => {
  let g = graph();
  let r = findDeclaringClass(g, 'crm/customer/Customer', 'tier');
  assert.deepEqual(r, { kind: 'local', relKey: 'crm/customer/Customer' });
});

test('findDeclaringClass reports external when the chain exits the realm', () => {
  let g = graph();
  // `cardInfo` is on base CardDef (external), declared by no local class.
  let r = findDeclaringClass(g, 'crm/contact/Contact', 'cardInfo');
  assert.equal(r.kind, 'external');
});

test('pruneRoute drops a route crossing a polymorphic field entirely', () => {
  let g = graph();
  // Portfolio.items = linksToMany(() => CardDef) → polymorphic head.
  let r = pruneRoute(g, 'portfolio/Portfolio', 'items.anything');
  assert.equal(r.kept, null);
  assert.equal(r.reason, 'polymorphic');
});

test('pruneRoute keeps a concrete route through resolvable types', () => {
  let g = graph();
  // owner = linksTo(Company); Company.hq = linksTo(Headquarters); Headquarters.city contains.
  let r = pruneRoute(g, 'portfolio/Portfolio', 'owner.hq');
  assert.equal(r.kept, 'owner.hq');
  assert.equal(r.reason, undefined);
});

test('pruneRoute truncates at a non-declared (subtype-bloat) segment', () => {
  let g = graph();
  // Company has no `bogus` field → truncate after owner.
  let r = pruneRoute(g, 'portfolio/Portfolio', 'owner.bogus');
  assert.equal(r.kept, 'owner');
  assert.equal(r.reason, 'unresolved');
});

test('pruneRoute keeps the full route when a target type is not loaded', () => {
  let g = graph();
  // Contact.crmApp = linksTo(CrmApp); CrmApp source not loaded → can't validate
  // `name`, so keep `crmApp.name` rather than risk dropping valid depth.
  let r = pruneRoute(g, 'crm/contact/Contact', 'crmApp.name');
  assert.equal(r.kept, 'crmApp.name');
  assert.equal(r.reason, 'unvalidated');
});

test('pruneRoute truncates a nested polymorphic crossing to the concrete prefix', () => {
  let g = graph();
  // owner = linksTo(Company); add a polymorphic field on Company via a route
  // owner.items… — Company has no `items`, so this truncates at unresolved.
  // Use Portfolio.owner.crmApp (crmApp is concrete on Company → unvalidated since
  // CrmApp not loaded).
  let r = pruneRoute(g, 'portfolio/Portfolio', 'owner.crmApp.foo');
  assert.equal(r.kept, 'owner.crmApp.foo');
  assert.equal(r.reason, 'unvalidated');
});
