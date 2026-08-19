import { ok, strictEqual } from 'node:assert';
import {
  inAuthorizationLibraries,
  jqCases,
  type CoverageCase,
} from './case.ts';

// A two-type model: group membership feeds document viewing, and an explicit
// `banned` relation subtracts from it — enough shape for every list and check
// builtin to have something non-trivial to resolve.
const authorizationInput = {
  model: {
    schema: 'bxl-authorization-ir/1',
    types: {
      user: {},
      group: { relations: { member: ['user'] } },
      document: {
        relations: {
          banned: ['user'],
          parent: ['group'],
          viewer: {
            subjects: ['user'],
            rewrite:
              'except(direct() or userset_from("parent"; "member"); userset("banned"))',
          },
        },
      },
    },
  },
  tuples: [
    { subject: 'group:staff', relation: 'parent', object: 'document:private' },
    { subject: 'user:member', relation: 'member', object: 'group:staff' },
    { subject: 'user:blocked', relation: 'member', object: 'group:staff' },
    { subject: 'user:blocked', relation: 'banned', object: 'document:private' },
  ],
};

export const authorizationCases: CoverageCase[] = jqCases([
  {
    covers: 'auth_check/3',
    source:
      'auth_check(.model; .tuples; {subject: "user:member", relation: "viewer", object: "document:private"})',
    input: authorizationInput,
    expected: true,
  },
  {
    covers: 'auth_check/3',
    source:
      'auth_check(.model; .tuples; {subject: "user:blocked", relation: "viewer", object: "document:private"})',
    input: authorizationInput,
    expected: false,
  },
  {
    covers: 'auth_check_result/3',
    source:
      'auth_check_result(.model; .tuples; {subject: "user:member", relation: "viewer", object: "document:private", trace: true})',
    input: authorizationInput,
    check(outputs) {
      const result = outputs[0] as {
        ok: boolean;
        value: { allowed: boolean; trace: unknown[] };
      };
      strictEqual(result.ok, true);
      strictEqual(result.value.allowed, true);
      ok(result.value.trace.length > 0, 'a traced check explains itself');
    },
  },
  {
    covers: 'auth_list_users/3',
    source:
      'auth_list_users(.model; .tuples; {object: "document:private", relation: "viewer", filters: ["user"]})',
    input: authorizationInput,
    check(outputs) {
      const result = outputs[0] as { ok: boolean; value: { users: string[] } };
      strictEqual(result.ok, true);
      strictEqual(result.value.users.join(','), 'user:member');
    },
  },
  {
    covers: 'auth_list_objects/3',
    source:
      'auth_list_objects(.model; .tuples; {subject: "user:member", type: "document", relation: "viewer"})',
    input: authorizationInput,
    check(outputs) {
      const result = outputs[0] as {
        ok: boolean;
        value: { objects: string[] };
      };
      strictEqual(result.ok, true);
      strictEqual(result.value.objects.join(','), 'document:private');
    },
  },
  {
    covers: 'ip_in_cidr/2',
    source: 'ip_in_cidr("10.1.2.3"; "10.1.0.0/16")',
    expected: true,
  },
  {
    covers: 'ip_in_cidr/2',
    source: 'ip_in_cidr("10.2.2.3"; "10.1.0.0/16")',
    expected: false,
  },
]).map(inAuthorizationLibraries);
