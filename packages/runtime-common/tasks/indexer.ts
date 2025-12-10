import type * as JSONTypes from 'json-typescript';
import type { Task, WorkerArgs } from './index';
import {
  jobIdentity,
  userIdFromUsername,
  fetchUserPermissions,
  type RealmPermissions,
} from '../index';
import { IndexRunner } from '../index-runner';
import type { Stats } from '../worker';

export { fromScratchIndex, incrementalIndex };

export interface IncrementalArgs extends WorkerArgs {
  urls: string[];
  operation: 'update' | 'delete';
  ignoreData: Record<string, string>;
  clientRequestId: string | null;
}

export interface IncrementalResult {
  invalidations: string[];
  ignoreData: Record<string, string>;
  stats: Stats;
}

export type FromScratchArgs = WorkerArgs;

export interface FromScratchResult extends JSONTypes.Object {
  ignoreData: Record<string, string>;
  stats: Stats;
}

const fromScratchIndex: Task<FromScratchArgs, FromScratchResult> = ({
  log,
  reportStatus,
  dbAdapter,
  matrixURL,
  indexWriter,
  getReader,
  getAuthedFetch,
  prerenderer,
  createPrerenderAuth,
}) =>
  async function (args) {
    let { jobInfo, realmUsername, realmURL } = args;
    log.debug(
      `${jobIdentity(args.jobInfo)} starting from-scratch indexing for job: ${JSON.stringify(args)}`,
    );
    reportStatus(jobInfo, 'start');
    let userId = userIdFromUsername(realmUsername, matrixURL);
    let permissions = await fetchUserPermissions(dbAdapter, { userId });
    let prerenderPermissions = ensureRealmOwnerPermissions(
      permissions,
      realmURL,
    );
    let auth = createPrerenderAuth(userId, prerenderPermissions);

    let _fetch = await getAuthedFetch(args);
    let reader = getReader(_fetch, realmURL);
    let currentRun = new IndexRunner({
      realmURL: new URL(realmURL),
      reader,
      indexWriter,
      jobInfo,
      reportStatus,
      auth,
      fetch: _fetch,
      prerenderer,
    });
    let { stats, ignoreData } = await IndexRunner.fromScratch(currentRun);

    log.debug(
      `${jobIdentity(jobInfo)} completed from-scratch indexing for realm ${
        args.realmURL
      }:\n${JSON.stringify(stats, null, 2)}`,
    );
    reportStatus(args.jobInfo, 'finish');
    return {
      ignoreData: { ...ignoreData },
      stats,
    };
  };

const incrementalIndex: Task<IncrementalArgs, IncrementalResult> = ({
  log,
  reportStatus,
  dbAdapter,
  matrixURL,
  indexWriter,
  getReader,
  getAuthedFetch,
  prerenderer,
  createPrerenderAuth,
}) =>
  async function (args) {
    let { jobInfo, realmUsername, urls, realmURL, operation } = args;

    log.debug(
      `${jobIdentity(jobInfo)} starting incremental indexing for job: ${JSON.stringify(args)}`,
    );
    reportStatus(jobInfo, 'start');
    let userId = userIdFromUsername(realmUsername, matrixURL);
    let permissions = await fetchUserPermissions(dbAdapter, { userId });
    let prerenderPermissions = ensureRealmOwnerPermissions(
      permissions,
      realmURL,
    );
    let auth = createPrerenderAuth(userId, prerenderPermissions);

    let _fetch = await getAuthedFetch(args);
    let reader = getReader(_fetch, realmURL);
    let currentRun = new IndexRunner({
      realmURL: new URL(realmURL),
      reader,
      indexWriter,
      jobInfo,
      reportStatus,
      auth,
      fetch: _fetch,
      prerenderer,
      ignoreData: args.ignoreData,
    });
    let { stats, invalidations, ignoreData } = await IndexRunner.incremental(
      currentRun,
      {
        urls: urls.map((u) => new URL(u)),
        operation,
      },
    );

    log.debug(
      `${jobIdentity(jobInfo)} completed incremental indexing for  ${urls.join()}:\n${JSON.stringify(
        { ...stats, invalidations },
        null,
        2,
      )}`,
    );
    reportStatus(jobInfo, 'finish');
    return {
      ignoreData: { ...ignoreData },
      invalidations,
      stats,
    };
  };

function ensureRealmOwnerPermissions(
  permissions: RealmPermissions,
  realmURL: string,
): RealmPermissions {
  let next: RealmPermissions = { ...permissions };
  let existing = new Set(next[realmURL] ?? []);
  existing.add('read');
  existing.add('realm-owner');
  next[realmURL] = [...existing];
  return next;
}
