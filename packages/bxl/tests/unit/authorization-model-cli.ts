import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  prepareAuthorizationGraphSafe,
  type AuthorizationGraphModel,
} from '../../src/authorization/index.ts';

const model: AuthorizationGraphModel = {
  schema: 'bxl-authorization-ir/1',
  types: {
    party: {},
    team: {
      relations: {
        operator: ['party'],
      },
    },
    workflow: {
      relations: {
        owner: ['party'],
        operator: ['party'],
        participant: ['party'],
        blocked: ['party'],
        team: ['team'],
        actors: {
          subjects: ['party'],
          rewrite: 'direct() or userset("operator") or userset("participant")',
        },
      },
      permissions: {
        can_invoke:
          'except(userset("owner") or userset("actors"); userset("blocked"))',
        can_use_team_capability: 'userset_from("team"; "operator")',
      },
    },
  },
};

const prepared = prepareAuthorizationGraphSafe(model, [
  {
    subject: 'party:alice',
    relation: 'owner',
    object: 'workflow:6',
  },
  {
    subject: 'team:operations',
    relation: 'team',
    object: 'workflow:6',
  },
]);

if (!prepared.ok) throw new Error(prepared.error.message);

const workflow = prepared.value.model.types.get('workflow')!;
strictEqual(workflow.relations.get('owner')?.expression.kind, 'direct');
strictEqual(workflow.relations.get('actors')?.expression.kind, 'union');
strictEqual(
  workflow.relations.get('can_invoke')?.expression.kind,
  'difference',
);
deepStrictEqual(
  prepared.value.tupleIndex
    .forObjectRelation('workflow:6', 'owner')
    .map((tuple) => tuple.subject),
  ['party:alice'],
);
deepStrictEqual(
  [...(prepared.value.tupleIndex.objectsByType.get('workflow') ?? [])],
  ['workflow:6'],
);

const mixedPredicate = prepareAuthorizationGraphSafe({
  schema: 'bxl-authorization-ir/1',
  types: {
    user: {},
    document: {
      relations: { viewer: ['user'] },
      permissions: {
        active_viewer: 'userset("viewer") and (.context.active == true)',
      },
    },
  },
});
strictEqual(mixedPredicate.ok, true);
if (mixedPredicate.ok) {
  const expression = mixedPredicate.value.model.types
    .get('document')!
    .relations.get('active_viewer')!.expression;
  strictEqual(expression.kind, 'intersection');
  if (expression.kind === 'intersection') {
    deepStrictEqual(
      expression.children.map((child) => child.kind),
      ['computed', 'predicate'],
    );
  }

  const active = mixedPredicate.value.check({
    subject: 'user:alice',
    relation: 'active_viewer',
    object: 'document:1',
    context: { active: true },
    contextualTuples: [
      { subject: 'user:alice', relation: 'viewer', object: 'document:1' },
    ],
  });
  strictEqual(active.ok, true);
  if (active.ok) strictEqual(active.value.allowed, true);

  const inactive = mixedPredicate.value.check({
    subject: 'user:alice',
    relation: 'active_viewer',
    object: 'document:1',
    context: { active: false },
    contextualTuples: [
      { subject: 'user:alice', relation: 'viewer', object: 'document:1' },
    ],
  });
  strictEqual(inactive.ok, true);
  if (inactive.ok) strictEqual(inactive.value.allowed, false);

  const activeUsers = mixedPredicate.value.listUsers({
    object: 'document:1',
    relation: 'active_viewer',
    filters: ['user'],
    context: { active: true },
    contextualTuples: [
      { subject: 'user:alice', relation: 'viewer', object: 'document:1' },
    ],
  });
  strictEqual(activeUsers.ok, true);
  if (activeUsers.ok) deepStrictEqual(activeUsers.value.users, ['user:alice']);

  const inactiveUsers = mixedPredicate.value.listUsers({
    object: 'document:1',
    relation: 'active_viewer',
    filters: ['user'],
    context: { active: false },
    contextualTuples: [
      { subject: 'user:alice', relation: 'viewer', object: 'document:1' },
    ],
  });
  strictEqual(inactiveUsers.ok, true);
  if (inactiveUsers.ok) deepStrictEqual(inactiveUsers.value.users, []);
}

const dynamicUserset = prepareAuthorizationGraphSafe({
  schema: 'bxl-authorization-ir/1',
  types: {
    user: {},
    document: {
      relations: { viewer: ['user'] },
      permissions: { dynamic: 'userset(.context.relation)' },
    },
  },
});
strictEqual(dynamicUserset.ok, false);
if (!dynamicUserset.ok)
  strictEqual(dynamicUserset.error.kind, 'invalid-expression');

const unknownRelation = prepareAuthorizationGraphSafe({
  schema: 'bxl-authorization-ir/1',
  types: {
    user: {},
    document: {
      permissions: { viewer: 'userset("missing")' },
    },
  },
});
strictEqual(unknownRelation.ok, false);
if (!unknownRelation.ok)
  strictEqual(unknownRelation.error.kind, 'unknown-relation');

const invalidTuple = prepareAuthorizationGraphSafe(model, [
  {
    subject: 'team:operations',
    relation: 'owner',
    object: 'workflow:6',
  },
]);
strictEqual(invalidTuple.ok, false);
if (!invalidTuple.ok) strictEqual(invalidTuple.error.kind, 'invalid-tuple');

console.log(
  'Authorization model: BXL graph AST lowering, validation, and tuple indexes passed',
);
