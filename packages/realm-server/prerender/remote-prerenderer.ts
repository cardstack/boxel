import {
  type Prerenderer,
  type RenderResponse,
  type ModuleRenderResponse,
  logger,
} from '@cardstack/runtime-common';
import {
  PRERENDER_SERVER_DRAINING_STATUS_CODE,
  PRERENDER_SERVER_STATUS_DRAINING,
  PRERENDER_SERVER_STATUS_HEADER,
} from './prerender-constants';
import { renderTimeoutMs } from './utils';

const log = logger('remote-prerenderer');

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
  const requestTimeoutMs = Math.max(
    1000,
    Number(process.env.PRERENDER_MANAGER_REQUEST_TIMEOUT_MS ?? renderTimeoutMs),
  );

  async function requestWithRetry<T>(
    path: string,
    type: string,
    attributes: Record<string, unknown>,
  ): Promise<T> {
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
          body: JSON.stringify(body),
          signal: ac.signal,
        }).finally(() => clearTimeout(timer));

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
          if (
            response.status === 503 ||
            draining ||
            response.status === 504 ||
            serverError
          ) {
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
        let retryable =
          e instanceof RetryablePrerenderError ||
          e?.code === 'ECONNREFUSED' ||
          e?.code === 'ETIMEDOUT' ||
          e?.name === 'AbortError';
        if (!retryable || attempts >= maxAttempts) {
          throw e;
        }
        let delayMs = baseDelayMs * Math.pow(2, attempts - 1);
        await delay(delayMs);
      }
    }
    throw lastError ?? new Error('Prerender request failed');
  }

  return {
    async prerenderCard({ realm, url, userId, permissions, renderOptions }) {
      return await requestWithRetry<RenderResponse>(
        'prerender-card',
        'prerender-request',
        {
          realm,
          url,
          userId,
          permissions,
          renderOptions: renderOptions ?? {},
        },
      );
    },
    async prerenderModule({ realm, url, userId, permissions, renderOptions }) {
      return await requestWithRetry<ModuleRenderResponse>(
        'prerender-module',
        'prerender-module-request',
        {
          realm,
          url,
          userId,
          permissions,
          renderOptions: renderOptions ?? {},
        },
      );
    },
  };
}
