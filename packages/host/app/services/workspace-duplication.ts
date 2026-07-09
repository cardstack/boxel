import Service, { service } from '@ember/service';

import {
  ensureTrailingSlash,
  RealmPaths,
  SupportedMimeType,
  type RealmIdentifier,
} from '@cardstack/runtime-common';

import type CardService from './card-service';
import type MatrixService from './matrix-service';
import type NetworkService from './network';
import type RealmService from './realm';
import type RealmServerService from './realm-server';

// How many files are copied concurrently while duplicating a workspace: high
// enough to overlap request latency, low enough to stay clear of the
// browser's per-origin connection limit.
const COPY_BATCH_SIZE = 5;
// Endpoint candidates tried before giving up (`skills-copy`, `skills-copy-2`,
// …). Only ever exhausted by a user who already owns this many copies.
const MAX_ENDPOINT_ATTEMPTS = 10;

export default class WorkspaceDuplicationService extends Service {
  @service declare private cardService: CardService;
  @service declare private matrixService: MatrixService;
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  // Copies every file in the source workspace into a newly created private
  // personal realm, surfacing it in the user's realm list only once all
  // files are in place so a half-copied workspace is never clickable.
  // Returns the new realm's URL.
  async duplicateWorkspace(
    sourceRealmIdentifier: RealmIdentifier,
    opts?: { onProgress?: (copied: number, total: number) => void },
  ): Promise<URL> {
    let sourceRealmURL = new URL(ensureTrailingSlash(sourceRealmIdentifier));
    let filePaths = await this.fetchSourceFilePaths(sourceRealmURL);
    opts?.onProgress?.(0, filePaths.length);

    let newRealmURL = await this.createDuplicateRealm(sourceRealmIdentifier);

    for (let i = 0; i < filePaths.length; i += COPY_BATCH_SIZE) {
      let batch = filePaths.slice(i, i + COPY_BATCH_SIZE);
      await Promise.all(
        batch.map((path) =>
          this.cardService.copySource(
            new URL(path, sourceRealmURL),
            new URL(path, newRealmURL),
          ),
        ),
      );
      opts?.onProgress?.(i + batch.length, filePaths.length);
    }

    await this.matrixService.appendRealmToAccountData(newRealmURL.href);
    return newRealmURL;
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
