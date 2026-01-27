import { service } from '@ember/service';

import {
  RealmPaths,
  PlanBuilder,
  planInstanceInstall,
  planModuleInstall,
  extractRelationshipIds,
  isCardInstance,
  logger,
  uuidv4,
  type ListingPathResolver,
  type PrManifest,
  type Relationship,
} from '@cardstack/runtime-common';
import type { CopyInstanceMeta } from '@cardstack/runtime-common/catalog';
import type { CopyModuleMeta } from '@cardstack/runtime-common/catalog';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import UseAiAssistantCommand from './ai-assistant';
import CreateAiAssistantRoomCommand from './create-ai-assistant-room';

import type CardService from '../services/card-service';
import type MatrixService from '../services/matrix-service';
import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';
import type { Listing } from '@cardstack/catalog/listing/listing';

const log = logger('commands:create-listing-pr');

interface FileWithPath {
  path: string;
  sourceUrl: string;
}

interface FileWithContent {
  path: string;
  content: string;
}

export default class CreateListingPRCommand extends HostBaseCommand<
  typeof BaseCommandModule.CreateListingPRInput,
  typeof BaseCommandModule.CreateListingPRResult
> {
  @service declare private matrixService: MatrixService;
  @service declare private realmServer: RealmServerService;
  @service declare private cardService: CardService;
  @service declare private store: StoreService;

  description =
    'Create a GitHub PR from a catalog listing with all its specs, examples, and skills';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CreateListingPRInput } = commandModule;
    return CreateListingPRInput;
  }

  async getResultType() {
    let commandModule = await this.loadCommandModule();
    const { CreateListingPRResult } = commandModule;
    return CreateListingPRResult;
  }

  requireInputFields = ['realm', 'listing'];

  protected async run(
    input: BaseCommandModule.CreateListingPRInput,
  ): Promise<BaseCommandModule.CreateListingPRResult> {
    await this.matrixService.ready;

    let { listing: listingInput, realm } = input;
    let realmUrls = this.realmServer.availableRealmURLs;
    let realmUrl = new RealmPaths(new URL(realm)).url;

    if (!realmUrls.includes(realmUrl)) {
      throw new Error(`Invalid realm: ${realmUrl}`);
    }

    // Listing type is from catalog; base command cannot express that type
    const listing = listingInput as Listing;
    const snapshotId = uuidv4();
    const branch = this.generateBranchName(listing, snapshotId);

    // Create a fresh AI assistant room for status updates
    let roomId = input.roomId;
    if (!roomId) {
      let createRoomResult = await new CreateAiAssistantRoomCommand(
        this.commandContext,
      ).execute({
        name: `PR: ${listing.name ?? listing.id ?? 'Listing'}`,
      });
      roomId = createRoomResult.roomId;
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

    // Collect files and fetch their contents
    const { filesWithPaths, filesWithContent } =
      await this.collectAndFetchFiles(listing, plan, realmUrl);

    log.debug(
      `Submitting ${filesWithContent.length} files to GitHub branch: ${branch}`,
    );

    // Create the PR directly via realm-server → GitHub
    let prResult;
    try {
      prResult = await this.realmServer.createGitHubPR({
        listingName: listing.name ?? 'Unknown Listing',
        listingId: listing.id,
        snapshotId,
        branch,
        baseBranch: 'main',
        files: filesWithContent,
      });
    } catch (error: any) {
      log.error('GitHub PR creation failed:', error);

      // Notify user of failure
      await new UseAiAssistantCommand(this.commandContext).execute({
        roomId,
        prompt: `❌ Failed to create PR for listing "${listing.name ?? listing.id}".\n\nError: ${error.message}`,
        openRoom: true,
        attachedFileURLs: [],
        openCardIds: [],
        skillCardIds: [],
      });

      throw error;
    }

    // Store minimal manifest in room state
    const manifest: PrManifest = {
      snapshotId,
      listingId: listing.id,
      listingName: listing.name,
      createdAt: new Date().toISOString(),
      files: filesWithPaths.map((f) => ({
        sourceUrl: f.sourceUrl,
        path: f.path,
      })),
      branch: prResult.branch,
      repo: 'cardstack/boxel-catalog',
      baseBranch: 'main',
      locked: true,
      pr: {
        url: prResult.prUrl,
        number: prResult.prNumber,
        status: 'open',
        lastCheckedAt: new Date().toISOString(),
      },
    };

    log.debug('PR created successfully:', prResult);

    // Open room and send PR status message with full details
    await new UseAiAssistantCommand(this.commandContext).execute({
      roomId,
      prompt: `I just submitted a PR for my listing "${listing.name ?? listing.id}".

PR Details:
- PR Number: #${prResult.prNumber}
- PR URL: ${prResult.prUrl}
- Branch: ${prResult.branch}
- Files Changed: ${filesWithContent.length} files
- Repository: cardstack/boxel-catalog
`,
      openRoom: true,
      attachedFileURLs: [],
      openCardIds: [],
      skillCardIds: [],
    });

    return await this.makeResult(manifest);
  }

  private async collectAndFetchFiles(
    listing: Listing,
    plan: ReturnType<PlanBuilder['build']>,
    realmUrl: string,
  ): Promise<{
    filesWithPaths: FileWithPath[];
    filesWithContent: FileWithContent[];
  }> {
    const toRepoRelativePath = (fullUrl: string, extension: string): string => {
      let url = fullUrl;
      if (url.startsWith(realmUrl)) {
        url = url.slice(realmUrl.length);
      }
      if (url.startsWith('/')) {
        url = url.slice(1);
      }
      if (!url.endsWith(extension)) {
        url = url + extension;
      }
      return url;
    };

    const filesWithPaths: FileWithPath[] = [];
    const filesWithContent: FileWithContent[] = [];
    const seenPaths = new Set<string>();

    // Add the listing instance JSON
    if (listing.id) {
      const path = toRepoRelativePath(listing.id, '.json');
      if (!seenPaths.has(path)) {
        seenPaths.add(path);
        filesWithPaths.push({ path, sourceUrl: listing.id });
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
        filesWithPaths.push({ path, sourceUrl: moduleMeta.sourceModule });
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
        filesWithPaths.push({ path, sourceUrl: sourceCardId });
        const response = await fetch(`${sourceCardId}.json`);
        if (response.ok) {
          filesWithContent.push({ path, content: await response.text() });
        }
      }
    }

    return { filesWithPaths, filesWithContent };
  }

  private async makeResult(manifest: PrManifest) {
    const commandModule = await this.loadCommandModule();
    const { CreateListingPRResult } = commandModule;
    return new CreateListingPRResult({
      snapshotId: manifest.snapshotId,
      branch: manifest.branch,
      fileCount: manifest.files.length,
      prUrl: manifest.pr?.url,
      prNumber: manifest.pr?.number,
    });
  }

  private generateBranchName(listing: Listing, snapshotId: string): string {
    const slug = (listing.name ?? listing.id ?? 'listing')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30);
    const shortId = snapshotId.slice(0, 8);
    return `listing/${slug}-${shortId}`;
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
