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
  type CardDefConstructor,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import ReadSourceCommand from '@cardstack/boxel-host/commands/read-source';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import SerializeCardCommand from '@cardstack/boxel-host/commands/serialize-card';

import type { Listing } from '../catalog-app/listing/listing';
import {
  FileContentField,
  SubmissionCard,
} from '../submission-card/submission-card';

const log = logger('commands:create-submission');

interface FileWithContent {
  path: string;
  content: string;
}

class CreateSubmissionInput extends CardDef {
  @field roomId = contains(StringField);
  @field realm = contains(StringField);
  @field listingId = contains(StringField);
}

export default class CreateSubmissionCommand extends Command<
  typeof CreateSubmissionInput,
  CardDefConstructor
> {
  description = 'Prepare submission data for a catalog listing';

  requireInputFields = ['roomId', 'realm', 'listingId'];

  async getInputType() {
    return CreateSubmissionInput;
  }

  protected async run(input: CreateSubmissionInput): Promise<CardDef> {
    let { listingId, realm, roomId } = input;
    let realmUrl = new RealmPaths(new URL(realm)).url;
    let getCardCommand = new GetCardCommand(this.commandContext);
    let saveCardCommand = new SaveCardCommand(this.commandContext);

    if (!listingId) {
      throw new Error('Missing listingId for CreateSubmission');
    }

    // Listing type is from catalog; base command cannot express that type
    const listing = (await getCardCommand.execute({
      cardId: listingId,
    })) as Listing;
    if (!listing) {
      throw new Error(`Listing not found: ${listingId}`);
    }

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

    if (!listing.name) {
      throw new Error('Missing listing.name for CreateSubmission');
    }

    let submission = new SubmissionCard({
      listing,
      roomId,
      allFileContents: filesWithContent.map(
        (file) =>
          new FileContentField({
            filename: file.path,
            contents: file.content,
          }),
      ),
    });

    await saveCardCommand.execute({
      card: submission,
      realm: realmUrl,
    });

    return submission;
  }

  private async collectAndFetchFiles(
    listing: Listing,
    plan: ReturnType<PlanBuilder['build']>,
    realmUrl: string,
  ): Promise<FileWithContent[]> {
    let readSourceCommand = new ReadSourceCommand(this.commandContext);

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
        let source = await readSourceCommand.execute({
          path: `${listing.id}.json`,
        });
        filesWithContent.push({ path, content: source.content });
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
        let source = await readSourceCommand.execute({
          path: moduleMeta.sourceModule,
        });
        filesWithContent.push({ path, content: source.content });
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
        let source = await readSourceCommand.execute({
          path: `${sourceCardId}.json`,
        });
        filesWithContent.push({ path, content: source.content });
      }
    }

    return filesWithContent;
  }

  // Walk relationships by fetching linked cards and enqueueing their ids.
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
