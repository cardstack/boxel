import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  VirtualNetwork,
  findStalePrerenderedHtmlRows,
  findTransientRetryPrerenderedHtmlRows,
  internalKeyFor,
  markVisitRequestFailure,
  rri,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
  type Diagnostics,
  type FieldDefinition,
  type Prerenderer,
  type Reader,
  type ResolvedCodeRef,
  type SerializedError,
} from '@cardstack/runtime-common';
import { runPrerenderHtmlPass } from '@cardstack/runtime-common/index-runner/prerender-html-visit';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './index.ts';

// A realm of three notes, indexed by a pass that renders inline, and the
// whole-realm HTML pass the prerender_html job runs over it with each note's
// render answered as a test says: the fixture of the transient-render-failure
// tests.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}
const stringRef = ref('@cardstack/base/string', 'default');
const mod = `${testRealm}note`;
export const noteRef = ref(mod, 'Note');

const noteDef = {
  type: 'card-def',
  codeRef: noteRef,
  displayName: 'Note',
  fields: { cardTitle: 'f0' },
  fieldDefs: {
    f0: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
    } as FieldDefinition,
  },
} as Definition;

function makeDefinitionLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: CodeRef) {
      if ('module' in codeRef && codeRef.module === mod) {
        return noteDef;
      }
      throw new Error(
        `unexpected definition lookup: ${JSON.stringify(codeRef)}`,
      );
    },
    async lookupCachedDefinition() {
      return undefined;
    },
    forRealm() {
      return lookup;
    },
  } as unknown as DefinitionLookup;
  return lookup;
}

// The pass's pre-warm sweep is not under test.
const noPreWarmDeps = {
  preWarm: false as const,
  definitionLookup: {} as unknown as DefinitionLookup,
  fetch: (() => {
    throw new Error('fetch is not used when preWarm is false');
  }) as unknown as typeof globalThis.fetch,
  realmOwnerUserId: 'test_realm',
};

export const names = ['n1', 'n2', 'n3'];
export const cardURL = (name: string) => `${testRealm}Note/${name}.json`;
export const allIds = names.map((name) => `${testRealm}Note/${name}`).sort();
export const idsWithout = (name: string) =>
  allIds.filter((id) => id !== `${testRealm}Note/${name}`);

const cardSource = JSON.stringify({
  data: {
    type: 'card',
    attributes: {},
    meta: { adoptsFrom: { module: rri(mod), name: 'Note' } },
  },
});

// What the prerender server answers for a render that ran out of time.
export const renderTimeout: SerializedError = {
  status: 504,
  title: 'Render timeout',
  message: 'Render timed-out after 60000 ms',
  additionalErrors: null,
  renderTimeout: true,
};
// The same timeout as a row stored it before the prerender server stamped
// the `renderTimeout` marker.
export const legacyRenderTimeout: SerializedError = {
  status: 504,
  title: 'Render timeout',
  message: 'Render timed-out after 60000 ms',
  additionalErrors: null,
};
// A card whose template throws.
export const genuineError: SerializedError = {
  status: 500,
  title: 'Error',
  message: 'Cannot read properties of undefined',
  additionalErrors: null,
};

// `request-fails` is a prerender request that failed transiently, as the
// prerender client throws it (marked); `request-refused` is one the prerender
// path refused, a 4xx (unmarked).
export type Outcome =
  | { kind: 'ok' }
  | { kind: 'card-error'; error: SerializedError }
  | { kind: 'request-fails'; message: string }
  | { kind: 'request-refused'; message: string };

function stubPrerenderer(outcomes: Map<string, Outcome>): Prerenderer {
  let rendering = (html: string) => ({
    isolatedHTML: html,
    headHTML: null,
    atomHTML: null,
    embeddedHTML: null,
    fittedHTML: null,
    iconHTML: null,
    markdown: null,
  });
  return {
    async prerenderVisit(args: { url: string }) {
      let outcome = outcomes.get(args.url) ?? { kind: 'ok' };
      if (outcome.kind === 'request-fails') {
        throw markVisitRequestFailure(new Error(outcome.message));
      }
      if (outcome.kind === 'request-refused') {
        throw new Error(outcome.message);
      }
      let card =
        outcome.kind === 'card-error'
          ? { error: { type: 'instance-error', error: outcome.error } }
          : {
              serialized: null,
              searchDoc: null,
              displayNames: null,
              deps: [],
              types: null,
              ...rendering('<div>fresh</div>'),
            };
      return { card, fileRender: rendering('<div>file</div>') };
    },
    async prerenderModule() {
      throw new Error('not used by the prerender-html pass');
    },
    async runCommand() {
      throw new Error('not used by the prerender-html pass');
    },
  } as unknown as Prerenderer;
}

function stubReader(): Reader {
  return {
    async readFile(url: URL) {
      return { content: cardSource, lastModified: 0, path: url.href };
    },
    async readStream() {
      return undefined;
    },
    async mtimes() {
      return {};
    },
  } as unknown as Reader;
}

export interface TransientRenderFixture {
  adapter: PgAdapter;
  // The HTML pass over every note, each render answered by `outcomes`.
  htmlPass(outcomes: Map<string, Outcome>): Promise<void>;
  // The notes a type search finds, and its total.
  search(): Promise<{ ids: string[]; total: number | undefined }>;
  htmlRow(name: string): Promise<{
    isolated_html: string | null;
    error_doc: SerializedError | null;
    diagnostics: Diagnostics | null;
    generation: number | string;
    index_generation: number | string;
  }>;
  // Which notes the hourly reconcile sweep would re-render (its stale rows and
  // the transient retries), every rendering aged by `ageMs` (all the way back,
  // when not given).
  sweepFinds(ageMs?: number): Promise<string[]>;
  // Which notes the every-minute sweep, the transient retries alone, would
  // re-render, aged the same way.
  transientSweepFinds(ageMs?: number): Promise<string[]>;
  // Records a prerender_html repair of a note that finished, `minutesAgo`,
  // without writing its rendering, as a rejected or timed-out job leaves it.
  repairDied(name: string, minutesAgo: number): Promise<void>;
  // Stores `error` as a note's render error at its row's generation.
  storeRenderError(name: string, error: SerializedError): Promise<void>;
  // Removes a note's renderings, as if it had never rendered.
  dropRenderings(name: string): Promise<void>;
}

export function setupTransientRenderFixture(
  hooks: NestedHooks,
): TransientRenderFixture {
  let adapter!: PgAdapter;
  let virtualNetwork!: VirtualNetwork;
  let engine!: IndexQueryEngine;
  let jobId = 5000;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    virtualNetwork = new VirtualNetwork();
    engine = new IndexQueryEngine(
      adapter,
      makeDefinitionLookup(),
      virtualNetwork,
    );
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    let noteKey = internalKeyFor(noteRef, undefined, virtualNetwork);
    for (let name of names) {
      await batch.updateEntry(new URL(cardURL(name)), {
        type: 'instance',
        resource: {
          id: rri(`${testRealm}Note/${name}`),
          type: 'card',
          attributes: {},
          meta: { adoptsFrom: { module: rri(mod), name: 'Note' } },
        },
        lastModified: Date.now(),
        resourceCreatedAt: Date.now(),
        searchData: { cardTitle: name },
        deps: new Set(),
        displayNames: ['Note'],
        types: [noteKey],
        isolatedHtml: `<div>${name} good</div>`,
      });
    }
    await batch.done();
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  async function age(ageMs: number | undefined) {
    await adapter.execute(
      ageMs === undefined
        ? `UPDATE prerendered_html SET rendered_at = 0`
        : `UPDATE prerendered_html SET rendered_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint - ${ageMs}`,
    );
  }

  return {
    get adapter() {
      return adapter;
    },
    async htmlPass(outcomes) {
      let [{ current_generation }] = (await adapter.execute(
        `SELECT current_generation FROM realm_generations WHERE realm_url = $1`,
        { bind: [testRealm] },
      )) as { current_generation: number | string }[];
      await runPrerenderHtmlPass({
        realmURL: new URL(testRealm),
        changes: names.map((name) => ({
          url: cardURL(name),
          operation: 'update' as const,
        })),
        spawningIndexPasses: [],
        generation: Number(current_generation),
        loaderEpoch: 'epoch-a',
        spawningJobId: null,
        ...noPreWarmDeps,
        indexWriter: new IndexWriter(adapter),
        virtualNetwork,
        reader: stubReader(),
        prerenderer: stubPrerenderer(outcomes),
        auth: 'test-auth',
        jobInfo: {
          jobId: jobId++,
          reservationId: 1,
          priority: 0,
          queueWaitMs: null,
          concurrencyGroup: null,
          laneFamily: null,
        },
        dbAdapter: adapter,
      });
    },
    async search() {
      let { cards, meta } = await engine.searchCards(new URL(testRealm), {
        filter: { type: noteRef },
      });
      return {
        ids: cards.map((c) => String(c.id)).sort(),
        total: meta.page.total,
      };
    },
    async htmlRow(name) {
      let [row] = (await adapter.execute(
        `SELECT ph.isolated_html, ph.error_doc, ph.diagnostics, ph.generation,
                i.generation AS index_generation
           FROM prerendered_html ph
           JOIN boxel_index i ON i.url = ph.url AND i.realm_url = ph.realm_url AND i.type = ph.type
          WHERE ph.url = $1 AND ph.type = 'instance'`,
        { bind: [cardURL(name)] },
      )) as Awaited<ReturnType<TransientRenderFixture['htmlRow']>>[];
      return row;
    },
    async sweepFinds(ageMs) {
      await age(ageMs);
      let rows = [
        ...(await findStalePrerenderedHtmlRows(adapter)),
        ...(await findTransientRetryPrerenderedHtmlRows(adapter)),
      ];
      return [
        ...new Set(
          rows.filter((r) => r.realmURL === testRealm).map((r) => r.url),
        ),
      ].sort();
    },
    async transientSweepFinds(ageMs) {
      await age(ageMs);
      return (await findTransientRetryPrerenderedHtmlRows(adapter))
        .filter((r) => r.realmURL === testRealm)
        .map((r) => r.url)
        .sort();
    },
    async repairDied(name, minutesAgo) {
      // Its id follows the job that wrote the failed attempt, as a repair
      // enqueued after that write would.
      await adapter.execute(
        `INSERT INTO jobs (id, job_type, concurrency_group, args, status, timeout, finished_at)
         SELECT GREATEST(
                  (ph.diagnostics ->> 'transientRenderFailureJobId')::int,
                  COALESCE((SELECT MAX(id) FROM jobs), 0)
                ) + 1,
                'prerender_html', 'prerender-html:' || ph.realm_url,
                jsonb_build_object('realmURL', ph.realm_url,
                  'changes', jsonb_build_array(jsonb_build_object('url', ph.url, 'operation', 'update'))),
                'rejected', 60, NOW() - ($2 || ' minutes')::interval
           FROM prerendered_html ph
          WHERE ph.url = $1 AND ph.type = 'instance'`,
        { bind: [cardURL(name), String(minutesAgo)] },
      );
    },
    async storeRenderError(name, error) {
      await adapter.execute(
        `UPDATE prerendered_html SET error_doc = $1::jsonb
          WHERE url = $2 AND type = 'instance'`,
        { bind: [JSON.stringify(error), cardURL(name)] },
      );
    },
    async dropRenderings(name) {
      await adapter.execute(`DELETE FROM prerendered_html WHERE url = $1`, {
        bind: [cardURL(name)],
      });
    },
  };
}
