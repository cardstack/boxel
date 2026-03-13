import type Koa from 'koa';

import {
  fetchRealmPermissions,
  type DBAdapter,
  type RealmPermissions,
  type Prerenderer,
} from '@cardstack/runtime-common';

import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForUnauthorizedRequest,
  sendResponseForForbiddenRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import type { RealmServerTokenClaim } from '../utils/jwt';

export default function handleRunTests({
  prerenderer,
  dbAdapter,
  createPrerenderAuth,
}: {
  prerenderer?: Prerenderer;
  dbAdapter: DBAdapter;
  createPrerenderAuth: (
    userId: string,
    permissions: RealmPermissions,
  ) => string;
}) {
  return async (ctxt: Koa.Context) => {
    if (!prerenderer) {
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
      await sendResponseForUnauthorizedRequest(
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
    if (!attrs.moduleUrl) {
      await sendResponseForBadRequest(ctxt, 'Missing moduleUrl in attributes');
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

    let permissions: RealmPermissions = {
      [attrs.realm]: userPermissions,
    };
    let auth = createPrerenderAuth(token.user, permissions);

    let result;
    try {
      result = await prerenderer.runTests({
        moduleUrl: attrs.moduleUrl,
        realm: attrs.realm,
        affinityType: 'realm',
        affinityValue: attrs.realm,
        auth,
        filter: attrs.filter,
      });
    } catch (err) {
      let msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      await sendResponseForSystemError(ctxt, `Error running tests: ${msg}`);
      return;
    }

    await setContextResponse(
      ctxt,
      new Response(
        JSON.stringify({
          data: {
            type: 'test-result',
            id: attrs.moduleUrl,
            attributes: result,
          },
        }),
        {
          status: 201,
          headers: { 'content-type': 'application/vnd.api+json' },
        },
      ),
    );
  };
}
