import {
  enqueuePrerenderHtmlJob,
  skipsPrerenderHtml,
} from '../jobs/prerender-html.ts';
import { enqueueLattice } from '../jobs/lattice.ts';
import type { Task, WorkerArgs } from './index.ts';
import { LatticeWorkFailed } from '../lattice-work.ts';
import { IndexRunner } from '../index-runner.ts';
import { ensureRealmOwnerPermissions } from './indexer.ts';
import {
  fetchUserPermissions,
  notifyRealmIndexUpdated,
  userIdFromUsername,
} from '../index.ts';

interface LatticeArgs extends WorkerArgs {
  wave: number;
  attempt: number;
}

export const latticeMaterialize: Task<
  LatticeArgs,
  Awaited<ReturnType<typeof IndexRunner.materialize>>
> =
  ({
    nativeCardIndexer,
    dbAdapter,
    queuePublisher,
    matrixURL,
    indexWriter,
    getReader,
    getAuthedFetch,
    prerenderer,
    definitionLookup,
    virtualNetwork,
    createPrerenderAuth,
    reportStatus,
    reportRealmEvent,
    log,
    skipPrerenderHtmlRealms,
  }) =>
  async (args) => {
    let { realmURL, realmUsername, jobInfo } = args;
    reportStatus(jobInfo, 'start');
    // A job queued before an operator disabled this realm cannot opt it back
    // in. Reject before auth, definition reads, routing, or retry publication.
    if (!indexWriter.isLatticeEnabled(realmURL)) {
      reportStatus(jobInfo, 'finish');
      throw new Error('Lattice is disabled for this realm');
    }
    let userId = userIdFromUsername(realmUsername, matrixURL);
    let permissions = ensureRealmOwnerPermissions(
      await fetchUserPermissions(dbAdapter, { userId }),
      realmURL,
    );
    let fetch = await getAuthedFetch(args);
    let runner = new IndexRunner({
      nativeCardIndexer,
      realmURL: new URL(realmURL),
      reader: getReader(fetch, realmURL),
      indexWriter,
      definitionLookup,
      virtualNetwork,
      jobInfo,
      prerenderer,
      fetch,
      auth: createPrerenderAuth(userId, permissions),
      realmOwnerUserId: userId,
    });
    let result;
    try {
      result = await IndexRunner.materialize(runner, realmUsername, args.wave);
    } catch (error) {
      if (error instanceof LatticeWorkFailed) throw error;
      // Each retry gets a new render scope, so a transient input error cannot
      // remain cached as a terminal broken link. Yield to queued source work
      // between attempts; persistent failures stay dirty and visibly rejected.
      let attempt = args.attempt ?? 0;
      if (attempt < 2) {
        await dbAdapter.withWriteLock(
          `lattice:index:${realmURL}`,
          async (tx) => {
            if (!tx) throw new Error('Lattice retry requires a transaction');
            await enqueueLattice(
              tx,
              realmURL,
              realmUsername,
              args.wave,
              attempt + 1,
            );
          },
        );
      }
      throw error;
    }
    if (result.superseded) {
      // A cancelled derived attempt is not a broken card. Preserve the current
      // dirty obligation, yield the writer slot to newer source work, and let
      // its successor capture current inputs with a fresh budget. A revoked
      // read scope waits durably without occupying a worker until restored.
      await dbAdapter.withWriteLock(`lattice:index:${realmURL}`, async (tx) => {
        if (!tx) throw new Error('Lattice supersession requires a transaction');
        await indexWriter
          .latticePublication(definitionLookup, virtualNetwork)
          .enqueuePending(tx, realmURL, realmUsername, 0, result.waitForRead);
      });
      log.info(
        `Lattice materialization yielded for ${realmURL}: ${result.superseded}`,
      );
      reportStatus(jobInfo, 'finish');
      return result;
    }
    // Materialized cards already committed durable per-owner notices. The
    // empty matching barrier retains the existing realm-level revalidation.
    if (
      result.matchingComplete ||
      (dbAdapter.kind !== 'pg' && result.invalidations.length)
    ) {
      await notifyRealmIndexUpdated(dbAdapter, realmURL);
      reportRealmEvent?.({
        eventName: 'index',
        indexType: 'incremental',
        realmURL,
        invalidations: result.invalidations,
        generation: result.generation,
      });
    }
    if (
      result.invalidations.length &&
      skipsPrerenderHtml(realmURL, skipPrerenderHtmlRealms)
    ) {
      // Configured off for this realm, the same way the indexer treats it.
      log.info(
        `not spawning prerender_html for ${realmURL} after Lattice publication: ` +
          `the realm is listed in --skipPrerenderHtmlRealm`,
      );
    } else if (result.invalidations.length) {
      await enqueuePrerenderHtmlJob(queuePublisher, {
        realmURL,
        realmUsername,
        changes: result.invalidations.map((url) => ({
          url,
          operation: 'update' as const,
        })),
        generation: result.generation!,
        loaderEpoch: result.loaderEpoch!,
        spawningJobId: jobInfo?.jobId ?? null,
        spawningPriority: 8,
        timeoutSec: 600,
        preWarm: false,
      }).catch((error) => {
        // Data is already published and subscribers have been notified. The
        // HTML reconciliation sweep retries a missed rendering enqueue.
        log.error(`Lattice HTML enqueue failed for ${realmURL}`, error);
      });
    }
    reportStatus(jobInfo, 'finish');
    return result;
  };
