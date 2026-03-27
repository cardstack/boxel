import ignore, { type Ignore } from 'ignore';

import {
  jobIdentity,
  type Batch,
  type JobInfo,
  type LastModifiedTimes,
  type Reader,
} from '../index';

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
}: DiscoverInvalidationsOptions): Promise<string[]> {
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
  // Check for deleted files - files that exist in index but not on filesystem
  let indexedUrls = [...indexMtimes.keys()];
  let deletedUrls = indexedUrls.filter(
    (indexedUrl) => !filesystemMtimes[indexedUrl],
  );
  if (deletedUrls.length > 0) {
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
      return [...new Set([...invalidationList, ...batch.invalidations])];
    }

    return invalidationList;
  }

  let invalidationStart = Date.now();
  await batch.invalidate(invalidationList.map((u) => new URL(u)));
  perfDebug(
    `${jobIdentity(jobInfo)} time to invalidate ${url} ${Date.now() - invalidationStart} ms`,
  );
  return batch.invalidations;
}
