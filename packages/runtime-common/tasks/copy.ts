import type { Task, WorkerArgs } from './index';

import { jobIdentity } from '../index';

export { copy };

export interface CopyArgs extends WorkerArgs {
  sourceRealmURL: string;
}

export interface CopyResult {
  totalNonErrorIndexEntries: number;
  invalidations: string[];
}

const copy: Task<CopyArgs, CopyResult> = ({ reportStatus, log, indexWriter }) =>
  async function (args) {
    let { jobInfo, realmURL, sourceRealmURL } = args;
    log.debug(
      `${jobIdentity(jobInfo)} starting copy indexing for job: ${JSON.stringify(args)}`,
    );
    reportStatus(jobInfo, 'start');
    let batch = await indexWriter.createBatch(new URL(realmURL));
    await batch.copyFrom(new URL(sourceRealmURL));
    let result = await batch.done();
    let invalidations = batch.invalidations;
    log.debug(
      `${jobIdentity(jobInfo)} completed copy indexing for realm ${realmURL}:\n${JSON.stringify(
        result,
        null,
        2,
      )}`,
    );
    let { totalIndexEntries: totalNonErrorIndexEntries } = result;
    reportStatus(jobInfo, 'finish');
    return {
      invalidations,
      totalNonErrorIndexEntries,
    };
  };
