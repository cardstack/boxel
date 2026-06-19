import type Koa from 'koa';
import {
  ensureTrailingSlash,
  fetchRealmPermissions,
  generateObscureSlug,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import {
  allocateUnlistedSlug,
  regenerateUnlistedSlug,
} from '../lib/unlisted-realm-path.ts';

// Returns the server-issued random path segment ("slug") for a source realm's
// unlisted link, generating and persisting one on first request. Pass
// `regenerate: true` to mint a fresh slug. The slug is always generated here, on
// the server — clients never supply it — so the unlisted link's unguessability
// can't be undermined by a hand-crafted request.
export default function handleUnlistedRealmPathRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    try {
      let token = ctxt.state.token as RealmServerTokenClaim;
      if (!token) {
        await sendResponseForSystemError(
          ctxt,
          'token is required to allocate an unlisted realm path',
        );
        return;
      }
      let { user: ownerUserId } = token;

      let request = await fetchRequestFromContext(ctxt);
      let body = await request.text();
      let json: Record<string, any>;
      try {
        json = JSON.parse(body);
      } catch (_error) {
        await sendResponseForBadRequest(
          ctxt,
          'Request body is not valid JSON - invalid JSON',
        );
        return;
      }

      if (!json.sourceRealmURL) {
        await sendResponseForBadRequest(ctxt, 'sourceRealmURL is required');
        return;
      }
      let sourceRealmURL = ensureTrailingSlash(json.sourceRealmURL);
      let regenerate = json.regenerate === true;

      let permissions = await fetchRealmPermissions(
        dbAdapter,
        new URL(sourceRealmURL),
      );
      if (!permissions[ownerUserId]?.includes('realm-owner')) {
        await sendResponseForForbiddenRequest(
          ctxt,
          `${ownerUserId} does not have enough permission to allocate an unlisted link for this realm`,
        );
        return;
      }

      let slug: string;
      if (regenerate) {
        // Explicit "New link" — overwrite any existing slug.
        slug = generateObscureSlug();
        await regenerateUnlistedSlug(dbAdapter, {
          sourceRealmURL,
          slug,
          ownerUserId,
        });
      } else {
        // First-time/idempotent allocation — insert a fresh slug, or return the
        // one already stored, so concurrent requests can't clobber each other.
        slug = await allocateUnlistedSlug(dbAdapter, {
          sourceRealmURL,
          candidateSlug: generateObscureSlug(),
          ownerUserId,
        });
      }

      await setContextResponse(
        ctxt,
        new Response(
          JSON.stringify({
            data: {
              type: 'unlisted-realm-path',
              attributes: { sourceRealmURL, slug },
            },
          }),
          {
            status: 200,
            headers: { 'content-type': SupportedMimeType.JSONAPI },
          },
        ),
      );
    } catch (error) {
      console.error('Error allocating unlisted realm path:', error);
      await sendResponseForSystemError(ctxt, 'Internal server error');
    }
  };
}
