import {
  Command,
  RealmPaths,
  PlanBuilder,
  extractRelationshipIds,
  isCardInstance,
  logger,
  planInstanceInstall,
  planModuleInstall,
  type ListingPathResolver,
  type LooseSingleCardDocument,
  type Relationship,
} from '@cardstack/runtime-common';
import type { CopyInstanceMeta } from '@cardstack/runtime-common/catalog';
import type { CopyModuleMeta } from '@cardstack/runtime-common/catalog';

import {
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import ReadSourceCommand from '@cardstack/boxel-host/commands/read-source';
import SerializeCardCommand from '@cardstack/boxel-host/commands/serialize-card';

import type { Listing } from '../catalog-app/listing/listing';
import {
  FileContentField,
  FileCollectionResult,
} from '../fields/file-content';

const log = logger('commands:collect-submission-files');

interface FileWithContent {
  path: string;
  content: string;
}

class CollectSubmissionFilesInput extends CardDef {
  @field listingId = contains(StringField);
  @field listingRealm = contains(StringField);
}

export default class CollectSubmissionFilesCommand extends Command<
  typeof CollectSubmissionFilesInput,
  typeof FileCollectionResult
> {
  description = 'Collect submission files from a catalog listing';

  requireInputFields = ['listingId', 'listingRealm'];

  async getInputType() {
    return CollectSubmissionFilesInput;
  }

  protected async run(
    input: CollectSubmissionFilesInput,
  ): Promise<FileCollectionResult> {
    let { listingId, listingRealm } = input;

    if (!listingId || !listingRealm) {
      throw new Error('Missing listingId or listingRealm');
    }

    let files = await this.collectFiles(listingId, listingRealm);
    log.debug(`Collected ${files.length} files for submission`);

    return new FileCollectionResult({
      allFileContents: files.map(
        (file) =>
          new FileContentField({
            filename: file.path,
            contents: file.content,
          }),
      ),
    });
  }

  private async collectFiles(
    listingId: string,
    listingRealm: string,
  ): Promise<FileWithContent[]> {
    let realmUrl = new RealmPaths(new URL(listingRealm)).url;
    let getCardCommand = new GetCardCommand(this.commandContext);
    let readSourceCommand = new ReadSourceCommand(this.commandContext);

    const listing = (await getCardCommand.execute({
      cardId: listingId,
    })) as Listing;

    if (!listing) {
      log.warn(`Listing not found: ${listingId}, skipping file collection`);
      return [];
    }

    let examplesToSnapshot = listing.examples;
    if (listing.examples?.length) {
      examplesToSnapshot = await this.expandInstances(listing.examples);
    }

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

    if (listing.id) {
      const path = toRepoRelativePath(listing.id, '.json');
      if (!seenPaths.has(path)) {
        seenPaths.add(path);
        let source = await readSourceCommand.execute({
          path: `${listing.id}.json`,
        });
        filesWithContent.push({ path, content: source.content });
      }
    }

    for (const moduleMeta of plan.modulesToInstall as CopyModuleMeta[]) {
      if (!moduleMeta?.sourceModule) {
        log.warn('Skipping module with missing sourceModule', moduleMeta);
        continue;
      }
      const path = toRepoRelativePath(moduleMeta.sourceModule, '.gts');
      if (!seenPaths.has(path)) {
        seenPaths.add(path);
        let source = await readSourceCommand.execute({
          path: moduleMeta.sourceModule,
        });
        filesWithContent.push({ path, content: source.content });
      }
    }

    for (const copyMeta of plan.instancesCopy as CopyInstanceMeta[]) {
      if (!copyMeta?.sourceCard?.id) {
        log.warn('Skipping instance with missing sourceCard', copyMeta);
        continue;
      }
      const sourceCardId = copyMeta.sourceCard.id;
      const path = toRepoRelativePath(sourceCardId, '.json');
      if (!seenPaths.has(path)) {
        seenPaths.add(path);
        let source = await readSourceCommand.execute({
          path: `${sourceCardId}.json`,
        });
        filesWithContent.push({ path, content: source.content });
      }
    }

    return filesWithContent;
  }

  private async expandInstances(instances: CardDef[]): Promise<CardDef[]> {
    let getCardCommand = new GetCardCommand(this.commandContext);
    let serializeCardCommand = new SerializeCardCommand(this.commandContext);

    const instancesById = new Map<string, CardDef>();
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

      const instance = await getCardCommand.execute({ cardId: id });
      if (!isCardInstance(instance)) {
        throw new Error(`Expected card instance for ${id}`);
      }
      instancesById.set(instance.id ?? id, instance);

      const serializedResult = await serializeCardCommand.execute({
        cardId: id,
      });
      const serialized = serializedResult.json as LooseSingleCardDocument;
      const baseUrl = serialized.data.id ?? id;
      const relationships = (serialized.data.relationships ?? {}) as Record<
        string,
        Relationship | Relationship[]
      >;

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
