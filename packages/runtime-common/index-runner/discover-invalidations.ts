import { ignore, type Ignore } from '../ignore.ts';

import {
  jobIdentity,
  type Batch,
  type JobInfo,
  type LastModifiedTimes,
  type Reader,
} from '../index.ts';

interface DiscoverInvalidationsOptions {
  url: URL;
  indexMtimes: LastModifiedTimes;
  reader: Reader;
  batch: Batch;
  ignoreMap: Map<string, Ignore>;
  ignoreData: Record<string, string>;
  jobInfo: JobInfo;
  logDebug(message: string): void;
  perfDebug(message: string): void;
}

export interface DiscoverInvalidationsResult {
  urls: string[];
  // Filesystem mtimes at the moment we discovered invalidations.
  // Returned alongside the URL list so the from-scratch caller can
  // compare against `Batch.resumedRows` and decide whether a row
  // already written by a previous attempt is still authoritative —
  // without paying for a second `reader.mtimes()` round-trip.
  filesystemMtimes: { [url: string]: number };
}

export async function discoverInvalidations({
  url,
  indexMtimes,
  reader,
  batch,
  ignoreMap,
  ignoreData,
  jobInfo,
  logDebug,
  perfDebug,
}: DiscoverInvalidationsOptions): Promise<DiscoverInvalidationsResult> {
  logDebug(
    `${jobIdentity(jobInfo)} discovering invalidations in dir ${url.href}`,
  );
  perfDebug(
    `${jobIdentity(jobInfo)} discovering invalidations in dir ${url.href}`,
  );

  let mtimesStart = Date.now();
  let filesystemMtimes = await reader.mtimes();
  perfDebug(
    `${jobIdentity(jobInfo)} time to get file system mtimes ${Date.now() - mtimesStart} ms`,
  );

  let ignoreFile = new URL('.gitignore', url).href;
  // it costs about 10 sec to try to get the ignore file when it doesn't
  // exist, so don't get it if it's not there.
  if (filesystemMtimes[ignoreFile]) {
    let ignoreStart = Date.now();
    let ignorePatterns = await reader.readFile(new URL(ignoreFile));
    perfDebug(`time to get ignore rules ${Date.now() - ignoreStart} ms`);
    if (ignorePatterns && ignorePatterns.content) {
      ignoreMap.set(url.href, ignore().add(ignorePatterns.content));
      ignoreData[url.href] = ignorePatterns.content;
    }
  } else {
    perfDebug(
      `${jobIdentity(jobInfo)} skip getting the ignore file--there is nothing to ignore`,
    );
  }

  let invalidationList: string[] = [];
  let skipList: string[] = [];
  for (let [mtimeUrl, lastModified] of Object.entries(filesystemMtimes)) {
    let indexEntry = indexMtimes.get(mtimeUrl);

    if (
      !indexEntry ||
      indexEntry.hasError ||
      indexEntry.lastModified == null ||
      lastModified !== indexEntry.lastModified
    ) {
      invalidationList.push(mtimeUrl);
    } else {
      skipList.push(mtimeUrl);
    }
  }
  // Files present in the production index OR in this job's prior
  // attempt's working rows, but absent from disk — they need
  // tombstones. Covering `batch.resumedRows` is what makes the resume
  // safe: without it, a URL the previous attempt processed and that
  // has since been deleted would slip past tombstoning (the
  // resume-guard in `Batch.tombstoneEntries` would protect the row)
  // and `applyBatchUpdates` would promote a stale row, resurrecting
  // the deleted file. Forgetting the resumed entry first lets the
  // tombstone overwrite it.
  let candidateForDeletion = new Set<string>([
    ...indexMtimes.keys(),
    ...batch.resumedRows.keys(),
  ]);
  let deletedUrls = [...candidateForDeletion].filter(
    (u) => !filesystemMtimes[u],
  );
  if (deletedUrls.length > 0) {
    batch.forgetResumedRows(deletedUrls);
    perfDebug(
      `${jobIdentity(jobInfo)} found ${deletedUrls.length} deleted files to add to invalidations: ${deletedUrls.join(', ')}`,
    );
    invalidationList.push(...deletedUrls);
  }

  if (skipList.length === 0) {
    // the whole realm needs to be visited, but we still need to tombstone any
    // deleted files that are only discoverable from the index.
    if (deletedUrls.length > 0) {
      await batch.invalidate(deletedUrls.map((u) => new URL(u)));
      return {
        urls: [...new Set([...invalidationList, ...batch.invalidations])],
        filesystemMtimes,
      };
    }

    return { urls: invalidationList, filesystemMtimes };
  }

  let invalidationStart = Date.now();
  await batch.invalidate(invalidationList.map((u) => new URL(u)));
  perfDebug(
    `${jobIdentity(jobInfo)} time to invalidate ${url} ${Date.now() - invalidationStart} ms`,
  );
  return { urls: batch.invalidations, filesystemMtimes };
}
