import {
  type Prerenderer,
  type AffinityType,
  type ModuleRenderResponse,
  type PrerenderVisitArgs,
  type RenderVisitResponse,
  type RenderRouteOptions,
  type RunCommandResponse,
  type ScreenshotPrerenderResponse,
  logger,
} from '@cardstack/runtime-common';
import {
  PRERENDER_JOB_ID_HEADER,
  PRERENDER_JOB_PRIORITY_HEADER,
  PRERENDER_REQUEST_ID_HEADER,
  PRERENDER_SERVER_DRAINING_STATUS_CODE,
  PRERENDER_SERVER_STATUS_DRAINING,
  PRERENDER_SERVER_STATUS_HEADER,
  resolvePrerenderManagerRequestTimeoutMs,
  sanitizePrerenderJobId,
} from './prerender-constants.ts';
import { randomUUID } from 'crypto';

const log = logger('remote-prerenderer');
const jsonApiHeaders = {
  'Content-Type': 'application/vnd.api+json',
  Accept: 'application/vnd.api+json',
} as const;

class RetryablePrerenderError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createRemotePrerenderer(
  prerenderServerURL: string,
): Prerenderer {
  let prerenderURL = new URL(prerenderServerURL);
  const maxAttempts = Math.max(
    1,
    Number(process.env.PRERENDER_MANAGER_RETRY_ATTEMPTS ?? 12),
  );
  const baseDelayMs = Math.max(
    50,
    Number(process.env.PRERENDER_MANAGER_RETRY_DELAY_MS ?? 200),
  );
  const maxDelayMs = Math.max(
    1000,
    Number(process.env.PRERENDER_MANAGER_MAX_DELAY_MS ?? 180_000),
  );
  const requestTimeoutMs = resolvePrerenderManagerRequestTimeoutMs();

  async function requestWithRetry<T>(
    path: string,
    type: string,
    attributes: {
      affinityType: AffinityType;
      affinityValue: string;
      realm?: string;
      url?: string;
      auth: string;
      renderOptions?: RenderRouteOptions;
      [key: string]: any;
    },
  ): Promise<T> {
    validatePrerenderAttributes(type, attributes);

    let endpoint = new URL(path, prerenderURL);
    // jobId is request metadata, not part of the validated body — strip
    // it out before sending so the prerender-server's payload schema
    // doesn't need to know about it. `priority` IS part of the validated
    // body (existing PagePool plumbing), so we read it without stripping
    // and additionally forward it as a header so the host's
    // `_federated-search` fetch wrapper can re-stamp it on sub-prerender
    // requests fired during render.
    let { jobId, ...attributesWithoutJobId } = attributes as Record<
      string,
      any
    >;
    let body = {
      data: {
        type,
        attributes: attributesWithoutJobId,
      },
    };
    let sanitizedJobId =
      typeof jobId === 'string' ? sanitizePrerenderJobId(jobId) : null;
    let priorityHeaderValue =
      typeof attributes.priority === 'number' &&
      Number.isSafeInteger(attributes.priority) &&
      attributes.priority >= 0
        ? String(attributes.priority)
        : null;
    // CS-10872: one correlation ID per logical client call, reused on
    // retries so operators can follow the full manager/prerender-server
    // log story for the same intent rather than hunting through N
    // disconnected attempts.
    let requestId = randomUUID();
    let affinityTag = `${attributes.affinityType}:${attributes.affinityValue}`;

    let attempts = 0;
    let lastError: Error | undefined;
    let attemptStart = Date.now();
    while (attempts < maxAttempts) {
      attempts++;
      attemptStart = Date.now();
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), requestTimeoutMs);
        let response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            ...jsonApiHeaders,
            [PRERENDER_REQUEST_ID_HEADER]: requestId,
            ...(sanitizedJobId
              ? { [PRERENDER_JOB_ID_HEADER]: sanitizedJobId }
              : {}),
            ...(priorityHeaderValue
              ? { [PRERENDER_JOB_PRIORITY_HEADER]: priorityHeaderValue }
              : {}),
          },
          body: JSON.stringify(body),
          signal: ac.signal,
        }).finally(() => {
          clearTimeout(timer);
        });

        let draining =
          response.status === PRERENDER_SERVER_DRAINING_STATUS_CODE ||
          response.headers.get(PRERENDER_SERVER_STATUS_HEADER) ===
            PRERENDER_SERVER_STATUS_DRAINING;

        let serverError =
          response.status >= 500 && response.status < 600 && !draining;
        if (!response.ok || draining) {
          let message = `Prerender request to ${endpoint.href} failed with status ${response.status}`;
          let text: string | undefined;
          try {
            text = await response.text();
          } catch (err) {
            log.error('Error reading prerender response body:', err);
          }
          if (text) {
            message += `: ${text}`;
          }
          if (response.status === 503 || draining || serverError) {
            throw new RetryablePrerenderError(message, response.status);
          }
          throw new Error(message);
        }

        let json: any;
        try {
          json = await response.json();
        } catch (e) {
          throw new Error('Failed to parse prerender response as JSON');
        }

        let attributesPayload: T | undefined = json?.data?.attributes;
        if (!attributesPayload) {
          throw new Error('Prerender response did not contain data.attributes');
        }

        return attributesPayload;
      } catch (e: any) {
        lastError = e;
        if (e?.name === 'AbortError') {
          // AbortError from request timeout—consider this a hard timeout, not a retryable deployment blip.
          // CS-10872: include the correlation ID, attempt, affinity, and
          // elapsed so operators can grep the manager/prerender-server
          // logs for the same requestId to see where the time went
          // (queue wait vs slow render).
          let elapsedMs = Date.now() - attemptStart;
          throw new Error(
            `Prerender request to ${endpoint.href} aborted after ${requestTimeoutMs}ms ` +
              `(requestId=${requestId}, attempt=${attempts}/${maxAttempts}, ` +
              `affinity=${affinityTag}, elapsed=${elapsedMs}ms; ` +
              `grep manager/prerender-server logs for requestId=${requestId} to locate the stall)`,
          );
        }
        // Node.js fetch() wraps network errors in TypeError with the
        // underlying error (ECONNREFUSED, ECONNRESET, etc.) in e.cause.
        // Check both e.code and e.cause.code to catch these.
        let code = e?.code ?? e?.cause?.code;
        let retryable =
          e instanceof RetryablePrerenderError ||
          code === 'ECONNREFUSED' ||
          code === 'ETIMEDOUT' ||
          code === 'ECONNRESET' ||
          (e instanceof TypeError && e.message === 'fetch failed');
        if (!retryable || attempts >= maxAttempts) {
          throw e;
        }
        let delayMs = Math.min(
          baseDelayMs * Math.pow(2, attempts - 1),
          maxDelayMs,
        );
        log.warn(
          `Prerender request to ${endpoint.href} failed (attempt ${attempts}/${maxAttempts}), retrying in ${delayMs}ms: ${e.message}`,
        );
        await delay(delayMs);
      }
    }
    throw lastError ?? new Error('Prerender request failed');
  }

  return {
    async prerenderModule({
      realm,
      url,
      auth,
      renderOptions,
      priority,
      freshPage,
    }) {
      return await requestWithRetry<ModuleRenderResponse>(
        'prerender-module',
        'prerender-module-request',
        {
          affinityType: 'realm',
          affinityValue: realm,
          realm,
          url,
          auth,
          renderOptions: renderOptions ?? {},
          ...(priority !== undefined ? { priority } : {}),
          ...(freshPage ? { freshPage: true } : {}),
        },
      );
    },
    async prerenderVisit({
      realm,
      url,
      auth,
      renderOptions,
      fileData,
      types,
      batchId,
      priority,
      jobId,
    }: PrerenderVisitArgs): Promise<RenderVisitResponse> {
      return await requestWithRetry<RenderVisitResponse>(
        'prerender-visit',
        'prerender-visit-request',
        {
          affinityType: 'realm',
          affinityValue: realm,
          realm,
          url,
          auth,
          renderOptions: renderOptions ?? {},
          ...(fileData ? { fileData } : {}),
          ...(types ? { types } : {}),
          ...(batchId ? { batchId } : {}),
          ...(priority !== undefined ? { priority } : {}),
          ...(jobId ? { jobId } : {}),
        },
      );
    },
    async runCommand({ userId, auth, command, commandInput, priority }) {
      return await requestWithRetry<RunCommandResponse>(
        'run-command',
        'run-command-request',
        {
          affinityType: 'user',
          affinityValue: userId,
          auth,
          command,
          commandInput,
          ...(priority !== undefined ? { priority } : {}),
        },
      );
    },
    async prerenderScreenshot({ realm, url, auth, format, priority }) {
      return await requestWithRetry<ScreenshotPrerenderResponse>(
        'prerender-screenshot',
        'screenshot-request',
        {
          affinityType: 'realm',
          affinityValue: realm,
          realm,
          url,
          auth,
          format,
          ...(priority !== undefined ? { priority } : {}),
        },
      );
    },
    // Release this batch's ownership of an affinity (CS-10758 step 3).
    // Routed through the manager so the release fans out to every server
    // currently assigned this affinity (any of which could hold local
    // ownership from a prior visit). Best-effort: a network-level failure
    // is logged but not rethrown — the owner expires implicitly on
    // successor replacement or affinity disposal. Bounded by an abort
    // timer so a hung manager can't block IndexRunner's `finally` and
    // stall queue progress after useful indexing work is done.
    async releaseBatch({ batchId, affinityType, affinityValue }) {
      let endpoint = new URL('release-batch', prerenderURL);
      let ac = new AbortController();
      let timer = setTimeout(() => ac.abort(), requestTimeoutMs);
      (timer as any).unref?.();
      try {
        let response = await fetch(endpoint, {
          method: 'POST',
          headers: jsonApiHeaders,
          body: JSON.stringify({
            data: {
              type: 'release-batch-request',
              attributes: { batchId, affinityType, affinityValue },
            },
          }),
          signal: ac.signal,
        });
        if (!response.ok) {
          log.warn(
            `releaseBatch for ${affinityType}:${affinityValue} (batch ${batchId}) returned ${response.status}`,
          );
        }
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') {
          log.warn(
            `releaseBatch for ${affinityType}:${affinityValue} (batch ${batchId}) timed out after ${requestTimeoutMs}ms`,
          );
        } else {
          log.warn(
            `releaseBatch for ${affinityType}:${affinityValue} (batch ${batchId}) network error:`,
            e,
          );
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function validatePrerenderAttributes(
  requestType: string,
  attrs: {
    affinityType?: unknown;
    affinityValue?: string;
    realm?: string;
    url?: string;
    auth?: string;
    command?: unknown;
  },
) {
  let missing = new Set<string>();

  if (
    typeof attrs.affinityValue !== 'string' ||
    attrs.affinityValue.trim().length === 0
  ) {
    missing.add('affinityValue');
  }
  if (
    requestType !== 'run-command-request' &&
    (typeof attrs.realm !== 'string' || attrs.realm.trim().length === 0)
  ) {
    missing.add('realm');
  }
  if (
    requestType !== 'run-command-request' &&
    (typeof attrs.url !== 'string' || attrs.url.trim().length === 0)
  ) {
    missing.add('url');
  }
  if (typeof attrs.auth !== 'string' || attrs.auth.trim().length === 0) {
    missing.add('auth');
  }
  if (requestType === 'run-command-request' && attrs.affinityType !== 'user') {
    missing.add('affinityType');
  }
  if (requestType !== 'run-command-request' && attrs.affinityType !== 'realm') {
    missing.add('affinityType');
  }
  if (
    requestType === 'run-command-request' &&
    (typeof attrs.command !== 'string' || attrs.command.trim().length === 0)
  ) {
    missing.add('command');
  }

  if (missing.size > 0) {
    throw new Error(
      `Missing prerender ${requestType} attributes: ${[...missing].join(', ')}`,
    );
  }
}
