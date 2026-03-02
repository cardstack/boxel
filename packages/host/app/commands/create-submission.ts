import { service } from '@ember/service';

import {
  RealmPaths,
  PlanBuilder,
  planInstanceInstall,
  planModuleInstall,
  toBranchName,
  extractRelationshipIds,
  isCardInstance,
  isCardError,
  logger,
  type LooseSingleCardDocument,
  type ListingPathResolver,
  type Relationship,
} from '@cardstack/runtime-common';
import type { CopyInstanceMeta } from '@cardstack/runtime-common/catalog';
import type { CopyModuleMeta } from '@cardstack/runtime-common/catalog';

import ENV from '@cardstack/host/config/environment';

import type {
  CardDef,
  CardDefConstructor,
} from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';
import type StoreService from '../services/store';
import type { Listing } from '@cardstack/catalog/listing/listing';

const log = logger('commands:create-submission');
const SUBMISSION_CARD_MODULE = ENV.resolvedCatalogRealmURL
  ? new URL('submission-card/submission-card', ENV.resolvedCatalogRealmURL).href
  : undefined;

interface FileWithContent {
  path: string;
  content: string;
}

export default class CreateSubmissionCommand extends HostBaseCommand<
  typeof BaseCommandModule.CreateSubmissionInput,
  CardDefConstructor
> {
  @service declare private cardService: CardService;
  @service declare private store: StoreService;

  description = 'Prepare submission data for a catalog listing';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CreateSubmissionInput } = commandModule;
    return CreateSubmissionInput;
  }

  requireInputFields = ['roomId', 'realm', 'listingId'];

  protected async run(
    input: BaseCommandModule.CreateSubmissionInput,
  ): Promise<CardDef> {
    let { listingId, realm, roomId } = input;
    let realmUrl = new RealmPaths(new URL(realm)).url;

    if (!listingId) {
      throw new Error('Missing listingId for CreateSubmission');
    }

    // Listing type is from catalog; base command cannot express that type
    const listing = (await this.store.get(listingId)) as Listing;
    if (!listing) {
      throw new Error(`Listing not found: ${listingId}`);
    }
    if (!listing.name) {
      throw new Error('Missing listing.name for CreateSubmission');
    }
    let branchName = toBranchName(roomId, listing.name);

    // Expand examples to include related instances
    let examplesToSnapshot = listing.examples;
    if (listing.examples?.length) {
      examplesToSnapshot = await this.expandInstances(listing.examples);
    }

    // Build the file plan from the listing
    const builder = new PlanBuilder(realmUrl, listing);

    builder
      .addIf(listing.specs?.length > 0, (resolver: ListingPathResolver) =>
        planModuleInstall(listing.specs ?? [], resolver),
      )
      .addIf(listing.specs?.length > 0, (resolver: ListingPathResolver) =>
        planInstanceInstall(listing.specs ?? [], resolver),
      )
      .addIf(examplesToSnapshot?.length > 0, (resolver: ListingPathResolver) =>
        planInstanceInstall(examplesToSnapshot ?? [], resolver),
      )
      .addIf(listing.skills?.length > 0, (resolver: ListingPathResolver) =>
        planInstanceInstall(listing.skills ?? [], resolver),
      );

    const plan = builder.build();

    let filesWithContent = await this.collectAndFetchFiles(
      listing,
      plan,
      realmUrl,
    );

    log.debug(`Prepared submission with ${filesWithContent.length} files`);

    let submission = await this.createSubmissionCard({
      listing,
      branchName,
      roomId,
      realmURL: realmUrl,
      filesWithContent,
    });

    return submission;
  }

  private async collectAndFetchFiles(
    listing: Listing,
    plan: ReturnType<PlanBuilder['build']>,
    realmUrl: string,
  ): Promise<FileWithContent[]> {
    const toRepoRelativePath = (fullUrl: string, extension: string): string => {
      let path = fullUrl;
      if (path.startsWith(realmUrl)) {
        path = path.slice(realmUrl.length);
      }
      try {
        path = decodeURIComponent(new URL(path).pathname);
      } catch {
        // keep non-URL input as-is
      }
      if (path.startsWith('/')) {
        path = path.slice(1);
      }
      if (!path.endsWith(extension)) {
        path = path + extension;
      }
      return path;
    };

    const filesWithContent: FileWithContent[] = [];
    const seenPaths = new Set<string>();

    // Add the listing instance JSON
    if (listing.id) {
      const path = toRepoRelativePath(listing.id, '.json');
      if (!seenPaths.has(path)) {
        seenPaths.add(path);
        const response = await fetch(`${listing.id}.json`);
        if (response.ok) {
          filesWithContent.push({ path, content: await response.text() });
        }
      }
    }

    // Add module files (.gts)
    for (const moduleMeta of plan.modulesToInstall as CopyModuleMeta[]) {
      if (!moduleMeta?.sourceModule) {
        log.warn('Skipping module with missing sourceModule', moduleMeta);
        continue;
      }
      const path = toRepoRelativePath(moduleMeta.sourceModule, '.gts');
      if (!seenPaths.has(path)) {
        seenPaths.add(path);
        const res = await this.cardService.getSource(
          new URL(moduleMeta.sourceModule),
        );
        filesWithContent.push({ path, content: res.content });
      }
    }

    // Add instance files (.json)
    for (const copyMeta of plan.instancesCopy as CopyInstanceMeta[]) {
      if (!copyMeta?.sourceCard?.id) {
        log.warn('Skipping instance with missing sourceCard', copyMeta);
        continue;
      }
      const sourceCardId = copyMeta.sourceCard.id;
      const path = toRepoRelativePath(sourceCardId, '.json');
      if (!seenPaths.has(path)) {
        seenPaths.add(path);
        const response = await fetch(`${sourceCardId}.json`);
        if (response.ok) {
          filesWithContent.push({ path, content: await response.text() });
        }
      }
    }

    return filesWithContent;
  }

  private async createSubmissionCard({
    listing,
    branchName,
    roomId,
    realmURL,
    filesWithContent,
  }: {
    listing: Listing;
    branchName: string;
    roomId: string;
    realmURL: string;
    filesWithContent: FileWithContent[];
  }): Promise<CardDef> {
    if (!listing.id) {
      throw new Error('Missing listing.id for submission card creation');
    }
    if (!SUBMISSION_CARD_MODULE) {
      throw new Error('Catalog realm URL is not configured');
    }
    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        relationships: {
          listing: {
            links: {
              self: listing.id,
            },
          },
        },
        attributes: {
          roomId,
          branchName,
          allFileContents: filesWithContent.map((file) => ({
            filename: file.path,
            contents: file.content,
          })),
        },
        meta: {
          adoptsFrom: {
            module: SUBMISSION_CARD_MODULE,
            name: 'SubmissionCard',
          },
        },
      },
    };

    let result = await this.store.add(doc, {
      realm: realmURL,
    });
    if (isCardError(result)) {
      throw new Error(
        `Failed to create submission card: ${result.title ?? result.id}`,
      );
    }
    return result;
  }

  // Walk relationships by fetching linked cards and enqueueing their ids.
  private async expandInstances(instances: any[]): Promise<any[]> {
    const instancesById = new Map<string, any>();
    const visited = new Set<string>();
    const queue: string[] = instances
      .map((instance) => instance.id)
      .filter((id): id is string => typeof id === 'string');

    while (queue.length > 0) {
      const id = queue.shift();
      if (!id || visited.has(id)) {
        continue;
      }
      visited.add(id);

      const cachedInstance = this.store.peek(id);
      let relationships: Record<string, Relationship | Relationship[]> = {};
      let baseUrl = id;
      const instance = isCardInstance(cachedInstance)
        ? cachedInstance
        : await this.store.get(id);
      if (!isCardInstance(instance)) {
        throw new Error(`Expected card instance for ${id}`);
      }
      instancesById.set(instance.id ?? id, instance);
      const serialized = await this.cardService.serializeCard(instance, {
        omitQueryFields: true,
      });
      if (serialized.data.id) {
        baseUrl = serialized.data.id;
      }
      relationships = serialized.data.relationships ?? {};

      for (const rel of Object.values(relationships)) {
        const rels = Array.isArray(rel) ? rel : [rel];
        for (const relationship of rels) {
          const relatedIds = extractRelationshipIds(relationship, baseUrl);
          for (const relatedId of relatedIds) {
            if (!visited.has(relatedId)) {
              queue.push(relatedId);
            }
          }
        }
      }
    }

    return [...instancesById.values()];
  }
}
