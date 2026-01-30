import type Koa from 'koa';
import type { DBAdapter, Realm } from '@cardstack/runtime-common';
import {
  ensureTrailingSlash,
  fetchUserPermissions,
  logger,
  param,
  query,
  PUBLISHED_DIRECTORY_NAME,
  RealmPaths,
} from '@cardstack/runtime-common';
import { AuthenticationError } from '@cardstack/runtime-common/router';
import { parseRealmsParam } from '@cardstack/runtime-common/search-utils';
import archiver from 'archiver';
import { existsSync, statSync } from 'fs-extra';
import { join, resolve, sep } from 'path';
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
  setContextResponse,
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
  serverURL,
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
    let authorization = ctxt.req.headers['authorization'];
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
        readableRealms = buildReadableRealms(
          permissions,
          publishedRealmURLs,
        );
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
      realmURL,
      realmsRootPath,
      serverURL,
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
  realmURL,
  realmsRootPath,
  serverURL,
}: {
  dbAdapter: DBAdapter;
  realmURL: string;
  realmsRootPath: string;
  serverURL: string;
}): Promise<string | null> {
  let published = (await query(dbAdapter, [
    'SELECT id FROM published_realms WHERE published_realm_url =',
    param(realmURL),
  ])) as PublishedRealmRow[];
  if (published.length > 0) {
    return join(realmsRootPath, PUBLISHED_DIRECTORY_NAME, published[0].id);
  }

  let realmPath = realmPathFromServerURL({
    realmURL,
    realmsRootPath,
    serverURL,
  });
  if (!realmPath) {
    return null;
  }

  let root = resolve(realmsRootPath);
  let resolvedRealmPath = resolve(realmPath);
  if (
    resolvedRealmPath !== root &&
    !resolvedRealmPath.startsWith(`${root}${sep}`)
  ) {
    return null;
  }

  return realmPath;
}

function realmPathFromServerURL({
  realmURL,
  realmsRootPath,
  serverURL,
}: {
  realmURL: string;
  realmsRootPath: string;
  serverURL: string;
}): string | null {
  let serverRoot = new RealmPaths(new URL(ensureTrailingSlash(serverURL)));
  let localPath: string;
  try {
    localPath = serverRoot.local(new URL(realmURL));
  } catch {
    return null;
  }

  let parts = localPath.split('/').filter(Boolean);
  if (parts.length < 1) {
    return null;
  }

  return resolve(join(realmsRootPath, ...parts));
}

function buildArchiveName(realmURL: URL): string {
  let segments = realmURL.pathname.split('/').filter(Boolean);
  let base =
    segments.length >= 2
      ? segments.slice(-2).join('-')
      : segments[0] ?? realmURL.hostname;
  base = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return base.length > 0 ? base : 'realm';
}
