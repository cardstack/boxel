import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import QUnit from 'qunit';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexWriter,
  VirtualNetwork,
  param,
  query,
  type DefinitionLookup,
  type LooseCardResource,
  type Prerenderer as PrerendererAPI,
  type Reader,
} from '@cardstack/runtime-common';
import { runPrerenderHtmlPass } from '@cardstack/runtime-common/index-runner/prerender-html-visit';
import { Prerenderer } from '../prerender/prerenderer.ts';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
// The real copied classroom and synthetic fixture deliberately live outside
// Git. This explicit local integration gate uses the normal native renderer,
// never a lookalike template or a simulated prerender response.
const fixturePath = process.env.LATTICE_NATIVE_RENDER_FIXTURE;
const realmDirectory = process.env.LATTICE_NATIVE_REALM_DIR;

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
    },
  });

  (fixturePath && realmDirectory ? test : test.skip)(
    'publishes the original native template and theme from a complete indexed document',
    async function (assert) {
      assert.timeout(90_000);
      let fixture = JSON.parse(await readFile(fixturePath!, 'utf8'));
      let doc = fixture.pristine_doc as LooseCardResource;
      let realmURL = 'http://localhost:53777/lattice/';
      let id = `${realmURL}LatticeNativeDay/00000-2026-09-11`;
      assert.strictEqual(
        doc.id,
        id,
        'only the known synthetic local fixture is admitted',
      );
      let ownerURL = `${id}.json`;
      let stamp = doc.meta.publication!;
      if (
        typeof stamp.outputRevision !== 'number' ||
        typeof stamp.validatedThrough !== 'number' ||
        typeof stamp.definitionRevision !== 'string'
      ) {
        throw new Error(
          'Fixture has no complete native publication provenance',
        );
      }
      let generation = stamp.outputRevision;
      await query(db, [
        'INSERT INTO realm_generations (realm_url, current_generation, loader_epoch) VALUES (',
        param(realmURL),
        ',',
        param(generation),
        ',',
        param(stamp.definitionRevision),
        ')',
      ]);
      await query(db, [
        'INSERT INTO lattice_owners (realm_url, owner_url, published_generation, input_generation, definition_revision) VALUES (',
        param(realmURL),
        ',',
        param(ownerURL),
        ',',
        param(generation),
        ',',
        param(stamp.validatedThrough),
        ',',
        param(stamp.definitionRevision),
        ')',
      ]);
      await query(db, [
        'INSERT INTO boxel_index (url, file_alias, realm_url, type, generation, pristine_doc, is_deleted, has_error) VALUES (',
        param(ownerURL),
        ',',
        param(id),
        ',',
        param(realmURL),
        ", 'instance',",
        param(generation),
        ',',
        param(JSON.stringify(doc)),
        ', FALSE, FALSE)',
      ]);

      let native = new Prerenderer({
        serverURL: 'http://localhost:53832/',
        maxPages: 1,
      });
      let visits: { elapsedMs: number; receipt: unknown }[] = [];
      let prerenderer: PrerendererAPI = {
        async prerenderVisit(args) {
          let start = performance.now();
          let result = await native.prerenderVisit({
            ...args,
            opts: { timeoutMs: 45_000 },
          });
          visits.push({
            elapsedMs: performance.now() - start,
            receipt: result.response.latticeRenderReceipt,
          });
          console.log(
            'LATTICE_NATIVE_VISIT',
            JSON.stringify({
              elapsedMs: performance.now() - start,
              timings: result.timings,
              receipt: result.response.latticeRenderReceipt,
              cardError: result.response.card?.error,
              fileError: result.response.fileRender?.error,
              pageError: result.response.pageUnusableError,
              meta: result.response.meta,
            }),
          );
          return result.response;
        },
        async prerenderModule() {
          throw new Error('Unexpected module prewarm');
        },
        async runCommand() {
          throw new Error('Unexpected command');
        },
        async releaseBatch(args) {
          await native.releaseBatch(args);
        },
      };
      let reader: Reader = {
        async readFile(url) {
          if (!url.href.startsWith(realmURL))
            throw new Error('Outside synthetic realm');
          let relative = decodeURIComponent(url.href.slice(realmURL.length));
          if (relative.split('/').includes('..'))
            throw new Error('Outside synthetic realm');
          return {
            content: await readFile(join(realmDirectory!, relative), 'utf8'),
            lastModified: 0,
            path: relative,
          };
        },
        async readStream() {
          return undefined;
        },
        async mtimes() {
          return {};
        },
      };
      try {
        let writer = new IndexWriter(db, {
          lattice: new LatticeRealmConfig([realmURL]),
        });
        for (let n = 0; n < 2; n++) {
          let result = await runPrerenderHtmlPass({
            realmURL: new URL(realmURL),
            changes: [{ url: ownerURL, operation: 'update' }],
            generation,
            loaderEpoch: stamp.definitionRevision,
            spawningJobId: null,
            preWarm: false,
            expandDependencies: false,
            indexWriter: writer,
            definitionLookup: {} as DefinitionLookup,
            virtualNetwork: new VirtualNetwork(),
            reader,
            fetch: globalThis.fetch,
            realmOwnerUserId: '@synthetic:localhost',
            prerenderer,
            auth: '{}',
            dbAdapter: db,
            jobInfo: {
              jobId: -1,
              reservationId: -1,
              priority: 1,
              queueWaitMs: null,
            },
            onLatticeDeferred: async () => {
              throw new Error('The isolated input must remain current');
            },
          });
          assert.deepEqual(result.invalidations, [ownerURL]);
          let [row] = await query(db, [
            "SELECT isolated_html, fitted_html, error_doc, generation FROM prerendered_html WHERE type = 'instance' AND url =",
            param(ownerURL),
          ]);
          assert.strictEqual(row.error_doc, null);
          assert.true(String(row.isolated_html).includes('Room 1A'));
          assert.true(String(row.isolated_html).includes('Story circle'));
          assert.true(String(row.isolated_html).includes('7 students'));
          assert.ok(row.fitted_html, 'native fitted format is published too');
          assert.strictEqual(Number(row.generation), generation);
        }
        console.log(
          'LATTICE_NATIVE_RENDER_JOB',
          JSON.stringify({
            visits,
            source: 'original synthetic classroom',
            publisher: 'native guarded HTML job',
            database: 'disposable',
            liveRealmWritten: false,
          }),
        );
      } finally {
        await native.stop();
      }
    },
  );
});
