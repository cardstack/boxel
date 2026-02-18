import type Koa from 'koa';
import type { DBAdapter, Realm } from '@cardstack/runtime-common';
import {
  ensureTrailingSlash,
  fetchUserPermissions,
  logger,
  param,
  query,
  PUBLISHED_DIRECTORY_NAME,
} from '@cardstack/runtime-common';
import { AuthenticationError } from '@cardstack/runtime-common/router';
import { parseRealmsParam } from '@cardstack/runtime-common/search-utils';
import { verifyURLSignature } from '@cardstack/runtime-common/url-signature';
import archiver from 'archiver';
import { existsSync, statSync } from 'fs-extra';
import { join } from 'path';
import type { CreateRoutesArgs } from '../routes';
import { retrieveTokenClaim } from '../utils/jwt';
import {
  buildReadableRealms,
  getPublishedRealmURLs,
} from '../utils/realm-readability';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForNotFound,
  sendResponseForSystemError,
  sendResponseForUnauthorizedRequest,
} from '../middleware';

const log = logger('download-realm');

type PublishedRealmRow = {
  id: string;
};

export default function handleDownloadRealm({
  dbAdapter,
  realmSecretSeed,
  realms,
  realmsRootPath,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let request = await fetchRequestFromContext(ctxt);
    let url = new URL(request.url);

    let realmList = parseRealmsParam(url);
    if (realmList.length === 0) {
      let realmParam =
        url.searchParams.get('realm') ?? url.searchParams.get('realmURL');
      if (realmParam) {
        realmList = [ensureTrailingSlash(realmParam)];
      }
    }

    if (realmList.length !== 1) {
      await sendResponseForBadRequest(
        ctxt,
        'A single realm must be specified via ?realm=<url> or ?realms=<url>',
      );
      return;
    }

    let realmURL = ensureTrailingSlash(realmList[0]);
    let parsedRealmURL: URL;
    try {
      parsedRealmURL = new URL(realmURL);
      realmURL = ensureTrailingSlash(parsedRealmURL.href);
    } catch {
      await sendResponseForBadRequest(
        ctxt,
        `Invalid realm URL supplied: ${realmURL}`,
      );
      return;
    }
    if (!hasRealm(realms, realmURL)) {
      await sendResponseForNotFound(ctxt, `Realm not found: ${realmURL}`);
      return;
    }

    let publishedRealmURLs = await getPublishedRealmURLs(dbAdapter, [realmURL]);
    // Support token via query param for streaming downloads (browser navigates directly)
    let tokenFromQuery = url.searchParams.get('token');
    let authorization = ctxt.req.headers['authorization'] ?? tokenFromQuery;

    // When token is provided via query param, require a signature to prevent token reuse
    if (tokenFromQuery) {
      let signature = url.searchParams.get('sig');
      if (!signature) {
        await sendResponseForBadRequest(
          ctxt,
          'Signature required when token is provided via query parameter',
        );
        return;
      }
      if (!verifyURLSignature(tokenFromQuery, url, signature)) {
        await sendResponseForUnauthorizedRequest(
          ctxt,
          'Invalid signature for download URL',
        );
        return;
      }
    }

    let readableRealms: Set<string>;
    if (!authorization) {
      let publicPermissions = await fetchUserPermissions(dbAdapter, {
        userId: '*',
        onlyOwnRealms: false,
      });
      readableRealms = buildReadableRealms(
        publicPermissions,
        publishedRealmURLs,
      );
      if (!readableRealms.has(realmURL)) {
        await sendResponseForUnauthorizedRequest(
          ctxt,
          `Authorization required for realm: ${realmURL}`,
        );
        return;
      }
    } else {
      try {
        let token = retrieveTokenClaim(authorization, realmSecretSeed);
        let permissions = await fetchUserPermissions(dbAdapter, {
          userId: token.user,
          onlyOwnRealms: false,
        });
        readableRealms = buildReadableRealms(permissions, publishedRealmURLs);
        if (!readableRealms.has(realmURL)) {
          await sendResponseForForbiddenRequest(
            ctxt,
            `Insufficient permissions to read realm: ${realmURL}`,
          );
          return;
        }
      } catch (e) {
        if (e instanceof AuthenticationError) {
          await sendResponseForUnauthorizedRequest(ctxt, e.message);
          return;
        }
        throw e;
      }
    }

    let realmPath = await resolveRealmPath({
      dbAdapter,
      realms,
      realmURL,
      realmsRootPath,
    });
    if (!realmPath) {
      await sendResponseForNotFound(
        ctxt,
        `Realm is not stored in realmsRootPath: ${realmURL}`,
      );
      return;
    }

    if (!existsSync(realmPath) || !statSync(realmPath).isDirectory()) {
      await sendResponseForNotFound(
        ctxt,
        `Realm files not found on disk for ${realmURL}`,
      );
      return;
    }

    let filename = `${buildArchiveName(parsedRealmURL)}.zip`;
    let archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('warning', (warning) => {
      log.warn(`Zip warning for ${realmURL}: ${warning}`);
    });
    archive.on('error', (error) => {
      log.error(`Zip error for ${realmURL}: ${error}`);
      ctxt.res.destroy(error as Error);
    });

    ctxt.status = 200;
    ctxt.set('content-type', 'application/zip');
    ctxt.set('content-disposition', `attachment; filename="${filename}"`);
    ctxt.respond = false;

    archive.pipe(ctxt.res);

    try {
      archive.directory(realmPath, false);
      await archive.finalize();
    } catch (error) {
      log.error(`Failed to create archive for ${realmURL}: ${error}`);
      if (!ctxt.res.headersSent) {
        await sendResponseForSystemError(
          ctxt,
          `Failed to stream realm archive for ${realmURL}`,
        );
      } else {
        ctxt.res.destroy(error as Error);
      }
    }
  };
}

function hasRealm(realms: Realm[], realmURL: string): boolean {
  return realms.some((realm) => ensureTrailingSlash(realm.url) === realmURL);
}

async function resolveRealmPath({
  dbAdapter,
  realms,
  realmURL,
  realmsRootPath,
}: {
  dbAdapter: DBAdapter;
  realms: Realm[];
  realmURL: string;
  realmsRootPath: string;
}): Promise<string | null> {
  let published = (await query(dbAdapter, [
    'SELECT id FROM published_realms WHERE published_realm_url =',
    param(realmURL),
  ])) as PublishedRealmRow[];
  if (published.length > 0) {
    return join(realmsRootPath, PUBLISHED_DIRECTORY_NAME, published[0].id);
  }

  let realm = realms.find((r) => ensureTrailingSlash(r.url) === realmURL);
  return realm?.dir ?? null;
}

function buildArchiveName(realmURL: URL): string {
  let segments = realmURL.pathname.split('/').filter(Boolean);
  let base =
    segments.length >= 2
      ? segments.slice(-2).join('-')
      : (segments[0] ?? realmURL.hostname);
  base = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return base.length > 0 ? base : 'realm';
}
