import type { Ignore } from 'ignore';

import {
  hasExecutableExtension,
  isCardResource,
  isIgnored,
  jobIdentity,
  unixTime,
  type Batch,
  type JobInfo,
  type LocalPath,
  type LooseCardResource,
  type Reader,
  type RealmPaths,
} from '../index';
import { CardError } from '../error';

interface VisitFileOptions {
  url: URL;
  realmURL: URL;
  ignoreMap: Map<string, Ignore>;
  realmPaths: RealmPaths;
  reader: Reader;
  batch: Batch;
  jobInfo: JobInfo;
  logDebug(message: string): void;
  logWarn(message: string): void;
  indexCard(args: {
    path: LocalPath;
    lastModified: number;
    resourceCreatedAt: number;
    resource: LooseCardResource;
  }): Promise<void>;
  indexFile(args: {
    path: LocalPath;
    lastModified: number;
    resourceCreatedAt: number;
    hasModulePrerender?: boolean;
  }): Promise<void>;
}

export async function visitFileForIndexing({
  url,
  realmURL,
  ignoreMap,
  realmPaths,
  reader,
  batch,
  jobInfo,
  logDebug,
  logWarn,
  indexCard,
  indexFile,
}: VisitFileOptions): Promise<void> {
  if (isIgnored(realmURL, ignoreMap, url)) {
    return;
  }
  let start = Date.now();
  logDebug(`${jobIdentity(jobInfo)} begin visiting file ${url.href}`);

  let localPath: string;
  try {
    localPath = realmPaths.local(url);
  } catch (_e) {
    // until we have cross realm invalidation, if our invalidation
    // graph cross a realm just skip over the file. it will be out
    // of date, but such is life...
    logDebug(
      `${jobIdentity(jobInfo)} Visit of ${url.href} cannot be performed as it is in a different realm than the realm whose contents are being invalidated (${realmURL.href})`,
    );
    return;
  }

  let fileRef = await reader.readFile(url);
  if (!fileRef) {
    fileRef = await reader.readFile(new URL(encodeURI(localPath), url));
  }
  if (!fileRef) {
    let error = new CardError(`missing file ${url.href}`, { status: 404 });
    error.deps = [url.href];
    throw error;
  }

  let { content, lastModified } = fileRef;
  // ensure created_at exists for this file and use it for resourceCreatedAt
  let resourceCreatedAt = await batch.ensureFileCreatedAt(localPath);
  let isModule = hasExecutableExtension(url.href);

  if (url.href.endsWith('.json')) {
    let resource: unknown;
    try {
      let { data } = JSON.parse(content);
      resource = data;
    } catch (_e) {
      logWarn(
        `${jobIdentity(jobInfo)} unable to parse ${url.href} as card JSON`,
      );
    }

    if (resource && isCardResource(resource)) {
      if (lastModified == null) {
        logWarn(
          `${jobIdentity(jobInfo)} No lastModified date available for ${url.href}, using current time`,
        );
        lastModified = unixTime(Date.now());
      }

      await indexCard({
        path: localPath,
        lastModified,
        resourceCreatedAt,
        resource,
      });
      // Intentionally fall through so card JSON files also get a file entry.
    }
  }

  if (lastModified == null) {
    logWarn(
      `${jobIdentity(jobInfo)} No lastModified date available for ${url.href}, using current time`,
    );
    lastModified = unixTime(Date.now());
  }

  await indexFile({
    path: localPath,
    lastModified,
    resourceCreatedAt,
    hasModulePrerender: isModule,
  });
  logDebug(
    `${jobIdentity(jobInfo)} completed visiting file ${url.href} in ${Date.now() - start}ms`,
  );
}
