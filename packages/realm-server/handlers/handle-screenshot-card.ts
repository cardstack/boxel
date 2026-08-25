import type Koa from 'koa';

import {
  captureSpecHash,
  ensureTrailingSlash,
  fetchRealmPermissions,
  findLiveInstanceGeneration,
  findMediaCacheEntry,
  isCaptureFormat,
  isScreenshotFormat,
  parseScreenshotCaptureSpec,
  screenshotURLFor,
  touchMediaCacheEntryOnHit,
  type CaptureSpec,
  type DBAdapter,
  type MediaCacheEntry,
  type MediaCacheEntryKey,
  type ScreenshotPrerenderResponse,
} from '@cardstack/runtime-common';
import RealmPermissionChecker from '@cardstack/runtime-common/realm-permission-checker';
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
// (`includeBase64: false` opts out). `name` is null for ad-hoc captures —
// it populates for declared-screenshot batches. `deviceScaleFactor` is the
// effective scale the capture engine reports, or null when serving from the
// ledger, which does not record it.
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
 * This endpoint skips that gate deliberately: it is an authenticated
 * surface with full captureSpec power under realm-read trust. Realm read is
 * enforced in two places: the ledger fast path (and the generation probe
 * feeding it) checks it here, since it answers before any job exists; the
 * render path relies on the worker task's permission check.
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
 *       "includeBase64": true,
 *       "captureSpec": {
 *         "viewport": { "width": 1280, "height": 800 },
 *         "deviceScaleFactor": 2,
 *         "fullPage": true,
 *         "clip": { "x": 0, "y": 0, "width": 400, "height": 300 }
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * `captureSpec` is optional; every field within it is optional. It is
 * validated by the shared strict parse in `capture-spec.ts` (viewport ≤
 * 4096×16384, deviceScaleFactor ≤ 3, clip bounded by the same caps as the
 * viewport and within the viewport when one is given, physical pixels per
 * edge ≤ the Chromium texture cap, `fullPage` and `clip` mutually exclusive
 * — the prerender server's screenshot route runs the identical parse), so
 * the worker downstream can treat it as trusted. The parse is strict: a
 * field the engine cannot honor is refused by name — never ignored — and
 * default-valued fields (`fullPage: false`, `deviceScaleFactor: 1`) are
 * elided so equal capture intents classify identically. Invalid specs
 * return a 400 naming the offending field. The one bound no request-time
 * parse can enforce — a fullPage capture's document extent — is checked
 * against the same physical-pixel cap at capture time.
 * `format` may be `isolated`, `embedded`, or `fitted`. The `fitted` format
 * renders into a parent-owned box, so it requires an `envelope`
 * (`{ width, height }` in CSS px) on the captureSpec — or on every batch
 * entry; requesting it without one returns a 400. Conversely
 * `isolated`/`embedded` fill the viewport and reject an envelope. An
 * envelope-carrying spec always has overrides, so fitted captures are always
 * capture-only.
 *
 * A batch of captures may be requested via `captureSpec.captures`, an array
 * of named `{ name, ...overrides }` entries (bounded by
 * `SCREENSHOT_MAX_CAPTURES`). Each entry's overrides win over the singular
 * `captureSpec` fields, which act as batch-wide defaults; the shared parse
 * normalizes each entry to its fully-merged spec so the capture path iterates
 * them directly against one settled render. The response's `captures` then
 * carries one `{ name, base64, width, height, deviceScaleFactor }` entry per
 * capture, with the top-level `base64`/`width`/`height` mirroring
 * `captures[0]` for byte-compatibility with singular-shape callers.
 *
 * A spec with overrides — a batch always is one — is capture-only: the
 * ledger's canonical capture identity cannot represent it yet (the GET DSL
 * reserves those params), so it always renders fresh and returns raw bytes —
 * no ledger fast path, no MediaCache persist, no `captures` URL.
 *
 * The `runAs` user is derived from the authenticated JWT.
 */

// The captureSpec bounds and strict parse live in `capture-spec.ts`
// (runtime-common) so this handler and the prerender server's screenshot
// route validate identically; see the constants and rules there.

export default function handleScreenshotCard({
  dbAdapter,
  queue,
  matrixClient,
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
    // Shared with the prerender server's screenshot route so both surfaces
    // accept exactly the same capture formats. Wider than the GET
    // `_screenshot/` DSL's formats: fitted is capture-only (it always
    // require an envelope, so they never touch the canonical ledger identity).
    if (!isScreenshotFormat(format)) {
      return sendResponseForBadRequest(
        ctxt,
        'format must be "isolated", "embedded", or "fitted"',
      );
    }
    if (includeBase64 !== undefined && typeof includeBase64 !== 'boolean') {
      return sendResponseForBadRequest(ctxt, 'includeBase64 must be a boolean');
    }
    let withBase64 = includeBase64 !== false;
    // Both URLs go through `new URL` resolution (dot segments,
    // percent-encoding, default ports) before anything derives from them:
    // the containment check below must mean real containment (a dotted
    // `cardId` prefixed with the realm URL escapes a plain string-prefix
    // test), and the persist identity must key an instance exactly the way
    // the GET route's `paths.fileURL` derivation does.
    let normalizedRealmURL: string;
    let normalizedCardId: string;
    try {
      normalizedRealmURL = ensureTrailingSlash(new URL(realmURL).href);
      normalizedCardId = new URL(cardId).href;
    } catch {
      return sendResponseForBadRequest(
        ctxt,
        'realmURL and cardId must be valid absolute URLs',
      );
    }
    // The persist identity (and the served URL) hang off the instance's
    // location within its realm.
    if (!normalizedCardId.startsWith(normalizedRealmURL)) {
      return sendResponseForBadRequest(ctxt, 'cardId must be within realmURL');
    }
    let sourceURL = normalizedCardId.replace(/\.json$/, '');
    let instanceLocalPath = sourceURL.slice(normalizedRealmURL.length);

    let captureSpecParse = parseScreenshotCaptureSpec(
      attrs.captureSpec,
      format,
    );
    if (captureSpecParse.error) {
      return sendResponseForBadRequest(ctxt, captureSpecParse.error);
    }
    let captureSpec = captureSpecParse.captureSpec ?? null;

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
      // A custom `captureSpec` has no representation in the ledger's
      // canonical capture identity yet — the GET `_screenshot/` DSL reserves
      // `viewport`/`dsf`/`fullPage`/`clip` — so persisting one under the
      // format-only key would let a custom render serve on the canonical
      // URL. Custom captures render fresh and return bytes only: no ledger
      // fast path, no persist, no served URL. The parse normalizes an
      // all-defaults spec to null, so null exactly means canonical.
      let isCanonicalCapture = captureSpec === null;
      // The canonical capture identity speaks the GET DSL's formats only.
      // fitted can never reach here (it requires an envelope, so its
      // spec is never null), but the guard keeps that invariant executable
      // and narrows the type.
      let spec: CaptureSpec | undefined =
        isCanonicalCapture && isCaptureFormat(format) ? { format } : undefined;
      if (mediaCacheAdapter && spec) {
        // The ledger fast path and the generation probe feeding it answer
        // from the store before any job exists, so the worker task's
        // permission check never covers them — realm read is enforced here
        // instead (ahead of the probe, which alone would leak instance
        // existence on a private realm). Read is checked the way the realm
        // itself checks it — exact rows plus the `*` and `users` grants. A
        // caller without read goes straight to the render path, whose
        // permissions the worker enforces, and never persists.
        let permissions = await fetchRealmPermissions(
          dbAdapter,
          new URL(normalizedRealmURL),
        );
        let mayRead = await new RealmPermissionChecker(
          permissions,
          matrixClient,
        ).can(userId, 'read');
        if (mayRead) {
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
      }

      if (entryKey && spec) {
        let entry = await findMediaCacheEntry(dbAdapter, entryKey);
        if (entry) {
          let response = await respondFromLedger({
            entry,
            withBase64,
            normalizedRealmURL,
            instanceLocalPath,
            spec,
            mediaCacheAdapter: mediaCacheAdapter!,
            dbAdapter,
          });
          if (response) {
            return await setContextResponse(ctxt, response);
          }
          // The entry's object was reclaimed between the ledger read and
          // the stream open — fall through and re-capture.
        }
      }

      // The canonical realm URL keys the per-realm serialization lane (the
      // job's default concurrency group) so this surface and the GET lane —
      // which keys off the realm's own URL — share one lane per realm.
      let job = await enqueueScreenshotCardJob(
        {
          realmURL: normalizedRealmURL,
          realmUsername: userId,
          runAs: userId,
          cardId: normalizedCardId,
          format,
          captureSpec,
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
        //
        // That resume applies only to canonical captures. A custom
        // captureSpec's job is capture-only (persist: null, never
        // coalesced), so its timed-out render is discarded and each retry
        // is a full re-render — the Retry-After here is pacing, not a
        // cheap-resume promise, until the ledger identity learns these
        // specs.
        let estimate = await estimateScreenshotQueueWait(
          dbAdapter,
          `screenshot:${normalizedRealmURL}`,
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
        // The capture engine's captures[] entries carry their own base64;
        // honor the opt-out there too.
        if (Array.isArray(attributes.captures)) {
          attributes.captures = attributes.captures.map(
            ({ base64: _dropped, ...rest }) => rest,
          );
        }
      }
      if (entryKey && spec && result.status === 'ready') {
        // A canonical capture persisted under its ledger identity: replace
        // the engine's byte-only captures[] entry with the durable served-URL
        // form, carrying through the effective scale the engine reports.
        attributes.captures = [
          captureResult({
            withBase64,
            base64: result.base64,
            width: result.width ?? null,
            height: result.height ?? null,
            deviceScaleFactor: result.captures?.[0]?.deviceScaleFactor ?? null,
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
  deviceScaleFactor = null,
  normalizedRealmURL,
  instanceLocalPath,
  spec,
}: {
  withBase64: boolean;
  base64: string | undefined;
  width: number | null;
  height: number | null;
  deviceScaleFactor?: number | null;
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
    deviceScaleFactor,
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
  dbAdapter,
}: {
  entry: MediaCacheEntry;
  withBase64: boolean;
  normalizedRealmURL: string;
  instanceLocalPath: string;
  spec: CaptureSpec;
  mediaCacheAdapter: NonNullable<CreateRoutesArgs['mediaCacheAdapter']>;
  dbAdapter: DBAdapter;
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
  // A hit consumed through this endpoint is a use like any GET serve: the
  // same guarded bump (on-demand lane only, hourly-throttled) keeps a
  // capture refreshed exclusively via POST from aging out of the GC's
  // idle TTL while in active use.
  await touchMediaCacheEntryOnHit(dbAdapter, entry);
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
