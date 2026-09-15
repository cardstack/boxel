import {
  PgAdapter,
  PgQueuePublisher,
  PgQueueRunner,
} from '@cardstack/postgres';
import {
  Deferred,
  IndexWriter,
  logger,
  VirtualNetwork,
  type Prerenderer,
} from '@cardstack/runtime-common';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import { latticeMaterialize } from '@cardstack/runtime-common/tasks/lattice';
import { workExecution, workRealms } from '../helpers/lattice-work-fixture.ts';

process.once(
  'message',
  async (config: { pauseRealm?: string; maxReservationCount?: number }) => {
    const workerId = `lattice-materialization-test-${process.pid}`;
    const db = new PgAdapter({ autoMigrate: false });
    const lattice = new LatticeRealmConfig(workRealms);
    const queue = new PgQueueRunner({
      adapter: db,
      workerId,
      lattice,
      maxReservationCount: config.maxReservationCount,
    });
    const publisher = new PgQueuePublisher(db);
    const network = new VirtualNetwork();
    const execution = workExecution(db, network);
    const release = new Deferred<void>();
    const reads = new Map<number, Deferred<string>>();
    let sequence = 0,
      paused = false;
    const send = (message: object) =>
      process.send?.({ ...message, pid: process.pid, workerId });
    const unexpected = async (): Promise<never> => {
      throw new Error('Queue fixture must not invoke Chrome');
    };
    const prerenderer: Prerenderer = {
      prerenderVisit: unexpected,
      prerenderModule: unexpected,
      runCommand: unexpected,
    };
    process.on(
      'message',
      async (message: { type: string; id: number; source: string }) => {
        if (message.type === 'source') {
          reads.get(message.id)?.fulfill(message.source);
          reads.delete(message.id);
        } else if (message.type === 'release') release.fulfill();
        else if (message.type === 'stop') {
          release.fulfill();
          await queue.destroy();
          await execution.worker.close();
          await publisher.destroy();
          await db.close();
          process.disconnect();
        }
      },
    );
    const task = latticeMaterialize({
      dbAdapter: db,
      queuePublisher: publisher,
      matrixURL: 'https://example',
      indexWriter: new IndexWriter(db, { lattice }),
      definitionLookup: execution.lookup,
      virtualNetwork: network,
      prerenderer,
      nativeCardIndexer: async (request) => {
        const result = await execution.indexer(request);
        if (request.realmURL === config.pauseRealm && !paused) {
          paused = true;
          send({
            type: 'computed',
            realmURL: request.realmURL,
            attributes: result?.card.serialized?.data.attributes,
          });
          await release.promise;
        }
        return result;
      },
      createPrerenderAuth: () => '',
      getAuthedFetch: async () => network.fetch,
      getReader: (_fetch, realmURL) => ({
        async readFile(url) {
          const id = ++sequence,
            response = new Deferred<string>();
          reads.set(id, response);
          send({ type: 'read', id, realmURL, url });
          return {
            content: await response.promise,
            path: 'Dashboard/one.json',
            lastModified: 1,
            created: 1,
          };
        },
        readStream: unexpected,
        mtimes: async () => ({}),
      }),
      reportStatus() {},
      log: logger('lattice-work-queue-test'),
    });
    queue.register(
      'lattice-materialize',
      async (args: Parameters<typeof task>[0]) => {
        send({
          type: 'started',
          realmURL: args.realmURL,
          jobInfo: args.jobInfo,
        });
        try {
          const result = await task(args);
          send({
            type: 'finished',
            realmURL: args.realmURL,
            jobInfo: args.jobInfo,
            superseded: result.superseded,
            invalidations: result.invalidations,
          });
          return result;
        } catch (error) {
          send({
            type: 'failed',
            realmURL: args.realmURL,
            message: String(error),
          });
          throw error;
        }
      },
    );
    await queue.start();
    send({ type: 'ready' });
  },
);
