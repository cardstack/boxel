import {
  startLatticeTrace,
  latticeAttemptId,
  type LatticeTrace,
} from '@cardstack/runtime-common/lattice-trace';
import type { LatticeProjectionWhere } from '@cardstack/runtime-common/definitions';
import { createHash } from 'node:crypto';
import type { CodeRef, RenderResponse } from '@cardstack/runtime-common';
import { isSingleCardDocument } from '@cardstack/runtime-common/card-document-shape';
import type { Querier } from '@cardstack/runtime-common/expression';
import type {
  LatticeNativeCardIndexer,
  LatticeNativeCardIndexRequest,
  LatticeNativeCardIndexResult,
  LatticeInputStageTiming,
} from '@cardstack/runtime-common/lattice-native-index';
import { latticeSourceFields } from '@cardstack/runtime-common/lattice-query-readiness';
import {
  extractLatticeJsonFile,
  type LatticeNativeFileAdmission,
} from './lattice-native-file.ts';
import { assembleLatticeCardData } from './lattice-card-data.ts';
import type { LatticeDefinitionSnapshot } from './lattice-card-data.ts';
import type { LatticeBxlWorker } from './lattice-bxl-derivation.ts';
import {
  LatticeUnknownLinkInput,
  type LatticeMaterializationInputs,
  type LatticeLinkInput,
  type LatticeCardInput,
} from './lattice-materialization-inputs.ts';
import { LatticeDataProjector } from './lattice-data-projection.ts';
import { createLatticeQueryInputResolver } from './lattice-query-input-plan.ts';
import type { PublicationReceipt } from '@cardstack/runtime-common/lattice-materialization';
import type { LatticeCodeReference } from '@cardstack/runtime-common/lattice-code-reference';
import type { LatticeWorkScope } from '@cardstack/runtime-common/lattice-work';
import type { LatticePreparedJsonSource } from './lattice-json-source.ts';

export interface LatticeNativeCardAdmission {
  // Issued only after validating constructor/default/input semantics and the
  // cached module's complete code dependency receipt in the caller's authority.
  root: LatticeDefinitionSnapshot;
  lookup(ref: CodeRef): Promise<LatticeDefinitionSnapshot>;
  resolve(reference: string, relativeTo: string): string;
  relative(reference: string, id: string): string;
  typeKey(ref: CodeRef): string;
  deps: string[];
  runtimeRevision: string;
  inputActor?: string;
  codeReference?: LatticeCodeReference;
  file?: LatticeNativeFileAdmission;
  preparedSource?: LatticePreparedJsonSource;
  assertCurrent(
    tx: Querier,
    receipt: {
      request: Omit<LatticeNativeCardIndexRequest, 'sourceJSON'>;
      sourceHash: string;
      runtimeRevision: string;
      definitions: Array<{ codeRef: CodeRef; revision: string }>;
    },
  ): Promise<void>;
}

// Install on an indexing worker with an explicit, revisioned admission provider.
// This does not infer execution authority from a card/module name. In particular,
// nativeCodec alone is not proof that application constructors are data-only.
export function createLatticeNativeCardIndexer({
  worker,
  admit,
  openInputs,
  openWork,
  readLinks,
}: {
  worker: LatticeBxlWorker;
  admit(
    request: LatticeNativeCardIndexRequest,
  ): Promise<LatticeNativeCardAdmission | undefined>;
  openInputs?(
    request: LatticeNativeCardIndexRequest,
    admission: LatticeNativeCardAdmission,
    signal?: AbortSignal,
  ): Promise<LatticeMaterializationInputs>;
  openWork?(
    request: LatticeNativeCardIndexRequest,
    admission: LatticeNativeCardAdmission,
  ): Promise<LatticeWorkScope>;
  // Source-mode reads of the current index rows behind a card's declared
  // links (CardDef.linkInputs). Same realm only; the read cards join the
  // row's dependencies so a change to one re-indexes this card.
  readLinks?(
    request: LatticeNativeCardIndexRequest,
    admission: LatticeNativeCardAdmission,
    urls: string[],
  ): Promise<LatticeLinkInput[]>;
}): LatticeNativeCardIndexer {
  return async (request) => {
    const trace = startLatticeTrace(
      latticeAttemptId(request.url, request.generation),
      'native',
      {
        ownerURL: request.url,
        generation: request.generation,
        stale: Boolean(request.inputSnapshot?.stale),
        materializing: Boolean(request.inputSnapshot),
      },
    );
    try {
      return await execute(request, trace);
    } catch (error) {
      trace?.finish('rejected', {
        errorClass: error instanceof Error ? error.name : 'unknown',
      });
      throw error;
    } finally {
      trace?.finish('closed');
    }
  };
  async function execute(
    request: LatticeNativeCardIndexRequest,
    trace?: LatticeTrace,
  ): Promise<LatticeNativeCardIndexResult | undefined> {
    const debug = Boolean(process.env.LATTICE_NATIVE_ADMISSION_DEBUG);
    const bail = (why: string) => {
      trace?.finish('declined', { why });
      if (debug)
        console.warn(
          `native indexer: ${request.url} left the native path: ${why}`,
        );
      return undefined;
    };
    trace?.stage('admission');
    const admissionStart = performance.now();
    const admission = await (trace
      ? trace.measure('admit', () => admit(request))
      : admit(request));
    if (!admission) {
      if (debug)
        console.warn(`native indexer: no admission for ${request.url}`);
      trace?.finish('not-admitted');
      return undefined;
    }
    if (debug) console.warn(`native indexer: admitted ${request.url}`);
    const computationStart = performance.now();
    const indexMetadata = admission.root.definition.nativeIndex;
    if (request.inputSnapshot && (!openInputs || !indexMetadata?.materialized))
      return bail('line 100');
    if (indexMetadata?.materialized && !openInputs) return bail('line 101');
    const discovery = Boolean(
      indexMetadata?.materialized && !request.inputSnapshot,
    );
    if (
      !indexMetadata?.types.length ||
      !indexMetadata.displayNames.length ||
      !indexMetadata.cardType ||
      !admission.runtimeRevision ||
      !admission.deps.length
    ) {
      throw new Error('Incomplete native card admission');
    }
    const id = request.url.replace(/\.json$/, '');
    const sourceHash =
      admission.preparedSource?.fingerprint.digest ??
      createHash('sha256').update(request.sourceJSON).digest('hex');
    if (admission.preparedSource)
      trace?.event('source-fingerprint', {
        reused: admission.preparedSource.reused,
        bytes: admission.preparedSource.fingerprint.contentSize,
        ms: admission.preparedSource.elapsedMs,
      });
    // File data is prepared first. Materialization consumes its fingerprint
    // without recreating or replacing the source-file artifact.
    const file =
      !request.inputSnapshot && admission.file
        ? await extractLatticeJsonFile(
            request,
            admission.file,
            admission.typeKey,
            admission.preparedSource?.fingerprint,
          )
        : undefined;
    if (
      request.inputSnapshot &&
      (request.inputSnapshot.realmURL !== request.realmURL ||
        request.inputSnapshot.generation !== request.generation - 1)
    )
      throw new Error(
        'Native owner input revision does not match its publication',
      );
    trace?.event('code', {
      sourceHash,
      definition: admission.root.revision,
      runtimeRevision: admission.runtimeRevision,
    });
    trace?.stage('open-work');
    const workStart = performance.now();
    const work = request.inputSnapshot
      ? await openWork?.(request, admission)
      : undefined;
    const workOpenedAt = performance.now();
    try {
      work?.signal.throwIfAborted();
      trace?.stage('open-inputs');
      const inputFrame = request.inputSnapshot
        ? await openInputs!(request, admission, work?.signal)
        : undefined;
      if (inputFrame) inputFrame.trace = trace;
      trace?.stage('assembly');
      const inputsOpenedAt = performance.now();
      const inputStages: LatticeInputStageTiming[] = [];
      const inputDefinitions = new Map<
        string,
        { codeRef: CodeRef; revision: string }
      >();
      const linkDeps = new Set<string>();
      const linkInputs =
        readLinks && !discovery && admission.root.definition.nativeLinkInputs
          ? {
              resolveLinkInputs: async (
                links: Array<{
                  name: string;
                  many: boolean;
                  ids: string[];
                  projection: import('@cardstack/runtime-common/definitions').LatticeDataProjection;
                }>,
              ) => {
                const read = async (
                  urls: string[],
                ): Promise<LatticeLinkInput[]> => {
                  for (const url of urls) linkDeps.add(url);
                  return inputFrame
                    ? inputFrame.readLinks(urls)
                    : readLinks(request, admission, urls);
                };
                const projector = new LatticeDataProjector(
                  read,
                  admission.resolve,
                );
                const out = new Map<string, unknown>();
                for (const link of links) {
                  const cards = await read(link.ids.map((u) => u + '.json'));
                  const present = cards.filter(
                    (card): card is LatticeCardInput => card.resource !== null,
                  );
                  const values = await projector.project(
                    present,
                    link.projection,
                  );
                  const byId = new Map(
                    values.map((value, i) => [
                      present[i].url.replace(/\.json$/, ''),
                      value,
                    ]),
                  );
                  const resolved = link.ids.map((id) => byId.get(id) ?? null);
                  out.set(
                    link.name,
                    link.many ? resolved : (resolved[0] ?? null),
                  );
                }
                return out;
              },
            }
          : {};
      let omittedInputStages = 0;
      const result = await assembleLatticeCardData({
        id,
        sourceRevision: sourceHash,
        sourceJSON: request.sourceJSON,
        root: admission.root,
        lookup: admission.lookup,
        resolve: admission.resolve,
        worker,
        trace,
        deferComputation: discovery,
        signal: work?.signal,
        ...linkInputs,
        ...(inputFrame
          ? {
              resolveQueryInputs: createLatticeQueryInputResolver({
                frame: inputFrame,
                definition: admission.root.definition,
                definitionRevision: admission.root.revision,
                id,
                sourceRevision: sourceHash,
                realmURL: request.realmURL,
                worker,
                resolve: admission.resolve,
                lookup: async (ref) => {
                  const snapshot = await admission.lookup(ref);
                  inputDefinitions.set(admission.typeKey(ref), {
                    codeRef: snapshot.definition.codeRef,
                    revision: snapshot.revision,
                  });
                  return snapshot.definition;
                },
                signal: work?.signal,
                onTiming: (timing) => {
                  if (inputStages.length < 256) inputStages.push(timing);
                  else omittedInputStages++;
                },
              }),
            }
          : {}),
      });
      const serialized = result.serialized;
      work?.signal.throwIfAborted();
      trace?.stage('query-preparation');
      const queryPreparationStart = performance.now();
      const dataReceipt = await inputFrame?.sealWithQueries();
      const queryPreparationMs = performance.now() - queryPreparationStart;
      trace?.stage('output-assembly');
      const queryFields =
        dataReceipt?.watches.map((watch) => watch.fieldPath) ??
        (discovery
          ? Object.entries(admission.root.definition.fields)
              .filter(
                ([, key]) => admission.root.definition.fieldDefs[key].query,
              )
              .map(([name]) => name)
          : []);
      // A paged input's order is part of what the owner read: a member whose
      // sort key moves can change which rows are on the page even when every
      // field the program looked at is unchanged. Count the sort key as read
      // so read-path detection cannot skip it. A sort on something the search
      // document does not carry under that name records a key the comparison
      // treats as missing, which stays conservative.
      const readPaths = result.readPaths
        ? Object.fromEntries(
            Object.entries(result.readPaths).map(([fieldPath, paths]) => {
              const query = dataReceipt?.watches.find(
                (watch) => watch.fieldPath === fieldPath,
              )?.query;
              const keys = query?.page
                ? (query.sort ?? []).map((entry) => entry.by)
                : [];
              return [fieldPath, [...new Set([...paths, ...keys])]];
            }),
          )
        : undefined;
      if (dataReceipt || discovery) {
        const manifest: PublicationReceipt = {
          version: 1,
          state: 'pending',
          sourceFields: latticeSourceFields(admission.root.definition),
          validatedThrough: request.inputSnapshot?.generation ?? 0,
          ...(result.freshUntil ? { freshUntil: result.freshUntil } : {}),
          ...(result.freshWithin ? { freshWithin: result.freshWithin } : {}),
          ...(result.staleWithin ? { staleWithin: result.staleWithin } : {}),
          ...(request.inputSnapshot?.stale ? { stale: true as const } : {}),
          ...(dataReceipt?.projections && !discovery
            ? {
                projections: {
                  ...dataReceipt.projections,
                  // The identity watch reads every root's cards, so it may
                  // carry a collection's predicate only where every root
                  // that reads that collection (`x.*`) reads it through the
                  // same predicate; a root reading it whole keeps it out.
                  ...(dataReceipt.identities.length
                    ? (() => {
                        const roots = [
                          ...dataReceipt.watches.map((w) => w.fieldPath),
                          ...Object.keys(
                            admission.root.definition.nativeLinkInputs ?? {},
                          ),
                        ];
                        const merged: LatticeProjectionWhere = {};
                        const collections = new Set(
                          Object.values(dataReceipt.projections).flatMap(
                            (where) => Object.keys(where),
                          ),
                        );
                        for (const collection of collections) {
                          const readers = roots.filter((root) =>
                            (readPaths?.[root] ?? ['*']).some(
                              (path) =>
                                path === '*' || path === `${collection}.*`,
                            ),
                          );
                          const predicates = readers.map((root) =>
                            JSON.stringify(
                              dataReceipt.projections![root]?.[collection] ??
                                null,
                            ),
                          );
                          if (
                            readers.length &&
                            predicates.every((p) => p === predicates[0]) &&
                            predicates[0] !== 'null'
                          )
                            merged[collection] = JSON.parse(predicates[0]);
                        }
                        const identity: Record<string, LatticeProjectionWhere> =
                          {};
                        if (Object.keys(merged).length)
                          identity['@lattice/inputs'] = merged;
                        return identity;
                      })()
                    : {}),
                },
              }
            : {}),
          ...(readPaths && dataReceipt && !discovery
            ? {
                readPaths: Object.fromEntries([
                  ...dataReceipt.watches.flatMap((watch) =>
                    readPaths![watch.fieldPath]
                      ? [[watch.fieldPath, readPaths![watch.fieldPath]]]
                      : [],
                  ),
                  // The identity watch covers the cards read through queries
                  // and declared links: the union of those roots' reads (a
                  // `*` in any of them keeps it conservative). The owner's
                  // own attribute roots (cardInfo, ...) are not input cards.
                  ...(dataReceipt.identities.length
                    ? [
                        [
                          '@lattice/inputs',
                          [
                            ...new Set(
                              [
                                ...dataReceipt.watches.map(
                                  (watch) => watch.fieldPath,
                                ),
                                ...Object.keys(
                                  admission.root.definition.nativeLinkInputs ??
                                    {},
                                ),
                              ].flatMap((root) => readPaths![root] ?? ['*']),
                            ),
                          ],
                        ],
                      ]
                    : []),
                ]),
              }
            : {}),
          computedFields: Object.entries(admission.root.definition.fields)
            .filter(([name, key]) => {
              const field = admission.root.definition.fieldDefs[key];
              return (
                name !== 'id' &&
                field.isComputed &&
                (field.type === 'contains' || field.type === 'containsMany')
              );
            })
            .map(([name]) => name),
          queryFields,
          watches: [
            ...(dataReceipt?.watches ?? []),
            // Explicitly read linked identities also invalidate this owner via
            // the secondary reverse-query lane, not core graph traversal.
            ...(dataReceipt?.identities.length
              ? [
                  {
                    fieldPath: '@lattice/inputs',
                    query: {
                      realms: [request.realmURL],
                      filter: { in: { id: dataReceipt.identities } },
                    },
                  },
                ]
              : []),
          ],
        };
        Object.assign(serialized.data.meta, { publication: manifest });
      }
      // The index meta route publishes the card's own resource, retaining link
      // references but removing resolved relationship data and included resources.
      for (const [name, relationship] of Object.entries(
        serialized.data.relationships ?? {},
      )) {
        if (queryFields.includes(name)) continue;
        delete relationship.data;
        if (relationship.links.self) {
          relationship.links.self = admission.relative(
            relationship.links.self,
            id,
          );
        }
      }
      const adoptsFrom = serialized.data.meta.adoptsFrom;
      if (!('module' in adoptsFrom))
        throw new Error('Expected a resolved type');
      serialized.data.meta.adoptsFrom = {
        ...adoptsFrom,
        module: admission.relative(
          adoptsFrom.module,
          id,
        ) as typeof adoptsFrom.module,
      };
      if (!isSingleCardDocument(serialized)) {
        throw new Error('Native computation produced an invalid card document');
      }
      if (debug)
        console.warn(
          `native indexer: ${request.url} validUntil=${result.validUntil ?? 'null'}`,
        );
      const card: RenderResponse = {
        serialized,
        validUntil: result.validUntil,
        searchDoc: {
          ...result.searchDoc,
          _cardType: indexMetadata.cardType,
          _title: result.searchDoc.cardTitle,
        },
        types: indexMetadata.types.map(admission.typeKey),
        displayNames: [...indexMetadata.displayNames],
        deps: [...new Set([...admission.deps, ...linkDeps])],
        isolatedHTML: null,
        headHTML: null,
        atomHTML: null,
        embeddedHTML: null,
        fittedHTML: null,
        iconHTML: null,
        markdown: null,
      };
      // Retain compact revision facts through commit, never the authored bytes
      // or the whole definition/lookup object graph for every indexed card.
      const { sourceJSON: _sourceJSON, ...revisionContext } = request;
      const assertCurrent = admission.assertCurrent;
      const receipt = {
        request: revisionContext,
        sourceHash,
        runtimeRevision: admission.runtimeRevision,
        definitions: [
          ...result.definitionRevisions,
          ...inputDefinitions.values(),
          ...(file && admission.file
            ? [
                {
                  codeRef: admission.file.snapshot.definition.codeRef,
                  revision: admission.file.snapshot.revision,
                },
              ]
            : []),
        ],
      };
      trace?.event('native-result', {
        assembly: result.timings,
        stages: inputStages,
        omittedInputStages,
        compute: result.computed,
        outputHash: trace.hash(
          JSON.stringify([
            serialized.data.attributes,
            serialized.data.relationships,
          ]),
        ),
        validUntil: result.validUntil,
        definitions: trace.hash(JSON.stringify(result.definitionRevisions)),
      });
      trace?.finish('computed');
      return {
        card,
        ...(dataReceipt?.retainedInputs.length
          ? {
              retainedInputs: {
                kind: 'capture-index' as const,
                realmURL: request.realmURL,
                ownerURL: id,
                consumerGeneration: request.generation,
                inputs: dataReceipt.retainedInputs,
                capturedInputs: dataReceipt.capturedInputs,
              },
            }
          : {}),
        ...(dataReceipt?.queryPreparation
          ? { queryPreparation: dataReceipt.queryPreparation }
          : {}),
        ...((dataReceipt || discovery) && admission.codeReference
          ? { codeReference: admission.codeReference }
          : {}),
        ...(file ? { file } : {}),
        timings: {
          admission: computationStart - admissionStart,
          computeAndAssemble: performance.now() - computationStart,
          openWork: workOpenedAt - workStart,
          openInputs: inputsOpenedAt - workOpenedAt,
          ...(dataReceipt ? { queryPreparation: queryPreparationMs } : {}),
          assembly: result.timings,
          inputStages,
          omittedInputStages,
        },
        // Where a materialization's time went, per stage, for the stress
        // realm's accounting (the debug flag is what turns it on).
        ...(debug && dataReceipt
          ? (() => {
              console.warn(
                `native indexer: timings ${request.url} ${JSON.stringify({
                  admission: Math.round(computationStart - admissionStart),
                  openInputs: Math.round(inputsOpenedAt - workOpenedAt),
                  computeAndAssemble: Math.round(
                    performance.now() - computationStart,
                  ),
                  queryPreparation: Math.round(queryPreparationMs),
                  stages: inputStages.map((stage) => ({
                    field: stage.field,
                    kind: stage.kind,
                    ms: Math.round(stage.elapsedMs),
                    cards: stage.cards,
                    ...(stage.phases
                      ? {
                          phases: Object.fromEntries(
                            Object.entries(stage.phases).map(([k, v]) => [
                              k,
                              Math.round(v),
                            ]),
                          ),
                        }
                      : {}),
                  })),
                  assembly: result.timings,
                })}`,
              );
              return {};
            })()
          : {}),
        ...(result.computed ? { compute: result.computed } : {}),
        assertCurrent: async (tx) => {
          // Admission handles queued-work priority. Publication depends on
          // actual source/code/input receipts, not the presence of another job.
          if (trace) {
            await trace.measure('publication-code-check', () =>
              assertCurrent(tx, receipt),
            );
            await trace.measure('publication-input-check', async () => {
              await dataReceipt?.assertCurrent(tx);
            });
          } else {
            await assertCurrent(tx, receipt);
            await dataReceipt?.assertCurrent(tx);
          }
        },
      };
    } catch (error) {
      trace?.finish('rejected', {
        errorClass: error instanceof Error ? error.name : 'unknown',
      });
      // An unknown declared target needs source authority, which the existing
      // browser producer can obtain. Never turn a cancelled work scope into a
      // fallback, and never return the native attempt's partial data/receipts.
      work?.signal.throwIfAborted();
      if (debug)
        console.warn(
          `native indexer: ${request.url} failed: ${(error as Error)?.message}`,
        );
      if (error instanceof LatticeUnknownLinkInput) return bail('line 407');
      throw error;
    } finally {
      await work?.close();
    }
  }
}
