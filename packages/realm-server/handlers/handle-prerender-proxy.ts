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

export default function handlePrerenderProxy({
  kind,
  prerenderer,
  dbAdapter,
  createPrerenderAuth,
}: {
  kind: 'card' | 'module' | 'file-extract';
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
    if (!attrs.url) {
      await sendResponseForBadRequest(ctxt, 'Missing url in attributes');
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

    let prerenderResponse;

    try {
      prerenderResponse =
        kind === 'card'
          ? await prerenderer.prerenderCard({
              realm: attrs.realm,
              url: attrs.url,
              auth,
              renderOptions: attrs.renderOptions,
            })
          : kind === 'module'
            ? await prerenderer.prerenderModule({
                realm: attrs.realm,
                url: attrs.url,
                auth,
                renderOptions: attrs.renderOptions,
              })
            : await prerenderer.prerenderFileExtract({
                realm: attrs.realm,
                url: attrs.url,
                auth,
                renderOptions: attrs.renderOptions,
              });
    } catch (err) {
      await sendResponseForSystemError(
        ctxt,
        'Error proxying prerender request',
      );
      return;
    }

    let type =
      kind === 'card'
        ? 'prerender-result'
        : kind === 'module'
          ? 'prerender-module-result'
          : 'prerender-file-extract-result';

    await setContextResponse(
      ctxt,
      new Response(
        JSON.stringify({
          data: {
            type,
            id: attrs.url,
            attributes: prerenderResponse,
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
