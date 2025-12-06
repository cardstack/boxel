import type Koa from 'koa';

import {
  fetchRealmPermissions,
  logger,
  type DBAdapter,
} from '@cardstack/runtime-common';

import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import type { RealmServerTokenClaim } from '../utils/jwt';

const log = logger('prerender-proxy');
const DEFAULT_TIMEOUT_MS = Number(
  process.env.PRERENDER_PROXY_TIMEOUT_MS ?? 30_000,
);

export default function handlePrerenderProxy({
  path,
  prerendererUrl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  dbAdapter,
}: {
  path: '/prerender-card' | '/prerender-module';
  prerendererUrl?: string;
  timeoutMs?: number;
  dbAdapter: DBAdapter;
}) {
  return async (ctxt: Koa.Context) => {
    if (!prerendererUrl) {
      await sendResponseForSystemError(
        ctxt,
        'Prerender proxy is not configured on this realm server',
      );
      return;
    }

    if (ctxt.method !== 'POST') {
      await sendResponseForBadRequest(ctxt, 'Only POST is supported');
      return;
    }

    let token = ctxt.state.token as RealmServerTokenClaim | undefined;
    if (!token?.user) {
      await sendResponseForForbiddenRequest(
        ctxt,
        'Missing or invalid realm token',
      );
      return;
    }

    let request = await fetchRequestFromContext(ctxt);
    let rawBody = await request.text();
    let json: any;
    try {
      json = rawBody ? JSON.parse(rawBody) : undefined;
    } catch {
      await sendResponseForBadRequest(ctxt, 'Body must be valid JSON');
      return;
    }
    let attrs = json?.data?.attributes;
    if (!attrs) {
      await sendResponseForBadRequest(
        ctxt,
        'Request body must include data.attributes',
      );
      return;
    }
    if (!attrs.realm) {
      await sendResponseForBadRequest(ctxt, 'Missing realm in attributes');
      return;
    }

    let permissionsByUser = await fetchRealmPermissions(
      dbAdapter,
      new URL(attrs.realm),
    );
    let userPermissions = permissionsByUser[token.user];
    if (!userPermissions?.length) {
      await sendResponseForForbiddenRequest(
        ctxt,
        `${token.user} does not have permissions in ${attrs.realm}`,
      );
      return;
    }

    let forwardBody = JSON.stringify({
      data: {
        ...json?.data,
        attributes: {
          ...attrs,
          userId: token.user,
          permissions: {
            [attrs.realm]: userPermissions,
          },
        },
      },
    });

    let upstream = new URL(path, prerendererUrl);
    let headers = new Headers();
    headers.set('content-type', 'application/vnd.api+json');
    headers.set('accept', 'application/vnd.api+json');

    let controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), timeoutMs).unref?.();
    let startMs = Date.now();

    try {
      log.info(
        `Forwarding ${path} realm=${attrs.realm} url=${attrs.url} user=${token.user} timeoutMs=${timeoutMs}`,
      );
      let response = await fetch(upstream, {
        method: 'POST',
        headers,
        body: forwardBody,
        signal: controller.signal,
      });
      if (timer) {
        clearTimeout(timer as any);
      }
      log.info(
        `Upstream ${path} responded ${response.status} in ${Date.now() - startMs}ms`,
      );
      await setContextResponse(ctxt, filterHopByHop(response));
    } catch (err) {
      if (timer) {
        clearTimeout(timer as any);
      }
      log.error(`Error proxying prerender request to ${upstream.href}:`, err);
      await sendResponseForSystemError(
        ctxt,
        'Error proxying prerender request',
      );
    }
  };
}

function filterHopByHop(response: Response): Response {
  let headers = new Headers();
  for (let [key, value] of response.headers.entries()) {
    if (/^connection$/i.test(key) || /^transfer-encoding$/i.test(key)) {
      continue;
    }
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
