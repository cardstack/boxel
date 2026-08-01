import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  classifyBxlProfileFunction,
  prepareAuthorizationModelSafe,
  prepareNativeJq,
  type BxlAuthorizationModel,
  type RelationshipTuple,
} from '../../src/index.js';

deepStrictEqual(classifyBxlProfileFunction('derive', 'auth_check'), {
  safety: 'allow',
  normalizedName: 'AUTH_CHECK',
  category: 'authorization',
});
strictEqual(
  classifyBxlProfileFunction('policy', 'auth_check').safety,
  'deny',
  'tuple conditions cannot recursively call the authorization kernel',
);
strictEqual(
  classifyBxlProfileFunction('authorization', 'auth_check').safety,
  'deny',
  'authorization rewrites cannot recursively call the authorization kernel',
);
strictEqual(
  classifyBxlProfileFunction('authorization', 'userset').safety,
  'allow',
  'authorization rewrites can use relationship-graph calls',
);

const model: BxlAuthorizationModel = {
  schema: 'bxl-authorization/1',
  types: {
    user: {},
    group: {
      relations: {
        member: ['user', 'user:*'],
      },
    },
    document: {
      relations: {
        editor: ['user'],
        banned: ['user'],
        parent: ['group'],
        viewer: {
          subjects: ['user', 'user:*'],
          rewrite:
            'except(direct() or userset("editor") or userset_from("parent"; "member"); userset("banned"))',
        },
      },
    },
  },
};

const tuples: RelationshipTuple[] = [
  { subject: 'user:*', relation: 'viewer', object: 'document:public' },
  { subject: 'user:direct', relation: 'viewer', object: 'document:public' },
  { subject: 'user:blocked', relation: 'banned', object: 'document:public' },
  { subject: 'user:editor', relation: 'editor', object: 'document:private' },
  { subject: 'group:staff', relation: 'parent', object: 'document:private' },
  { subject: 'user:member', relation: 'member', object: 'group:staff' },
];

const prepared = prepareAuthorizationModelSafe(model, tuples);
strictEqual(prepared.ok, true);
if (!prepared.ok) throw new Error(prepared.error.message);

const publicUsers = prepared.value.listUsers({
  object: 'document:public',
  relation: 'viewer',
  filters: ['user'],
});
strictEqual(publicUsers.ok, true);
if (publicUsers.ok) {
  deepStrictEqual(publicUsers.value.users, ['user:*', 'user:direct']);
}

const privateUsers = prepared.value.listUsers({
  object: 'document:private',
  relation: 'viewer',
  filters: ['user', 'group#member'],
});
strictEqual(privateUsers.ok, true);
if (privateUsers.ok) {
  deepStrictEqual(privateUsers.value.users, [
    'group:staff#member',
    'user:editor',
    'user:member',
  ]);
}

const objects = prepared.value.listObjects({
  subject: 'user:member',
  type: 'document',
  relation: 'viewer',
});
strictEqual(objects.ok, true);
if (objects.ok) {
  deepStrictEqual(objects.value.objects, ['document:private', 'document:public']);
}

const candidateLimited = prepared.value.listObjects({
  subject: 'user:member',
  type: 'document',
  relation: 'viewer',
  limits: { maxCandidates: 1 },
});
strictEqual(candidateLimited.ok, false);
if (!candidateLimited.ok) {
  strictEqual(candidateLimited.error.kind, 'evaluation-limit-exceeded');
}

const resultLimited = prepared.value.listUsers({
  object: 'document:private',
  relation: 'viewer',
  filters: ['user'],
  limits: { maxResults: 1 },
});
strictEqual(resultLimited.ok, false);
if (!resultLimited.ok) {
  strictEqual(resultLimited.error.kind, 'evaluation-limit-exceeded');
}

const stepLimited = prepared.value.listUsers({
  object: 'document:private',
  relation: 'viewer',
  filters: ['user'],
  limits: { maxSteps: 1 },
});
strictEqual(stepLimited.ok, false);
if (!stepLimited.ok) {
  strictEqual(stepLimited.error.kind, 'evaluation-limit-exceeded');
}

const checkProgram = prepareNativeJq(
  'auth_check(.model; .tuples; .request)',
  { libraries: ['core', 'authorization'], readableSyntax: false },
);
deepStrictEqual(
  checkProgram.run({
    model,
    tuples,
    request: {
      subject: 'user:member',
      relation: 'viewer',
      object: 'document:private',
    },
  }).outputs,
  [true],
);
deepStrictEqual(
  checkProgram.run({
    model,
    tuples,
    request: {
      subject: 'missing:member',
      relation: 'viewer',
      object: 'document:private',
    },
  }).outputs,
  [false],
  'auth_check fails closed on invalid requests',
);

const structuredProgram = prepareNativeJq(
  'auth_check_result(.model; .tuples; .request)',
  { libraries: ['core', 'authorization'], readableSyntax: false },
);
const structured = structuredProgram.run({
  model,
  tuples,
  request: {
    subject: 'user:blocked',
    relation: 'viewer',
    object: 'document:public',
    trace: true,
  },
}).outputs[0] as { ok: boolean; value: { allowed: boolean; trace: unknown[] } };
strictEqual(structured.ok, true);
strictEqual(structured.value.allowed, false);
strictEqual(structured.value.trace.length > 0, true);

const listProgram = prepareNativeJq(
  'auth_list_users(.model; .tuples; .request)',
  { libraries: ['core', 'authorization'], readableSyntax: false },
);
const listed = listProgram.run({
  model,
  tuples,
  request: {
    object: 'document:private',
    relation: 'viewer',
    filters: ['user'],
  },
}).outputs[0] as { ok: boolean; value: { users: string[] } };
strictEqual(listed.ok, true);
deepStrictEqual(listed.value.users, ['user:editor', 'user:member']);

const listObjectsProgram = prepareNativeJq(
  'auth_list_objects(.model; .tuples; .request)',
  { libraries: ['core', 'authorization'], readableSyntax: false },
);
const listedObjects = listObjectsProgram.run({
  model,
  tuples,
  request: {
    subject: 'user:member',
    type: 'document',
    relation: 'viewer',
  },
}).outputs[0] as { ok: boolean; value: { objects: string[] } };
strictEqual(listedObjects.ok, true);
deepStrictEqual(listedObjects.value.objects, [
  'document:private',
  'document:public',
]);

console.log(
  'Authorization runtime: direct API, list algebra, fail-closed and structured BXL builtins passed',
);
