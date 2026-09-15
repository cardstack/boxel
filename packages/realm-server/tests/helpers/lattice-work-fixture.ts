import { bxl, getBxlComputeDefinition } from '@cardstack/bxl';
import {
  internalKeyFor,
  isResolvedCodeRef,
  param,
  rri,
  type Definition,
  type DefinitionLookup,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { createLatticeNativeCardIndexer } from '../../lib/lattice-native-card-indexer.ts';
import { LatticeBxlWorker } from '../../lib/lattice-bxl-derivation.ts';
import { LatticeMaterializationInputs } from '../../lib/lattice-materialization-inputs.ts';
import { openLatticeNativeWork } from '../../lib/lattice-native-work.ts';

export const workRealms = [
  'https://lattice-work-queue.example/a/',
  'https://lattice-work-queue.example/b/',
];
export const workActor = '@reader:example';
export const workOwner = (realm: string) => realm + 'Dashboard/one.json';
export const workRef = (realm: string, name: string) => ({
  module: rri(realm + 'cards'),
  name,
});
export const workQuery = (realm: string) => ({
  filter: { type: workRef(realm, 'Record') },
  page: { size: 20 },
});
export const workSource = (realm: string, type = 'Dashboard') =>
  JSON.stringify({
    data: {
      type: 'card',
      attributes: {},
      meta: { adoptsFrom: workRef(realm, type) },
    },
  });

// Fixed reviewed definition artifacts isolate queue integration from GTS
// admission. Computation, query inputs and publication use the real Node path.
export function workDefinitions(realm: string): Definition[] {
  const number = {
    type: 'contains' as const,
    isPrimitive: true,
    isComputed: false,
    fieldOrCard: workRef(realm, 'Number'),
    nativeCodec: { kind: 'primitive' as const, serializer: 'number' as const },
    serializerName: 'number' as const,
  };
  const compute = (expression: string) => ({
    ...number,
    isComputed: true,
    bxl: getBxlComputeDefinition(
      bxl(expression, { readableSyntax: false, libraries: ['core'] }),
    )!,
  });
  const definitions: Definition[] = [
    {
      type: 'card-def',
      codeRef: workRef(realm, 'Record'),
      displayName: 'Record',
      fields: { amount: 'amount' },
      fieldDefs: { amount: number },
    },
    {
      type: 'card-def',
      codeRef: workRef(realm, 'Dashboard'),
      displayName: 'Dashboard',
      nativeCodec: { kind: 'compound', resourceType: 'card' },
      nativeIndex: {
        types: [workRef(realm, 'Dashboard')],
        displayNames: ['Dashboard'],
        cardType: 'Dashboard',
        materialized: true,
      },
      nativeQueryInputs: { members: {} },
      fields: { members: 'members', count: 'count', total: 'total' },
      fieldDefs: {
        members: {
          type: 'linksToMany',
          isComputed: false,
          isPrimitive: false,
          fieldOrCard: workRef(realm, 'Record'),
          nativeCodec: { kind: 'compound', resourceType: 'card' },
          query: workQuery(realm),
        },
        count: compute('.members | length'),
        total: compute('[.members[].amount] | add // 0'),
      },
    },
  ];
  const dashboard = definitions[1];
  definitions.push({
    ...dashboard,
    codeRef: workRef(realm, 'TruncatedDashboard'),
    fieldDefs: {
      ...dashboard.fieldDefs,
      members: {
        ...dashboard.fieldDefs!.members,
        query: { ...workQuery(realm), page: { size: 1 } },
      },
    },
  });
  return definitions;
}

export function workExecution(db: PgAdapter, network: VirtualNetwork) {
  const worker = new LatticeBxlWorker();
  const definitions = new Map(
    workRealms
      .flatMap((realm) => workDefinitions(realm))
      .map((definition) => [
        internalKeyFor(definition.codeRef, undefined, network),
        definition,
      ]),
  );
  const lookup = {
    forRealm() {
      return this;
    },
    async lookupDefinition(
      ref: Parameters<DefinitionLookup['lookupDefinition']>[0],
    ) {
      // Generated concrete-input watches filter CardDef.id. The fixture needs
      // that indexed base-field shape too, without fetching a module for it.
      if (
        isResolvedCodeRef(ref) &&
        ref.module === '@cardstack/base/card-api' &&
        ref.name === 'CardDef'
      ) {
        return {
          type: 'card-def',
          codeRef: ref,
          displayName: 'Card',
          fields: { id: 'id' },
          fieldDefs: {
            id: {
              type: 'contains',
              isPrimitive: true,
              isComputed: false,
              fieldOrCard: {
                module: rri('@cardstack/base/string'),
                name: 'default',
              },
            },
          },
        } satisfies Definition;
      }
      const definition = definitions.get(
        internalKeyFor(ref, undefined, network),
      );
      if (!definition) throw new Error('Unknown queue fixture definition');
      return definition;
    },
  } as unknown as DefinitionLookup;
  const indexer = createLatticeNativeCardIndexer({
    worker,
    admit: async (request) => ({
      root: {
        definition: (await lookup.lookupDefinition(
          JSON.parse(request.sourceJSON).data.meta.adoptsFrom,
        )) as Definition,
        revision: 'fixture-v1',
      },
      lookup: async (ref) => {
        if (!isResolvedCodeRef(ref))
          throw new Error('Queue fixture uses exported definitions');
        return {
          definition: (await lookup.lookupDefinition(ref)) as Definition,
          revision: 'fixture-v1',
        };
      },
      resolve: (ref, base) => new URL(ref, base).href,
      relative: (ref) => ref,
      typeKey: (ref) => internalKeyFor(ref, undefined, network),
      deps: [request.realmURL + 'cards'],
      runtimeRevision: 'fixture-v1',
      inputActor: workActor,
      assertCurrent: async (tx) => {
        const rows = await tx([
          'SELECT loader_epoch FROM realm_generations WHERE realm_url=',
          param(request.realmURL),
          'FOR SHARE',
        ]);
        if (rows[0]?.loader_epoch !== request.loaderEpoch)
          throw new Error('Fixture code revision changed');
      },
    }),
    openWork: (request, admission) =>
      openLatticeNativeWork(db, request, admission),
    openInputs: (request, _admission, signal) =>
      LatticeMaterializationInputs.open({
        db,
        network,
        realmURL: request.realmURL,
        actor: workActor,
        generation: request.inputSnapshot!.generation,
        loaderEpoch: request.loaderEpoch,
        lookup,
        signal,
      }),
  });
  return { worker, lookup, indexer };
}
