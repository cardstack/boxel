import Service, { service } from '@ember/service';

import {
  ensureTrailingSlash,
  RealmPaths,
  SupportedMimeType,
  type RealmIdentifier,
} from '@cardstack/runtime-common';
import type { AtomicOperation } from '@cardstack/runtime-common/atomic-document';

import type CardService from './card-service';
import type MatrixService from './matrix-service';
import type NetworkService from './network';
import type RealmService from './realm';
import type RealmServerService from './realm-server';

// How many source files are read concurrently: light GETs, capped to stay
// clear of the browser's per-origin connection limit.
const READ_BATCH_SIZE = 20;
// How many files go into each `_atomic` write request. Every request is one
// write batch and one index pass on the destination realm, so larger chunks
// mean fewer index passes; the cap keeps individual request payloads modest.
const WRITE_CHUNK_SIZE = 50;
// Endpoint candidates tried before giving up (`skills-copy`, `skills-copy-2`,
// …). Only ever exhausted by a user who already owns this many copies.
const MAX_ENDPOINT_ATTEMPTS = 10;

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException(
      'The workspace duplication was cancelled',
      'AbortError',
    );
  }
}

export default class WorkspaceDuplicationService extends Service {
  @service declare private cardService: CardService;
  @service declare private matrixService: MatrixService;
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  // Copies every file in the source workspace into a newly created private
  // personal realm, surfacing it in the user's realm list only once all
  // files are in place so a half-copied workspace is never clickable.
  // Aborting the signal stops the copy at the next batch boundary and
  // deletes the partially copied realm. Returns the new realm's URL.
  async duplicateWorkspace(
    sourceRealmIdentifier: RealmIdentifier,
    opts?: {
      onProgress?: (copied: number, total: number) => void;
      signal?: AbortSignal;
    },
  ): Promise<URL> {
    let sourceRealmURL = new URL(ensureTrailingSlash(sourceRealmIdentifier));
    let filePaths = await this.fetchSourceFilePaths(sourceRealmURL);
    opts?.onProgress?.(0, filePaths.length);

    let contentsByPath = new Map<string, string>();
    for (let i = 0; i < filePaths.length; i += READ_BATCH_SIZE) {
      throwIfAborted(opts?.signal);
      await Promise.all(
        filePaths.slice(i, i + READ_BATCH_SIZE).map(async (path) => {
          contentsByPath.set(
            path,
            await this.readSourceFile(new URL(path, sourceRealmURL)),
          );
        }),
      );
    }

    throwIfAborted(opts?.signal);
    let newRealmURL = await this.createDuplicateRealm(sourceRealmIdentifier);

    try {
      let copied = 0;
      for (let i = 0; i < filePaths.length; i += WRITE_CHUNK_SIZE) {
        throwIfAborted(opts?.signal);
        let chunk = filePaths.slice(i, i + WRITE_CHUNK_SIZE);
        let operations: AtomicOperation[] = chunk.map((path) => ({
          // index.json is the one file realm creation seeds that the copy
          // keeps, so it's updated rather than added.
          op: path === 'index.json' ? 'update' : 'add',
          href: path,
          data: {
            type: 'source',
            attributes: { content: contentsByPath.get(path) ?? '' },
            meta: {},
          },
        }));
        let result = await this.cardService.executeAtomicOperations(
          operations,
          newRealmURL,
        );
        if (result?.errors?.length) {
          throw new Error(
            result.errors
              .map(
                (error: { detail?: string; title?: string }) =>
                  error.detail ?? error.title,
              )
              .join('; '),
          );
        }
        copied += chunk.length;
        opts?.onProgress?.(copied, filePaths.length);
      }

      await this.matrixService.appendRealmToAccountData(newRealmURL.href);
    } catch (error) {
      // A cancelled or failed copy leaves a partial realm that never joined
      // the user's realm list; remove it rather than stranding an invisible
      // orphan. Best-effort — the original failure is what gets reported.
      try {
        await this.realmServer.deleteRealm(newRealmURL.href);
      } catch {
        // ignore
      }
      throw error;
    }
    return newRealmURL;
  }

  private async readSourceFile(url: URL): Promise<string> {
    let response = await this.network.authedFetch(url, {
      headers: {
        Accept: 'application/vnd.card+source',
      },
    });
    if (!response.ok) {
      throw new Error(
        `Could not read ${url.href} for copying: ${
          response.status
        } - ${(await response.text()).slice(0, 500)}`,
      );
    }
    return await response.text();
  }

  private async fetchSourceFilePaths(sourceRealmURL: URL) {
    let response = await this.network.authedFetch(
      `${sourceRealmURL.href}_mtimes`,
      {
        headers: {
          Accept: SupportedMimeType.Mtimes,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch workspace contents: ${response.status}`);
    }
    let json = (await response.json()) as {
      data: {
        attributes: {
          mtimes: Record<string, number>;
        };
      };
    };
    let realmPaths = new RealmPaths(sourceRealmURL);
    return (
      Object.keys(json.data.attributes.mtimes)
        .map((fileURL) => realmPaths.local(new URL(fileURL)))
        // The duplicate keeps its own realm.json: the source's config carries
        // the source's name and catalog visibility, while the new realm's
        // config (written at creation) is what makes the copy private.
        .filter((path) => path !== 'realm.json')
    );
  }

  private async createDuplicateRealm(
    sourceRealmIdentifier: RealmIdentifier,
  ): Promise<URL> {
    let sourceEndpoint =
      new URL(ensureTrailingSlash(sourceRealmIdentifier)).pathname
        .split('/')
        .filter(Boolean)
        .at(-1) ?? 'workspace';
    let {
      name: sourceName,
      iconURL,
      backgroundURL,
    } = this.realm.info(sourceRealmIdentifier);

    for (let attempt = 1; attempt <= MAX_ENDPOINT_ATTEMPTS; attempt++) {
      // The name numbering follows the endpoint numbering, so the nth copy is
      // "<source> (Copy n)" at "<endpoint>-copy-n" and existing copies keep
      // their names distinct from the new one.
      let endpoint =
        attempt === 1
          ? `${sourceEndpoint}-copy`
          : `${sourceEndpoint}-copy-${attempt}`;
      let name =
        attempt === 1
          ? `${sourceName} (Copy)`
          : `${sourceName} (Copy ${attempt})`;
      try {
        return await this.realmServer.createRealm({
          endpoint,
          name,
          iconURL: iconURL ?? undefined,
          backgroundURL: backgroundURL ?? undefined,
        });
      } catch (error: any) {
        let message = String(error?.message ?? error);
        if (!message.includes('already exists on this server')) {
          throw error;
        }
      }
    }
    throw new Error(
      `Could not find an available workspace endpoint to duplicate '${sourceEndpoint}' into`,
    );
  }
}

declare module '@ember/service' {
  interface Registry {
    'workspace-duplication': WorkspaceDuplicationService;
  }
}
