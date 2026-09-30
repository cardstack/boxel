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
// through `state.reads`, `state.lookups` and `state.revisits`.
export interface StubPolicyState {
  version: string;
  fields: Record<string, string>;
  // What the card's `rules` holds, in place of the one rule, while set.
  rules: unknown;
  // Whether the card's latest index visit failed with the failure kept off
  // its row.
  failureWithheld: boolean;
  // Thrown by the next definition lookups while set.
  lookupFailure: Error | undefined;
  // Awaited by the next card reads while set.
  readGate: Promise<void> | undefined;
  // Awaited by the next visits the cache asks for while set, so a test can
  // act while a visit is still running.
  revisitGate: Promise<void> | undefined;
  // What a visit the cache asks for does once it runs, standing in for what
  // the visit's commit would change. A visit does nothing while unset.
  onRevisit: (() => void) | undefined;
  reads: number;
  lookups: number;
  // Every visit the cache asked for, as the file and the realm it named.
  revisits: { file: string; realmURL: string }[];
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
    rules: undefined,
    failureWithheld: false,
    lookupFailure: undefined,
    readGate: undefined,
    revisitGate: undefined,
    onRevisit: undefined,
    reads: 0,
    lookups: 0,
    revisits: [],
  };
  let typeKey = (ref: ResolvedCodeRef) => `${ref.module}/${ref.name}`;
  let policyKey = typeKey(realmPolicyRef);
  let cache = new RealmPolicyCache({
    policyCard: async () => card,
    readCard: async (): Promise<IndexedInstanceSource> => {
      state.reads++;
      await state.readGate;
      return {
        url: `${card}.json`,
        realmURL: orgURL,
        generation: 1,
        sourceContentHash: state.version,
        types: [policyKey],
        error: null,
        failureWithheld: state.failureWithheld,
        instance: {
          id: rri(card),
          type: 'card',
          attributes: {
            rules: state.rules ?? [
              {
                targetType: { module: classroom.module, name: 'Classroom' },
                grants: [
                  {
                    operation: 'read',
                    where: '.teacherIds | any(. == actor())',
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
    lookupDefinitionEntry: async () => {
      state.lookups++;
      if (state.lookupFailure) {
        throw state.lookupFailure;
      }
      let definition: Definition = {
        type: 'card-def',
        codeRef: classroom,
        displayName: 'Classroom',
        fields: { ...state.fields },
        fieldDefs: {},
      };
      return { definition, types: [typeKey(classroom)] };
    },
    toURL: (identifier) => new URL(identifier),
    isPolicyCard: (types) => types.includes(policyKey),
    typeKey,
    revisitCard: async (file, realmURL) => {
      state.revisits.push({ file, realmURL });
      // Settles on a later turn, as a queued visit does.
      await (state.revisitGate ?? Promise.resolve());
      state.onRevisit?.();
    },
  });
  return { cache, state, card };
}
