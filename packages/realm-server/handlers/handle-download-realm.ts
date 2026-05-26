import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
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
import { join, relative, resolve, sep, isAbsolute } from 'path';
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

export default function handleDownloadRealm({
  dbAdapter,
  realmSecretSeed,
  reconciler,
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
    // Resolve the realm's disk path WITHOUT iterating `realms[]`. Phase 3
    // lazy mount (CS-10894) leaves non-pinned realms absent from
    // `realms[]` until something drives a request-path `lookupOrMount`;
    // iterating `realms[]` here would 404 a perfectly valid post-restart
    // download (CS-11270).
    //
    // We don't need a started Realm to stream the archive — the download
    // is `archiver.directory(realmPath, false)` over on-disk files,
    // which exist whether or not the realm process is running. Two-tier
    // lookup mirrors how `multiRealmAuthorization` does presence checks:
    //   1. `reconciler.mounted` — already-mounted realms (including
    //      pinned bootstrap realms and any non-pinned realm that has
    //      been lazy-mounted earlier in this process's lifetime, as
    //      well as constructor-supplied test realms registered via
    //      `registerExistingMounts`). Use `realm.dir` directly.
    //   2. `realm_registry` — non-pinned realms that haven't been
    //      mounted yet on this instance. Resolve the disk path from
    //      the row's `kind` + `disk_id`. This is the post-restart path
    //      CS-11270 is about.
    let mounted = reconciler.mounted.get(realmURL);
    let registryRow = mounted
      ? null
      : await fetchRegistryRow(dbAdapter, realmURL);
    if (!mounted && !registryRow) {
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

    let realmPath = mounted
      ? (mounted.dir ?? null)
      : resolveRealmPath(registryRow!, realmsRootPath);
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

type RegistryRow = {
  kind: 'bootstrap' | 'source' | 'published';
  disk_id: string;
};

async function fetchRegistryRow(
  dbAdapter: DBAdapter,
  realmURL: string,
): Promise<RegistryRow | null> {
  let rows = (await query(dbAdapter, [
    'SELECT kind, disk_id FROM realm_registry WHERE url =',
    param(realmURL),
  ])) as RegistryRow[];
  return rows[0] ?? null;
}

// `disk_id` is kind-specific (see the realm_registry migration column
// comment): for `bootstrap` it's an absolute path; for `source` it's a
// directory under `realmsRootPath`; for `published` it's a directory
// under `realmsRootPath/PUBLISHED_DIRECTORY_NAME`.
//
// `source`/`published` rows go through `safeJoinUnderRoot` rather than
// a bare `path.join`. Both write paths today validate inputs
// (`create-realm.ts` rejects endpoints that don't match
// /^[a-z0-9-]+$/, etc.), but `disk_id` is just a string column and a
// future write path (or a backfill rebuilt from disk by an operator
// with shell access) could write an absolute path or `..` segments
// that would let `path.join` escape `realmsRootPath`. Anchoring with
// `path.resolve` + a prefix check keeps the handler's blast radius
// pinned to the realm root regardless of how the row was written.
function resolveRealmPath(
  row: RegistryRow,
  realmsRootPath: string,
): string | null {
  switch (row.kind) {
    case 'bootstrap':
      return row.disk_id;
    case 'source':
      return safeJoinUnderRoot(realmsRootPath, row.disk_id);
    case 'published':
      return safeJoinUnderRoot(
        join(realmsRootPath, PUBLISHED_DIRECTORY_NAME),
        row.disk_id,
      );
    default:
      return null;
  }
}

function safeJoinUnderRoot(root: string, segment: string): string | null {
  if (isAbsolute(segment)) {
    return null;
  }
  let absoluteRoot = resolve(root);
  let candidate = resolve(absoluteRoot, segment);
  if (candidate !== absoluteRoot && !candidate.startsWith(absoluteRoot + sep)) {
    return null;
  }
  // Belt and suspenders — `path.relative` should agree, and surfaces any
  // edge case path.resolve might smooth over.
  let rel = relative(absoluteRoot, candidate);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return null;
  }
  return candidate;
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
