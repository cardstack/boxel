import type * as JSONTypes from 'json-typescript';

import type { Task } from './index.ts';

import {
  fetchRealmPermissions,
  fetchUserPermissions,
  hasCaptureSpecOverrides,
  jobIdentity,
  putMedia,
  type MediaCacheLane,
  type ScreenshotCaptureSpec,
  type ScreenshotFormat,
  type ScreenshotPrerenderResponse,
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
  // a pure ledger hit instead of a second render. Mutually exclusive with
  // captureSpec overrides: the ledger identity is the canonical capture's,
  // so the task refuses to persist an override-carrying job's render.
  // Non-optional `| null` rather than `?:` because the args are a
  // `JSONTypes.Object`, whose index signature rejects `undefined`.
  persist: ScreenshotPersistArgs | null;
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
    let { jobInfo, realmURL, runAs, cardId, format, captureSpec, persist } =
      args;
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

    if (!prerenderer.prerenderScreenshot) {
      let message = `${jobIdentity(jobInfo)} prerenderer does not support screenshot capture`;
      log.error(message);
      reportStatus(jobInfo, 'finish');
      return {
        status: 'error',
        error: message,
      };
    }

    let normalizedRealmURL = ensureTrailingSlash(realmURL);
    let realmPermissions = await fetchRealmPermissions(
      dbAdapter,
      new URL(normalizedRealmURL),
    );
    let runAsUserId = ensureFullMatrixUserId(runAs, matrixURL);
    let userPermissions = realmPermissions[runAsUserId];
    if (!userPermissions || userPermissions.length === 0) {
      let message = `${jobIdentity(jobInfo)} ${runAs} does not have permissions in ${normalizedRealmURL}`;
      log.error(message);
      reportStatus(jobInfo, 'finish');
      return {
        status: 'error',
        error: message,
      };
    }

    // Include JWTs for all realms the user has access to so cross-realm card
    // references render correctly during the screenshot.
    let allUserPermissions = await fetchUserPermissions(dbAdapter, {
      userId: runAsUserId,
    });
    allUserPermissions[normalizedRealmURL] = userPermissions;
    let auth = createPrerenderAuth(runAsUserId, allUserPermissions);

    let result = await prerenderer.prerenderScreenshot({
      realm: normalizedRealmURL,
      url: cardId,
      auth,
      format,
      ...(captureSpec ? { captureSpec } : {}),
      priority: jobInfo?.priority,
    });
    // The local (in-process) prerenderer resolves to `{response, timings,
    // pool}` while the remote one resolves to the bare response; unwrap so
    // the job result is one shape either way.
    let response: ScreenshotPrerenderResponse =
      (result as any)?.response ?? result;

    if (persist && response.status === 'ready' && response.base64) {
      if (hasCaptureSpecOverrides(captureSpec)) {
        // The ledger identity in `persist` is the canonical capture's; it
        // cannot represent viewport / scale / fullPage / clip overrides.
        // Persisting an override render under it would serve that render on
        // the canonical `_screenshot/` URL, so the persist is refused — the
        // response still carries the bytes for the caller.
        log.error(
          `${jobIdentity(jobInfo)} screenshot-card job carries both a persist target and captureSpec overrides; refusing to persist a non-canonical capture under the canonical ledger identity`,
        );
      } else if (!mediaCacheAdapter) {
        log.warn(
          `${jobIdentity(jobInfo)} screenshot-card asked to persist but this worker has no media cache adapter configured; skipping`,
        );
      } else {
        // Persist failure must not fail the capture: the response still
        // carries the bytes, so the caller can serve (or store) them itself.
        try {
          let binary = atob(response.base64);
          let bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          await putMedia(dbAdapter, mediaCacheAdapter, {
            ...persist,
            bytes,
            contentType: response.contentType ?? 'image/png',
            width: response.width ?? null,
            height: response.height ?? null,
          });
        } catch (e: any) {
          log.error(
            `${jobIdentity(jobInfo)} screenshot-card failed to persist capture to the media cache`,
            e,
          );
        }
      }
    }

    reportStatus(jobInfo, 'finish');
    return response;
  };
