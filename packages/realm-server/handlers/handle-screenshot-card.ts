import type Koa from 'koa';

import {
  captureSpecHash,
  ensureTrailingSlash,
  findLiveInstanceGeneration,
  findMediaCacheEntry,
  isCaptureFormat,
  screenshotURLFor,
  type CaptureSpec,
  type MediaCacheEntry,
  type MediaCacheEntryKey,
  type ScreenshotPrerenderResponse,
} from '@cardstack/runtime-common';
import {
  enqueueScreenshotCardJob,
  estimateScreenshotQueueWait,
  SCREENSHOT_SYNC_WAIT_BUDGET_MS,
} from '@cardstack/runtime-common/jobs/screenshot-card';
import { userInitiatedPriority } from '@cardstack/runtime-common/queue';

import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';

// One entry of the response's `captures` array: the durable served URL is
// the reference callers should embed (a re-capture rotates its bytes, never
// the URL); `base64` rides along by default until callers migrate to URLs
// (`includeBase64: false` opts out). `name` and `deviceScaleFactor` are
// null for ad-hoc captures — they populate for declared-screenshot batches
// and once the capture engine reports a scale factor.
interface CaptureResult {
  name: string | null;
  url: string;
  width: number | null;
  height: number | null;
  deviceScaleFactor: number | null;
  base64?: string;
}

/**
 * Handler for `POST /_screenshot-card`.
 *
 * Captures one card and persists the capture to the MediaCache under its
 * canonical identity (instance URL × canonical capture spec × the
 * instance's current index generation) — the same key the GET
 * `_screenshot/` DSL resolves, so a capture published here serves on that
 * route immediately, even on realms whose `allowArbitraryScreenshots` gate
 * is closed (the gate blocks new GET-triggered captures, never serving).
 * This endpoint itself is deliberately ungated: it is an authenticated
 * surface with full captureSpec power under realm-read trust.
 *
 * A request whose canonical identity already has a ledger entry answers
 * from the store with zero render work — which is also what lets a
 * timed-out request resume: the job persists its capture even after the
 * HTTP wait gives up (503 + Retry-After, bounded well under the ALB idle
 * timeout), so the retry is a pure ledger hit.
 *
 * Response (201): `data.attributes` carries the raw capture fields —
 * `status`, `base64`, `width`, `height`, `contentType` — for
 * byte-compatibility with current-shape callers, plus `captures:
 * [{name, url, width, height, deviceScaleFactor, base64?}]` when the
 * capture persisted. A card the index doesn't know (or a server without a
 * MediaCache store) still captures and returns the raw fields, just
 * without `captures`.
 *
 * Request body (JSON:API):
 * ```json
 * {
 *   "data": {
 *     "type": "screenshot-card",
 *     "attributes": {
 *       "realmURL": "https://realm.example/user/workspace/",
 *       "cardId": "https://realm.example/user/workspace/Person/fadhlan",
 *       "format": "isolated",
 *       "includeBase64": true
 *     }
 *   }
 * }
 * ```
 *
 * The `runAs` user is derived from the authenticated JWT.
 */
export default function handleScreenshotCard({
  dbAdapter,
  queue,
  mediaCacheAdapter,
  screenshotSyncWaitMs = SCREENSHOT_SYNC_WAIT_BUDGET_MS,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let request = await fetchRequestFromContext(ctxt);
    let body: any;
    try {
      body = await request.json();
    } catch {
      return sendResponseForBadRequest(ctxt, 'Invalid JSON body');
    }

    let attrs = body?.data?.attributes;
    if (!attrs) {
      return sendResponseForBadRequest(
        ctxt,
        'Missing data.attributes in request body',
      );
    }

    let { realmURL, cardId, format, includeBase64 } = attrs;
    if (!realmURL || typeof realmURL !== 'string') {
      return sendResponseForBadRequest(ctxt, 'realmURL is required');
    }
    if (!cardId || typeof cardId !== 'string') {
      return sendResponseForBadRequest(ctxt, 'cardId is required');
    }
    // Shared with the GET `_screenshot/` DSL so both surfaces accept exactly
    // the same capture formats.
    if (!isCaptureFormat(format)) {
      return sendResponseForBadRequest(
        ctxt,
        'format must be "isolated" or "embedded"',
      );
    }
    if (includeBase64 !== undefined && typeof includeBase64 !== 'boolean') {
      return sendResponseForBadRequest(ctxt, 'includeBase64 must be a boolean');
    }
    let withBase64 = includeBase64 !== false;
    let normalizedRealmURL = ensureTrailingSlash(realmURL);
    // The persist identity (and the served URL) hang off the instance's
    // location within its realm.
    if (!cardId.startsWith(normalizedRealmURL)) {
      return sendResponseForBadRequest(ctxt, 'cardId must be within realmURL');
    }
    let spec: CaptureSpec = { format };
    let sourceURL = cardId.replace(/\.json$/, '');
    let instanceLocalPath = sourceURL.slice(normalizedRealmURL.length);

    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token?.user) {
      return sendResponseForBadRequest(
        ctxt,
        'Authenticated user not found in JWT',
      );
    }
    let userId = token.user;

    try {
      // The canonical capture identity — resolvable only when the instance
      // is indexed (the generation is part of the key) and this server has
      // a store. Without either, the capture still runs; it just isn't
      // persisted and the response carries no served URL.
      let entryKey: MediaCacheEntryKey | undefined;
      if (mediaCacheAdapter) {
        let generation = await findLiveInstanceGeneration(dbAdapter, {
          realmURL: normalizedRealmURL,
          instanceURL: sourceURL,
        });
        if (generation !== undefined) {
          entryKey = {
            realmURL: normalizedRealmURL,
            sourceURL,
            captureSpecHash: await captureSpecHash(spec),
            sourceGeneration: generation,
          };
        }
      }

      if (entryKey) {
        let entry = await findMediaCacheEntry(dbAdapter, entryKey);
        if (entry) {
          let response = await respondFromLedger({
            entry,
            withBase64,
            normalizedRealmURL,
            instanceLocalPath,
            spec,
            mediaCacheAdapter: mediaCacheAdapter!,
          });
          if (response) {
            return await setContextResponse(ctxt, response);
          }
          // The entry's object was reclaimed between the ledger read and
          // the stream open — fall through and re-capture.
        }
      }

      let job = await enqueueScreenshotCardJob(
        {
          realmURL,
          realmUsername: userId,
          runAs: userId,
          cardId,
          format,
          persist: entryKey ? { ...entryKey, lane: 'on-demand' } : null,
        },
        queue,
        dbAdapter,
        userInitiatedPriority,
      );

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timedOut = Symbol('sync-wait-timeout');
      let result: ScreenshotPrerenderResponse | typeof timedOut;
      try {
        result = await Promise.race([
          job.done,
          new Promise<typeof timedOut>((resolve) => {
            timeoutHandle = setTimeout(
              () => resolve(timedOut),
              screenshotSyncWaitMs,
            );
            timeoutHandle.unref?.();
          }),
        ]);
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }
      if (result === timedOut) {
        // The job keeps running and (when persisting) lands its capture in
        // the MediaCache, so the client's retry answers from the ledger
        // with no second render. The retry hint is one average capture.
        let estimate = await estimateScreenshotQueueWait(
          dbAdapter,
          `screenshot:${realmURL}`,
        );
        return await setContextResponse(
          ctxt,
          new Response(null, {
            status: 503,
            headers: {
              'retry-after': String(
                Math.max(
                  1,
                  Math.ceil(Math.max(estimate.avgCaptureMs, 1000) / 1000),
                ),
              ),
            },
          }),
        );
      }

      let attributes: Record<string, unknown> = { ...result };
      if (!withBase64) {
        delete attributes.base64;
      }
      if (entryKey && result.status === 'ready') {
        attributes.captures = [
          captureResult({
            withBase64,
            base64: result.base64,
            width: result.width ?? null,
            height: result.height ?? null,
            normalizedRealmURL,
            instanceLocalPath,
            spec,
          }),
        ];
      }

      await setContextResponse(
        ctxt,
        new Response(
          JSON.stringify({
            data: {
              type: 'screenshot-card-result',
              attributes,
            },
          }),
          {
            status: 201,
            headers: { 'Content-Type': 'application/vnd.api+json' },
          },
        ),
      );
    } catch (error) {
      console.error('Failed to execute screenshot-card job:', error);
      return sendResponseForSystemError(ctxt, 'Screenshot job failed');
    }
  };
}

function captureResult({
  withBase64,
  base64,
  width,
  height,
  normalizedRealmURL,
  instanceLocalPath,
  spec,
}: {
  withBase64: boolean;
  base64: string | undefined;
  width: number | null;
  height: number | null;
  normalizedRealmURL: string;
  instanceLocalPath: string;
  spec: CaptureSpec;
}): CaptureResult {
  return {
    name: null,
    url: screenshotURLFor({
      realmURL: normalizedRealmURL,
      instanceLocalPath,
      spec,
    }),
    width,
    height,
    deviceScaleFactor: null,
    ...(withBase64 && base64 !== undefined ? { base64 } : {}),
  };
}

// A ledger hit answers with zero render work, in the same envelope a fresh
// capture produces. Returns undefined when the entry's object is gone from
// the store (reclaimed under a live row) so the caller re-captures.
async function respondFromLedger({
  entry,
  withBase64,
  normalizedRealmURL,
  instanceLocalPath,
  spec,
  mediaCacheAdapter,
}: {
  entry: MediaCacheEntry;
  withBase64: boolean;
  normalizedRealmURL: string;
  instanceLocalPath: string;
  spec: CaptureSpec;
  mediaCacheAdapter: NonNullable<CreateRoutesArgs['mediaCacheAdapter']>;
}): Promise<Response | undefined> {
  let base64: string | undefined;
  if (withBase64) {
    let stream = await mediaCacheAdapter.getStream(entry.objectKey);
    if (!stream) {
      return undefined;
    }
    let chunks: Buffer[] = [];
    for await (let chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    base64 = Buffer.concat(chunks).toString('base64');
  } else if (!(await mediaCacheAdapter.head(entry.objectKey))) {
    return undefined;
  }
  let attributes: Record<string, unknown> = {
    status: 'ready',
    width: entry.width,
    height: entry.height,
    contentType: entry.contentType,
    ...(withBase64 ? { base64 } : {}),
    captures: [
      captureResult({
        withBase64,
        base64,
        width: entry.width,
        height: entry.height,
        normalizedRealmURL,
        instanceLocalPath,
        spec,
      }),
    ],
  };
  return new Response(
    JSON.stringify({
      data: { type: 'screenshot-card-result', attributes },
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/vnd.api+json' },
    },
  );
}
