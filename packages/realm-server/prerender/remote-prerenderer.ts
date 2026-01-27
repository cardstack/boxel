import {
  type Prerenderer,
  type RenderResponse,
  type ModuleRenderResponse,
  type FileExtractResponse,
  type RenderRouteOptions,
  logger,
} from '@cardstack/runtime-common';
import {
  PRERENDER_SERVER_DRAINING_STATUS_CODE,
  PRERENDER_SERVER_STATUS_DRAINING,
  PRERENDER_SERVER_STATUS_HEADER,
} from './prerender-constants';
import { renderTimeoutMs } from './utils';

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
  const requestTimeoutMs = Math.max(
    1000,
    Number(process.env.PRERENDER_MANAGER_REQUEST_TIMEOUT_MS ?? renderTimeoutMs),
  );

  async function requestWithRetry<T>(
    path: string,
    type: string,
    attributes: {
      realm: string;
      url: string;
      auth: string;
      renderOptions?: RenderRouteOptions;
    },
  ): Promise<T> {
    validatePrerenderAttributes(type, attributes);

    let endpoint = new URL(path, prerenderURL);
    let body = {
      data: {
        type,
        attributes,
      },
    };

    let attempts = 0;
    let lastError: Error | undefined;
    while (attempts < maxAttempts) {
      attempts++;
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), requestTimeoutMs);
        let response = await fetch(endpoint, {
          method: 'POST',
          headers: jsonApiHeaders,
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
          throw new Error(
            `${new Date()} Prerender request to ${endpoint.href} aborted after ${requestTimeoutMs}ms`,
          );
        }
        let retryable =
          e instanceof RetryablePrerenderError ||
          e?.code === 'ECONNREFUSED' ||
          e?.code === 'ETIMEDOUT' ||
          e?.name === 'AbortError';
        if (!retryable || attempts >= maxAttempts) {
          throw e;
        }
        let delayMs = Math.min(
          baseDelayMs * Math.pow(2, attempts - 1),
          maxDelayMs,
        );
        await delay(delayMs);
      }
    }
    throw lastError ?? new Error('Prerender request failed');
  }

  return {
    async prerenderCard({ realm, url, auth, renderOptions }) {
      return await requestWithRetry<RenderResponse>(
        'prerender-card',
        'prerender-request',
        {
          realm,
          url,
          auth,
          renderOptions: renderOptions ?? {},
        },
      );
    },
    async prerenderModule({ realm, url, auth, renderOptions }) {
      return await requestWithRetry<ModuleRenderResponse>(
        'prerender-module',
        'prerender-module-request',
        {
          realm,
          url,
          auth,
          renderOptions: renderOptions ?? {},
        },
      );
    },
    async prerenderFileExtract({ realm, url, auth, renderOptions }) {
      return await requestWithRetry<FileExtractResponse>(
        'prerender-file-extract',
        'prerender-file-extract-request',
        {
          realm,
          url,
          auth,
          renderOptions: renderOptions ?? {},
        },
      );
    },
  };
}

function validatePrerenderAttributes(
  requestType: string,
  attrs: {
    realm?: string;
    url?: string;
    auth?: string;
  },
) {
  let missing: string[] = [];

  if (typeof attrs.realm !== 'string' || attrs.realm.trim().length === 0) {
    missing.push('realm');
  }
  if (typeof attrs.url !== 'string' || attrs.url.trim().length === 0) {
    missing.push('url');
  }
  if (typeof attrs.auth !== 'string' || attrs.auth.trim().length === 0) {
    missing.push('auth');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing prerender ${requestType} attributes: ${missing.join(', ')}`,
    );
  }
}
