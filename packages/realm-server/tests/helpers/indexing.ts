import type { MatrixEvent } from '@cardstack/base/matrix-event';
import { findRealmEvent, waitUntil } from './index';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import { trimJsonExtension } from '@cardstack/runtime-common';
import type { DBAdapter, Expression } from '@cardstack/runtime-common';
import { every, param, query } from '@cardstack/runtime-common';
import type {
  IncrementalIndexEventContent,
  IncrementalIndexInitiationContent,
} from '@cardstack/base/matrix-event';
import { validate as uuidValidate } from 'uuid';

interface IncrementalIndexEventTestContext {
  assert: Assert;
  getMessagesSince: (since: number) => Promise<MatrixEvent[]>;
  realm: string;
  type?: string;
}

export async function waitForIncrementalIndexEvent(
  getMessagesSince: (since: number) => Promise<MatrixEvent[]>,
  since: number,
) {
  await waitUntil(async () => {
    let matrixMessages = await getMessagesSince(since);

    return matrixMessages.some(
      (m) =>
        m.type === APP_BOXEL_REALM_EVENT_TYPE &&
        m.content.eventName === 'index' &&
        m.content.indexType === 'incremental',
    );
  });
}

export async function expectIncrementalIndexEvent(
  url: string, // <>.gts OR <>.json OR <>.* OR <>/
  since: number,
  opts: IncrementalIndexEventTestContext,
) {
  let { assert, getMessagesSince, realm, type } = opts;

  type = type ?? 'CardDef';

  let endsWithSlash = url.endsWith('/'); // new card def is being created
  let hasExtension = /\.[^/]+$/.test(url);

  if (!hasExtension && !endsWithSlash) {
    throw new Error('Invalid file path');
  }
  await waitForIncrementalIndexEvent(getMessagesSince, since);

  let messages = await getMessagesSince(since);
  let incrementalIndexInitiationEventContent = findRealmEvent(
    messages,
    'index',
    'incremental-index-initiation',
  )?.content as IncrementalIndexInitiationContent;

  let incrementalEventContent = findRealmEvent(messages, 'index', 'incremental')
    ?.content as IncrementalIndexEventContent;

  let targetUrl = url;
  if (endsWithSlash) {
    let maybeLocalId = incrementalEventContent.invalidations[0]
      .split('/')
      .pop();
    // check if the card identifier is a UUID
    assert.true(uuidValidate(maybeLocalId!), 'card identifier is a UUID');
    assert.strictEqual(
      incrementalEventContent.invalidations[0],
      `${realm}${type}/${maybeLocalId}`,
    );
    targetUrl = `${realm}${type}/${maybeLocalId}.json`;
  }

  // For instances, the updatedFile includes .json extension but invalidations don't
  // For source files, both updatedFile and invalidations include the full path with extension
  let invalidation = targetUrl.endsWith('.json')
    ? trimJsonExtension(targetUrl)
    : targetUrl;

  if (!incrementalIndexInitiationEventContent) {
    throw new Error('Incremental index initiation event not found');
  }
  if (!incrementalEventContent) {
    throw new Error('Incremental event content not found');
  }
  assert.deepEqual(incrementalIndexInitiationEventContent, {
    eventName: 'index',
    indexType: 'incremental-index-initiation',
    updatedFile: targetUrl,
    realmURL: realm,
  });

  let expectedIncrementalContent: any = {
    eventName: 'index',
    indexType: 'incremental',
    invalidations: [invalidation],
    realmURL: realm,
  };

  let actualContent = { ...incrementalEventContent };
  delete actualContent.clientRequestId;

  assert.deepEqual(actualContent, expectedIncrementalContent);
  return incrementalEventContent;
}

export async function depsForIndexEntry(
  dbAdapter: DBAdapter,
  url: string,
  type: 'instance' | 'file' = 'instance',
): Promise<string[]> {
  let rows = (await query(dbAdapter, [
    `SELECT deps FROM boxel_index WHERE`,
    ...every([
      ['url =', param(url)],
      ['type =', param(type)],
    ]),
    `ORDER BY realm_version DESC LIMIT 1`,
  ] as Expression)) as { deps: string[] | string | null }[];
  let rawDeps = rows[0]?.deps ?? [];
  if (Array.isArray(rawDeps)) {
    return rawDeps;
  }
  if (typeof rawDeps === 'string') {
    return JSON.parse(rawDeps) as string[];
  }
  return [];
}

export async function indexedAtForIndexEntry(
  dbAdapter: DBAdapter,
  url: string,
  type: 'instance' | 'file' = 'instance',
): Promise<string | null> {
  let rows = (await query(dbAdapter, [
    `SELECT indexed_at FROM boxel_index WHERE`,
    ...every([
      ['url =', param(url)],
      ['type =', param(type)],
    ]),
    `ORDER BY realm_version DESC LIMIT 1`,
  ] as Expression)) as { indexed_at: string | number | null }[];
  let value = rows[0]?.indexed_at ?? null;
  if (value == null) {
    return null;
  }
  return String(value);
}

export async function typeForIndexEntry(
  dbAdapter: DBAdapter,
  url: string,
): Promise<string | null> {
  let rows = (await query(dbAdapter, [
    `SELECT type FROM boxel_index WHERE`,
    ...every([['url =', param(url)]]),
    `ORDER BY realm_version DESC LIMIT 1`,
  ] as Expression)) as { type: string }[];
  return rows[0]?.type ?? null;
}

export async function errorDocForIndexEntry(
  dbAdapter: DBAdapter,
  url: string,
  type: 'instance' | 'file' = 'instance',
): Promise<{ hasError: boolean; errorDoc: unknown | null } | null> {
  let rows = (await query(dbAdapter, [
    `SELECT has_error, error_doc FROM boxel_index WHERE`,
    ...every([
      ['url =', param(url)],
      ['type =', param(type)],
    ]),
    `ORDER BY realm_version DESC LIMIT 1`,
  ] as Expression)) as {
    has_error: boolean | null;
    error_doc: unknown | string | null;
  }[];
  let row = rows[0];
  if (!row) {
    return null;
  }
  let errorDoc = row.error_doc;
  if (typeof errorDoc === 'string') {
    try {
      errorDoc = JSON.parse(errorDoc);
    } catch (_err) {
      // Keep the original string when DB driver already returns serialized JSON.
    }
  }
  return {
    hasError: Boolean(row.has_error),
    errorDoc: errorDoc ?? null,
  };
}
