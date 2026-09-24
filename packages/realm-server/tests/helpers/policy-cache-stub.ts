import {
  realmPolicyRef,
  rri,
  type Definition,
  type IndexedInstanceSource,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { RealmPolicyCache } from '@cardstack/runtime-common/card-operations';

// A `RealmPolicyCache` over an environment held in memory, for suites that
// drive the cache's own logic without a realm, a database or a prerender.
//
// The policy card is `${orgURL}policies/education`. It has one rule, for a
// `Classroom` in `${educationURL}classroom`, with one grant. A test changes
// what the environment answers through `state`, and reads what the cache did
// through `state.reads` and `state.lookups`.
export interface StubPolicyState {
  version: string;
  fields: Record<string, string>;
  // Thrown by the next definition lookups while set.
  lookupFailure: Error | undefined;
  // Awaited by the next card reads while set.
  readGate: Promise<void> | undefined;
  reads: number;
  lookups: number;
}

export function stubPolicyCache({
  orgURL,
  educationURL,
}: {
  orgURL: string;
  educationURL: string;
}): { cache: RealmPolicyCache; state: StubPolicyState; card: string } {
  let card = `${orgURL}policies/education`;
  let classroom: ResolvedCodeRef = {
    module: rri(`${educationURL}classroom`),
    name: 'Classroom',
  };
  let state: StubPolicyState = {
    version: 'v1',
    fields: { teacherIds: 'contains' },
    lookupFailure: undefined,
    readGate: undefined,
    reads: 0,
    lookups: 0,
  };
  let policyKey = `${realmPolicyRef.module}/${realmPolicyRef.name}`;
  let cache = new RealmPolicyCache({
    policyCard: async () => card,
    readCard: async (): Promise<IndexedInstanceSource> => {
      state.reads++;
      await state.readGate;
      return {
        realmURL: orgURL,
        generation: 1,
        sourceContentHash: state.version,
        types: [policyKey],
        error: null,
        instance: {
          id: rri(card),
          type: 'card',
          attributes: {
            rules: [
              {
                targetType: { module: classroom.module, name: 'Classroom' },
                grants: [
                  {
                    operation: 'read',
                    where: '.teacherIds | contains(actor())',
                  },
                ],
              },
            ],
          },
          meta: { adoptsFrom: realmPolicyRef },
        },
      };
    },
    resolveCodeRef: (codeRef) =>
      codeRef.module === classroom.module && codeRef.name === classroom.name
        ? classroom
        : undefined,
    lookupDefinition: async (): Promise<Definition> => {
      state.lookups++;
      if (state.lookupFailure) {
        throw state.lookupFailure;
      }
      return {
        type: 'card-def',
        codeRef: classroom,
        displayName: 'Classroom',
        fields: { ...state.fields },
        fieldDefs: {},
      };
    },
    toURL: (identifier) => new URL(identifier),
    isPolicyCard: (types) => types.includes(policyKey),
  });
  return { cache, state, card };
}
