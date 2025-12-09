import type Koa from 'koa';

import {
  fetchRealmPermissions,
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

export default function handlePrerenderProxy({
  path,
  prerendererUrl,
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

    try {
      let response = await fetch(upstream, {
        method: 'POST',
        headers,
        body: forwardBody,
      });
      await setContextResponse(ctxt, response);
    } catch (err) {
      await sendResponseForSystemError(
        ctxt,
        'Error proxying prerender request',
      );
    }
  };
}
