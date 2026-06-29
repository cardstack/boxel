import type Koa from 'koa';
import {
  any,
  every,
  fetchArchivedRealmsForOwner,
  logger,
  param,
  query,
  separatedByCommas,
  SupportedMimeType,
  type CardResource,
  type Expression,
} from '@cardstack/runtime-common';
import { iconURLFor } from '@cardstack/runtime-common/realm-display-defaults';
import * as Sentry from '@sentry/node';
import {
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';

const log = logger('handle-archived-realms');

// The RealmConfig card lives at `<realmURL>realm.json`; the indexer stores
// it under the `.json`-stripped URL `<realmURL>realm` (matching
// Realm#parseRealmInfo's index read).
function realmConfigCardURL(realmURL: string): string {
  return `${realmURL}realm`;
}

// Best-effort name for a realm that has no indexed RealmConfig card yet
// (e.g. never finished its first index). Falls back to the last path
// segment of the URL so the chooser still has something to show.
function fallbackName(realmURL: string): string {
  try {
    let segments = new URL(realmURL).pathname.split('/').filter(Boolean);
    let last = segments[segments.length - 1];
    return last ?? 'Unnamed Workspace';
  } catch {
    return 'Unnamed Workspace';
  }
}

interface ArchivedRealmAttributes {
  archivedAt: string;
  name: string;
  iconURL: string | null;
  backgroundURL: string | null;
}

// GET /_archived-realms — returns the archived realms the authenticated
// caller owns, with the display metadata the workspace chooser's archived
// section needs (URL, name, icon, archived_at). Ownership and the
// archived/published filtering live in fetchArchivedRealmsForOwner; this
// handler layers on the per-realm display info.
//
// Name/icon are read straight from the indexed RealmConfig card rather than
// by mounting each realm: archived realms are meant to stay dormant, and
// their index rows persist while archived, so a direct read avoids waking
// them up.
export default function handleArchivedRealms({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to list archived realms',
      );
      return;
    }

    try {
      let { user: username } = token;
      let archivedRealms = await fetchArchivedRealmsForOwner(
        dbAdapter,
        username,
      );

      let configByRealmURL = new Map<string, CardResource>();
      if (archivedRealms.length > 0) {
        let configURLToRealmURL = new Map<string, string>();
        for (let { url } of archivedRealms) {
          configURLToRealmURL.set(realmConfigCardURL(url), url);
        }
        let configURLs = [...configURLToRealmURL.keys()];
        let rows = (await query(dbAdapter, [
          `SELECT url, pristine_doc FROM boxel_index WHERE`,
          ...every([
            [
              `url IN (`,
              ...separatedByCommas(configURLs.map((u) => [param(u)])),
              `)`,
            ],
            [`type =`, param('instance')],
            any([[`is_deleted = FALSE`], [`is_deleted IS NULL`]]),
          ]),
        ] as Expression)) as {
          url: string;
          pristine_doc: CardResource | null;
        }[];
        for (let { url, pristine_doc } of rows) {
          let realmURL = configURLToRealmURL.get(url);
          if (realmURL && pristine_doc) {
            configByRealmURL.set(realmURL, pristine_doc);
          }
        }
      }

      let data = archivedRealms.map(({ url, archivedAt }) => {
        let config = configByRealmURL.get(url);
        let attrs = (config?.attributes ?? {}) as Record<string, unknown>;
        let cardInfo = (attrs.cardInfo ?? {}) as Record<string, unknown>;
        let name =
          typeof cardInfo.name === 'string' && cardInfo.name.length > 0
            ? cardInfo.name
            : fallbackName(url);
        let iconURL: string | null;
        if (typeof attrs.iconURL === 'string') {
          iconURL = attrs.iconURL;
        } else if (config && 'iconURL' in attrs) {
          // The icon was explicitly cleared on an indexed realm. Preserve the
          // null rather than synthesizing one, matching how RealmConfig
          // parsing treats an explicit null (see Realm#parseRealmInfo).
          iconURL = null;
        } else {
          // No indexed config (or no iconURL field) — fall back to a letter
          // icon so the chooser still has something to show.
          iconURL = iconURLFor(name) ?? null;
        }
        let backgroundURL =
          typeof attrs.backgroundURL === 'string' ? attrs.backgroundURL : null;
        let attributes: ArchivedRealmAttributes = {
          archivedAt,
          name,
          iconURL,
          backgroundURL,
        };
        return { type: 'realm', id: url, attributes };
      });

      await setContextResponse(
        ctxt,
        new Response(JSON.stringify({ data }, null, 2), {
          headers: { 'content-type': SupportedMimeType.JSONAPI },
        }),
      );
    } catch (error: any) {
      log.error(`Error listing archived realms:`, error);
      Sentry.captureException(error);
      await sendResponseForSystemError(ctxt, error.message);
    }
  };
}
