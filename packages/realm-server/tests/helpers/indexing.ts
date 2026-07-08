import type { MatrixEvent } from 'https://cardstack.com/base/matrix-event';
import { findRealmEvent, waitUntil } from './index.ts';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import { trimJsonExtension } from '@cardstack/runtime-common';
import type { DBAdapter, Expression } from '@cardstack/runtime-common';
import { every, param, query } from '@cardstack/runtime-common';
import type {
  IncrementalIndexEventContent,
  IncrementalIndexInitiationContent,
} from 'https://cardstack.com/base/matrix-event';
import { validate as uuidValidate } from 'uuid';

interface IncrementalIndexEventTestContext {
  assert: Assert;
  getMessagesSince: (since: number) => Promise<MatrixEvent[]>;
  realm: string;
  type?: string;
  timeout?: number;
}

export async function waitForIncrementalIndexEvent(
  getMessagesSince: (since: number) => Promise<MatrixEvent[]>,
  since: number,
  timeout = 5000,
) {
  // The initiation and completion events are broadcast without await
  // ordering (see Realm#sendIndexInitiationEvent + broadcastIncrementalInvalidationEvent),
  // so matrix sync can surface them in either order. Wait until BOTH are
  // visible so callers that re-fetch and assert on each event don't race.
  let lastSeenInitiation = false;
  let lastSeenIncremental = false;
  await waitUntil(
    async () => {
      let matrixMessages = await getMessagesSince(since);
      let sawInitiation = false;
      let sawIncremental = false;
      for (let m of matrixMessages) {
        if (
          m.type !== APP_BOXEL_REALM_EVENT_TYPE ||
          m.content.eventName !== 'index'
        ) {
          continue;
        }
        if (m.content.indexType === 'incremental-index-initiation') {
          sawInitiation = true;
        } else if (m.content.indexType === 'incremental') {
          sawIncremental = true;
        }
        if (sawInitiation && sawIncremental) {
          return true;
        }
      }
      lastSeenInitiation = sawInitiation;
      lastSeenIncremental = sawIncremental;
      return false;
    },
    {
      timeout,
      timeoutMessage: () =>
        `incremental index events not both received (initiation=${lastSeenInitiation}, incremental=${lastSeenIncremental}, since=${since})`,
    },
  );
}

export async function expectIncrementalIndexEvent(
  url: string, // <>.gts OR <>.json OR <>.* OR <>/
  since: number,
  opts: IncrementalIndexEventTestContext,
) {
  let { assert, getMessagesSince, realm, type, timeout } = opts;

  type = type ?? 'CardDef';

  let endsWithSlash = url.endsWith('/'); // new card def is being created
  let hasExtension = /\.[^/]+$/.test(url);

  if (!hasExtension && !endsWithSlash) {
    throw new Error('Invalid file path');
  }
  await waitForIncrementalIndexEvent(getMessagesSince, since, timeout);

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

  if (!incrementalIndexInitiationEventContent || !incrementalEventContent) {
    let realmEventSummary = messages
      .filter((m) => m.type === APP_BOXEL_REALM_EVENT_TYPE)
      .map((m) => ({
        eventName: (m.content as { eventName?: string })?.eventName,
        indexType: (m.content as { indexType?: string })?.indexType,
        updatedFile: (m.content as { updatedFile?: string })?.updatedFile,
        invalidations: (m.content as { invalidations?: string[] })
          ?.invalidations,
        originServerTs: m.origin_server_ts,
      }));
    console.error(
      `[expectIncrementalIndexEvent] missing event(s) for url=${url} since=${since} realm=${realm}. ` +
        `initiationPresent=${Boolean(
          incrementalIndexInitiationEventContent,
        )} incrementalPresent=${Boolean(
          incrementalEventContent,
        )}. realm events seen (${realmEventSummary.length}): ` +
        JSON.stringify(realmEventSummary),
    );
    if (!incrementalIndexInitiationEventContent) {
      throw new Error('Incremental index initiation event not found');
    }
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

export interface PrerenderedHtmlRow {
  url: string;
  type: 'instance' | 'file';
  isolated_html: string | null;
  head_html: string | null;
  atom_html: string | null;
  embedded_html: Record<string, string> | null;
  fitted_html: Record<string, string> | null;
  markdown: string | null;
  deps: string[] | null;
  generation: number;
  is_deleted: boolean | null;
  error_doc: unknown | null;
}

// Fetch a production `prerendered_html` row for assertions. Returns
// undefined when the URL has no row of that type (e.g. HTML that has not
// been rendered).
export async function prerenderedHtmlRowFor(
  dbAdapter: DBAdapter,
  url: string,
  type: 'instance' | 'file' = 'instance',
): Promise<PrerenderedHtmlRow | undefined> {
  let rows = (await query(dbAdapter, [
    `SELECT * FROM prerendered_html WHERE`,
    ...every([
      ['url =', param(url)],
      ['type =', param(type)],
    ]),
  ] as Expression)) as unknown as PrerenderedHtmlRow[];
  return rows[0];
}

// HTML lands on its own channel: the index pass fires a `prerender_html`
// job (fire-and-forget) and completes without waiting for it, so a test
// that writes and then asserts prerendered HTML must settle that channel
// first. Waits until the realm's `prerender-html:<realm>` concurrency
// group has no unfulfilled jobs and no active reservations, and fails
// loudly if any of its jobs rejected — a broken render should fail the
// test, not silently satisfy the wait.
export async function settlePrerenderHtmlJobs(
  dbAdapter: DBAdapter,
  realmURL: string | URL,
  opts?: { timeout?: number },
): Promise<void> {
  let concurrencyGroup = `prerender-html:${typeof realmURL === 'string' ? realmURL : realmURL.href}`;
  let lastState = '';
  await waitUntil(
    async () => {
      let rows = (await query(dbAdapter, [
        `SELECT j.id, j.status,
           (SELECT COUNT(*)::int FROM job_reservations r
             WHERE r.job_id = j.id AND r.completed_at IS NULL) AS active_reservations
         FROM jobs j WHERE`,
        ...every([['j.concurrency_group =', param(concurrencyGroup)]]),
      ] as Expression)) as {
        id: number;
        status: string;
        active_reservations: number;
      }[];
      let rejected = rows.filter((row) => row.status === 'rejected');
      if (rejected.length > 0) {
        throw new Error(
          `prerender_html job(s) rejected for ${concurrencyGroup}: ${rejected
            .map((row) => row.id)
            .join(', ')}`,
        );
      }
      lastState = JSON.stringify(rows);
      return rows.every(
        (row) => row.status === 'resolved' && row.active_reservations === 0,
      );
    },
    {
      timeout: opts?.timeout ?? 30000,
      interval: 50,
      timeoutMessage: () =>
        `waiting for prerender_html jobs to settle for ${concurrencyGroup}; last state: ${lastState}`,
    },
  );
}

// The generation the realm's index channel is at — the value a fresh
// `prerendered_html` row's `generation` should equal.
export async function currentRealmGeneration(
  dbAdapter: DBAdapter,
  realmURL: string | URL,
): Promise<number | undefined> {
  let rows = (await query(dbAdapter, [
    `SELECT current_generation FROM realm_generations WHERE`,
    ...every([
      [
        'realm_url =',
        param(typeof realmURL === 'string' ? realmURL : realmURL.href),
      ],
    ]),
  ] as Expression)) as { current_generation: number }[];
  return rows[0]?.current_generation;
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
    `ORDER BY generation DESC LIMIT 1`,
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
    `ORDER BY generation DESC LIMIT 1`,
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
    `ORDER BY generation DESC LIMIT 1`,
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
    `ORDER BY generation DESC LIMIT 1`,
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
