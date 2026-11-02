import type Koa from 'koa';
import * as Sentry from '@sentry/node';

import {
  fetchEffectiveRealmPermissions,
  readRealmLoaderEpoch,
  type DBAdapter,
  type RealmAction,
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
} from '../middleware/index.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';

export default function handlePrerenderProxy({
  kind,
  prerenderer,
  dbAdapter,
  matrixURL,
  createPrerenderAuth,
}: {
  kind: 'card' | 'module' | 'file-extract';
  prerenderer?: Prerenderer;
  dbAdapter: DBAdapter;
  // Resolves the realm's `users` grant, which is keyed on whether the caller
  // has a matrix account.
  matrixURL: string;
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

    // The effective set the realm itself enforces: its `users` and `*` grants
    // unioned with the caller's own row. A session token is rejected when its
    // permissions claim differs from that union in either direction, so on a
    // realm that carries a shared grant the caller's row alone is not a
    // mintable set.
    //
    // Resolving a `users` grant reaches the homeserver, so this can fail on
    // something other than the database — answer through the JSON:API error
    // envelope like every other failure here rather than letting it fall
    // through to Koa's bare 500.
    let userPermissions: RealmAction[];
    try {
      userPermissions = await fetchEffectiveRealmPermissions(
        dbAdapter,
        new URL(attrs.realm),
        token.user,
        matrixURL,
      );
    } catch (err) {
      console.error(
        `Failed to resolve permissions for ${token.user} in ${attrs.realm}:`,
        err,
      );
      Sentry.captureException(err);
      await sendResponseForSystemError(
        ctxt,
        'Error resolving realm permissions',
      );
      return;
    }
    if (!userPermissions.length) {
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

    // Defense-in-depth (CS-10758 step 3): user-initiated prerenders must
    // never force the prerenderer to clear its warm loader, even if the
    // caller crafts a request with `renderOptions.clearCache: true`. The
    // server-side batch-ownership gate also strips this, but scrubbing at
    // the HTTP boundary means no path from user traffic can reach a
    // warm-loader wipe regardless of whether a batch currently owns the
    // affinity. A caller's `loaderEpoch` is scrubbed for the same reason: the
    // render and module routes reset the warm loader whenever the epoch they
    // are given differs from the one they hold, so alternating epochs would
    // wipe it on every request.
    let userRenderOptions: typeof attrs.renderOptions = attrs.renderOptions
      ? {
          ...attrs.renderOptions,
          clearCache: undefined,
          loaderEpoch: undefined,
        }
      : undefined;
    // Every kind lands on a warm tab of this realm's affinity under the
    // caller's session, which keeps every module it has already evaluated. The
    // realm's loader epoch changes whenever one of its modules is written or
    // reindexed, and the module and render routes reset the tab's loader when
    // the epoch they are given differs from the one they last cleared for.
    // Without the epoch, a module that was checked or rendered, then
    // rewritten, keeps its first evaluation for as long as the tab is reused.
    // The epoch comes from the database, never from the caller (see the scrub
    // above).
    //
    // This is the committed epoch, the one capture renders also send. The
    // uncommitted epochs an index pass sends go to tabs under the realm's
    // authority session, a different affinity from this caller's, so the two
    // series do not alternate on one tab. A tab the pool moves from one
    // affinity to the other resets at most once, then follows its new series.
    try {
      let loaderEpoch = await readRealmLoaderEpoch(dbAdapter, attrs.realm);
      if (kind === 'module') {
        prerenderResponse = await prerenderer.prerenderModule({
          affinityType: 'realm',
          affinityValue: attrs.realm,
          realm: attrs.realm,
          url: attrs.url,
          auth,
          renderOptions: { ...(userRenderOptions ?? {}), loaderEpoch },
        });
      } else {
        let passFlag =
          kind === 'card'
            ? { cardRender: true as const }
            : { fileExtract: true as const };
        let visitResponse = await prerenderer.prerenderVisit({
          affinityType: 'realm',
          affinityValue: attrs.realm,
          realm: attrs.realm,
          url: attrs.url,
          auth,
          renderOptions: {
            ...(userRenderOptions ?? {}),
            ...passFlag,
            loaderEpoch,
          },
        });
        prerenderResponse =
          kind === 'card' ? visitResponse.card : visitResponse.fileExtract;
        if (!prerenderResponse) {
          throw new Error(
            `Prerender visit returned no ${kind} payload${
              visitResponse.pageUnusableError?.error?.message
                ? `: ${visitResponse.pageUnusableError.error.message}`
                : ''
            }`,
          );
        }
      }
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
