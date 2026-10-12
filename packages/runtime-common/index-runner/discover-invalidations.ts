import { ignore, type Ignore } from '../ignore.ts';

import {
  isIgnored,
  jobIdentity,
  REALM_IGNORE_FILES,
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
  // The subset of `urls` that are genuine deletions — present in the index
  // (or the rows a prior attempt of the job staged) but absent from disk. The
  // from-scratch caller threads these to the `prerender_html` job as
  // `operation: 'delete'` so the HTML channel tombstones them too.
  deletedUrls: string[];
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

  let ignoreStart = Date.now();
  let ignoreRules = await readRealmIgnoreRules(url, reader, filesystemMtimes);
  perfDebug(`time to get ignore rules ${Date.now() - ignoreStart} ms`);
  if (ignoreRules) {
    for (let [key, value] of realmIgnoreMap(url, ignoreRules)) {
      ignoreMap.set(key, value);
    }
    ignoreData[url.href] = ignoreRules;
    // An ignored file is not part of the realm: it gets no visit and no
    // prerender, and a row it left from before it was ignored is tombstoned.
    for (let mtimeUrl of Object.keys(filesystemMtimes)) {
      if (isIgnored(url, ignoreMap, new URL(mtimeUrl))) {
        delete filesystemMtimes[mtimeUrl];
      }
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
  // Files present in the production index OR among the rows this job's
  // prior attempt staged, but absent from disk — they need
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
        deletedUrls,
        filesystemMtimes,
      };
    }

    return { urls: invalidationList, deletedUrls, filesystemMtimes };
  }

  let invalidationStart = Date.now();
  await batch.invalidate(invalidationList.map((u) => new URL(u)));
  perfDebug(
    `${jobIdentity(jobInfo)} time to invalidate ${url} ${Date.now() - invalidationStart} ms`,
  );
  return { urls: batch.invalidations, deletedUrls, filesystemMtimes };
}

// The realm root's ignore rules: `.gitignore`, plus `.boxelignore` for files
// that git tracks but that are not part of the realm (a package's tests, its
// build scripts). The two read as one gitignore-syntax list, `.gitignore`
// first, so a `!` line in `.boxelignore` can re-include a path `.gitignore`
// excludes. Only files present in `filesystemMtimes` are read, since asking
// for a missing one is slow.
export async function readRealmIgnoreRules(
  realmURL: URL,
  reader: Reader,
  filesystemMtimes: { [url: string]: number },
): Promise<string | undefined> {
  let rules: string[] = [];
  for (let name of REALM_IGNORE_FILES) {
    let fileURL = new URL(name, realmURL);
    if (!filesystemMtimes[fileURL.href]) {
      continue;
    }
    let file = await reader.readFile(fileURL);
    if (file?.content) {
      rules.push(file.content);
    }
  }
  return rules.length > 0 ? rules.join('\n') : undefined;
}

// The rules `readRealmIgnoreRules` returns, in the form `isIgnored` takes.
export function realmIgnoreMap(
  realmURL: URL,
  ignoreRules: string | undefined,
): Map<string, Ignore> {
  return new Map(
    ignoreRules ? [[realmURL.href, ignore().add(ignoreRules)]] : [],
  );
}
