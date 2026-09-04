import type * as JSONTypes from 'json-typescript';

import type { Task } from './index.ts';

import {
  captureSpecHash,
  fetchEffectiveRealmPermissions,
  fetchUserPermissions,
  isCaptureFormat,
  jobIdentity,
  putMedia,
  updateMediaCacheDiagnostics,
  emitScreenshotPerf,
  type MediaCacheLane,
  type ScreenshotCaptureSpec,
  type ScreenshotCapturePerfEvent,
  type ScreenshotPersistOutcome,
  type ScreenshotFormat,
  type ScreenshotPrerenderResponse,
  type ScreenshotRequestSurface,
  ensureFullMatrixUserId,
  ensureTrailingSlash,
} from '../index.ts';

// The ledger identity a capture persists under (see
// `ScreenshotCardArgs.persist`).
export interface ScreenshotPersistArgs extends JSONTypes.Object {
  realmURL: string;
  sourceURL: string;
  captureSpecHash: string;
  sourceGeneration: number;
  lane: MediaCacheLane;
}

export interface ScreenshotCardArgs extends JSONTypes.Object {
  realmURL: string;
  realmUsername: string;
  runAs: string;
  cardId: string;
  format: ScreenshotFormat;
  // Optional per-capture overrides (viewport, scale, fullPage, clip). Typed as
  // `| null` rather than `?:` because `JSONTypes.Object`'s index signature
  // rejects `undefined`; the handler always sets it (to the parsed spec or
  // null).
  captureSpec: ScreenshotCaptureSpec | null;
  // When non-null, a successful capture is persisted to the MediaCache under
  // this ledger identity before the job resolves. This is what makes a
  // bounded-wait caller (the GET `_screenshot/` route's sync wait) safe to
  // give up on: the capture still lands durably, and the caller's retry is
  // a pure ledger hit instead of a second render. The identity's
  // `captureSpecHash` covers the full spec — format and captureSpec
  // overrides alike — so the producer must hash the same spec it threads
  // into `captureSpec`; the task re-derives the hash from the rendered spec
  // before persisting and refuses a mismatch. Non-optional `| null` rather
  // than `?:` because the args are a `JSONTypes.Object`, whose index
  // signature rejects `undefined`.
  persist: ScreenshotPersistArgs | null;
  // Which serving surface enqueued this job, carried onto the capture's
  // telemetry record so captures slice by surface.
  surface: ScreenshotRequestSurface;
  // The enqueuing HTTP request's `x-boxel-logging-correlation-id` (already
  // sanitized by the surface), joining this job's telemetry back to the
  // realm-server's request logs. `| null` for the JSONTypes index-signature
  // reason above. Deliberately not part of the coalesce identity: a joined
  // request hands its waiter the twin's result, and each surface still emits
  // its own request record under its own correlation id.
  loggingCorrelationId: string | null;
}

export { screenshotCard };

const screenshotCard: Task<ScreenshotCardArgs, ScreenshotPrerenderResponse> = ({
  reportStatus,
  log,
  dbAdapter,
  prerenderer,
  createPrerenderAuth,
  matrixURL,
  mediaCacheAdapter,
}) =>
  async function (args) {
    let {
      jobInfo,
      realmURL,
      runAs,
      cardId,
      format,
      captureSpec,
      persist,
      surface,
      loggingCorrelationId,
    } = args;
    let taskStart = Date.now();
    log.debug(
      `${jobIdentity(jobInfo)} starting screenshot-card for job: ${JSON.stringify(
        {
          realmURL,
          runAs,
          cardId,
          format,
          captureSpec,
        },
      )}`,
    );
    reportStatus(jobInfo, 'start');

    let normalizedRealmURL = ensureTrailingSlash(realmURL);
    // One capture, one telemetry record: every exit path below finishes by
    // emitting this event, and the persisting path also writes it onto the
    // capture's ledger row so the breakdown is readable by SQL after the
    // logs age out.
    let perfEvent = (
      fields: Partial<ScreenshotCapturePerfEvent> & {
        status: ScreenshotCapturePerfEvent['status'];
        persistOutcome: ScreenshotPersistOutcome;
      },
    ): ScreenshotCapturePerfEvent => ({
      eventType: 'capture',
      surface: surface ?? 'post',
      realmURL: normalizedRealmURL,
      sourceURL: persist?.sourceURL ?? cardId.replace(/\.json$/, ''),
      captureSpecHash: persist?.captureSpecHash ?? null,
      sourceGeneration: persist?.sourceGeneration ?? null,
      lane: persist?.lane ?? null,
      correlationId: loggingCorrelationId ?? null,
      jobId: jobInfo?.jobId ?? null,
      reservationId: jobInfo?.reservationId ?? null,
      runAs,
      format,
      prerenderRequestId: null,
      ...(jobInfo?.queueWaitMs != null
        ? { queueWaitMs: jobInfo.queueWaitMs }
        : {}),
      totalMs: Date.now() - taskStart,
      ...fields,
    });

    if (!prerenderer.prerenderScreenshot) {
      let message = `${jobIdentity(jobInfo)} prerenderer does not support screenshot capture`;
      log.error(message);
      reportStatus(jobInfo, 'finish');
      emitScreenshotPerf(
        perfEvent({ status: 'error', persistOutcome: 'skipped' }),
      );
      return {
        status: 'error',
        error: message,
      };
    }

    let permissionsStart = Date.now();
    let permissionsMs: number | undefined;
    let prerenderStart: number | undefined;
    let prerenderMs: number | undefined;
    let response!: ScreenshotPrerenderResponse;
    try {
      let runAsUserId = ensureFullMatrixUserId(runAs, matrixURL);
      // The effective set the realm itself enforces: its `users` and `*`
      // grants unioned with the runner's own row. A session token is rejected
      // when its permissions claim differs from that union in either
      // direction, so on a realm that carries a shared grant the runner's row
      // alone is not a mintable set.
      let userPermissions = await fetchEffectiveRealmPermissions(
        dbAdapter,
        new URL(normalizedRealmURL),
        runAsUserId,
        matrixURL,
      );
      if (userPermissions.length === 0) {
        let message = `${jobIdentity(jobInfo)} ${runAs} does not have permissions in ${normalizedRealmURL}`;
        log.error(message);
        reportStatus(jobInfo, 'finish');
        emitScreenshotPerf(
          perfEvent({
            status: 'error',
            persistOutcome: 'skipped',
            permissionsMs: Date.now() - permissionsStart,
          }),
        );
        return {
          status: 'error',
          error: message,
        };
      }

      // Include JWTs for all realms the user has access to so cross-realm
      // card references render correctly during the screenshot.
      let allUserPermissions = await fetchUserPermissions(dbAdapter, {
        userId: runAsUserId,
      });
      allUserPermissions[normalizedRealmURL] = userPermissions;
      let auth = createPrerenderAuth(runAsUserId, allUserPermissions);
      permissionsMs = Date.now() - permissionsStart;

      prerenderStart = Date.now();
      let result = await prerenderer.prerenderScreenshot({
        realm: normalizedRealmURL,
        url: cardId,
        auth,
        format,
        ...(captureSpec ? { captureSpec } : {}),
        priority: jobInfo?.priority,
        // Joins the prerender server's and manager's logs for this render
        // back to the worker job (forwarded as the x-boxel-job-id header by
        // the remote prerenderer; in-process prerenderers ignore it).
        jobId: jobInfo
          ? `${jobInfo.jobId}.${jobInfo.reservationId}`
          : undefined,
      });
      prerenderMs = Date.now() - prerenderStart;
      // The local (in-process) prerenderer resolves to `{response, timings,
      // pool}` while the remote one resolves to the bare response; unwrap so
      // the job result is one shape either way.
      response = (result as any)?.response ?? result;
    } catch (e: any) {
      // A throw here (a permission fetch that failed, a prerender request
      // that exhausted its retries or lost its lease) rejects the job — emit
      // the capture record first, with the stages accumulated so far, or the
      // pipeline's hard-failure class leaves no `capture` event at all.
      emitScreenshotPerf(
        perfEvent({
          status: 'error',
          persistOutcome: 'skipped',
          permissionsMs: permissionsMs ?? Date.now() - permissionsStart,
          ...(prerenderStart != null
            ? { prerenderMs: Date.now() - prerenderStart }
            : {}),
        }),
      );
      throw e;
    }

    let persistOutcome: ScreenshotPersistOutcome = 'skipped';
    let decodeMs: number | undefined;
    let persistMs: number | undefined;
    if (persist && response.status === 'ready' && response.base64) {
      // The persist identity is the producer's claim about which spec this
      // render satisfies; re-derive the hash from the spec the job actually
      // rendered and refuse a mismatch — a wrong-identity persist would
      // serve this render on some other spec's durable URL until the source
      // generation bumps. One sha256 against a Chrome render. A batch or
      // fitted render has no canonical identity, so no persist target can
      // legitimately name one; those hash to null and always refuse.
      let renderedSpecHash =
        isCaptureFormat(format) &&
        !captureSpec?.captures &&
        !captureSpec?.envelope
          ? await captureSpecHash({ format, ...(captureSpec ?? {}) })
          : null;
      if (renderedSpecHash !== persist.captureSpecHash) {
        log.error(
          `${jobIdentity(jobInfo)} screenshot-card persist identity hash ${persist.captureSpecHash} does not match the rendered captureSpec's hash ${renderedSpecHash}; refusing to persist this render under another spec's identity`,
        );
      } else if (!mediaCacheAdapter) {
        log.warn(
          `${jobIdentity(jobInfo)} screenshot-card asked to persist but this worker has no media cache adapter configured; skipping`,
        );
      } else {
        // Persist failure must not fail the capture: the response still
        // carries the bytes, so the caller can serve (or store) them itself.
        try {
          let decodeStart = Date.now();
          let binary = atob(response.base64);
          let bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          decodeMs = Date.now() - decodeStart;
          let persistStart = Date.now();
          let { deduped } = await putMedia(dbAdapter, mediaCacheAdapter, {
            ...persist,
            bytes,
            contentType: response.contentType ?? 'image/png',
            width: response.width ?? null,
            height: response.height ?? null,
          });
          persistMs = Date.now() - persistStart;
          persistOutcome = deduped ? 'deduped' : 'uploaded';
        } catch (e: any) {
          persistOutcome = 'failed';
          log.error(
            `${jobIdentity(jobInfo)} screenshot-card failed to persist capture to the media cache`,
            e,
          );
        }
      }
    }

    // The prerender breakdown rides on the response's diagnostics block —
    // the one prerender timing surface that survives the remote wire (see
    // `render-runner.captureScreenshotAttempt`).
    let diagnostics = response.meta?.diagnostics ?? {};
    let event = perfEvent({
      status: response.status,
      persistOutcome,
      prerenderRequestId: response.meta?.requestId ?? null,
      permissionsMs,
      prerenderMs,
      ...(diagnostics.launchMs != null
        ? { launchMs: diagnostics.launchMs }
        : {}),
      ...(diagnostics.waits?.semaphoreMs != null
        ? { semaphoreMs: diagnostics.waits.semaphoreMs }
        : {}),
      ...(diagnostics.waits?.admissionMs != null
        ? { admissionMs: diagnostics.waits.admissionMs }
        : {}),
      ...(diagnostics.waits?.tabQueueMs != null
        ? { tabQueueMs: diagnostics.waits.tabQueueMs }
        : {}),
      ...(diagnostics.waits?.tabStartupMs != null
        ? { tabStartupMs: diagnostics.waits.tabStartupMs }
        : {}),
      ...(diagnostics.waits?.tabProbeMs != null
        ? { tabProbeMs: diagnostics.waits.tabProbeMs }
        : {}),
      ...(diagnostics.tabReused != null
        ? { tabReused: diagnostics.tabReused }
        : {}),
      ...(diagnostics.renderElapsedMs != null
        ? { renderMs: diagnostics.renderElapsedMs }
        : {}),
      ...(diagnostics.screenshotNavMs != null
        ? { navMs: diagnostics.screenshotNavMs }
        : {}),
      ...(diagnostics.screenshotSettleMs != null
        ? { settleMs: diagnostics.screenshotSettleMs }
        : {}),
      ...(diagnostics.screenshotImagePaintMs != null
        ? { imagePaintMs: diagnostics.screenshotImagePaintMs }
        : {}),
      ...(diagnostics.screenshotCaptureMs != null
        ? { screenshotMs: diagnostics.screenshotCaptureMs }
        : {}),
      ...(decodeMs != null ? { decodeMs } : {}),
      ...(persistMs != null ? { persistMs } : {}),
    });
    emitScreenshotPerf(event);
    if (
      persist &&
      (persistOutcome === 'uploaded' || persistOutcome === 'deduped')
    ) {
      // Best-effort: the ledger copy of the breakdown must never fail the
      // capture.
      try {
        await updateMediaCacheDiagnostics(dbAdapter, persist, { ...event });
      } catch (e: any) {
        log.warn(
          `${jobIdentity(jobInfo)} failed to record capture diagnostics on the ledger row`,
          e,
        );
      }
    }

    reportStatus(jobInfo, 'finish');
    return response;
  };
