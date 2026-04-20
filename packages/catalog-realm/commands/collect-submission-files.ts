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
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import ReadSourceCommand from '@cardstack/boxel-host/commands/read-source';
import SerializeCardCommand from '@cardstack/boxel-host/commands/serialize-card';

import type { Listing } from '../catalog-app/listing/listing';
import { FileContentField, FileCollectionResult } from '../fields/file-content';

const log = logger('commands:collect-submission-files');

interface FileWithContent {
  path: string;
  content: string;
}

class CollectSubmissionFilesInput extends CardDef {
  @field listingId = contains(StringField);
  @field listingRealm = contains(StringField);
  @field accessibleRealms = containsMany(StringField);
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
    let { listingId, listingRealm, accessibleRealms } = input;

    if (!listingId || !listingRealm) {
      throw new Error('Missing listingId or listingRealm');
    }

    let files = await this.collectFiles(
      listingId,
      listingRealm,
      accessibleRealms ?? [],
    );
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
    accessibleRealms: string[],
  ): Promise<FileWithContent[]> {
    let realmUrl = new RealmPaths(new URL(listingRealm)).url;
    let getCardCommand = new GetCardCommand(this.commandContext);
    let readSourceCommand = new ReadSourceCommand(this.commandContext);

    const listing = (await getCardCommand.execute({
      cardId: listingId,
    })) as Listing;

    if (!listing) {
      throw new Error(
        `Listing not found: ${listingId}. Cannot collect submission files for a non-existent listing.`,
      );
    }

    let examplesToSnapshot = listing.examples;
    if (listing.examples?.length) {
      examplesToSnapshot = await this.expandInstances(listing.examples);
    }

    const builder = new PlanBuilder(realmUrl, listing);

    let knownRealmUrls = new Set<string>();
    knownRealmUrls.add(realmUrl);
    for (const accessibleRealm of accessibleRealms) {
      if (!accessibleRealm) continue;
      let normalized = new RealmPaths(new URL(accessibleRealm)).url;
      knownRealmUrls.add(normalized);
      builder.resolver.addKnownRealmURL(new URL(normalized));
    }

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

    const toRepoPathNoExt = (fullUrl: string): string => {
      let path = fullUrl;
      // Try to strip any known realm URL prefix (longest match first
      // to handle nested realm paths correctly)
      let sortedRealms = [...knownRealmUrls].sort(
        (a, b) => b.length - a.length,
      );
      for (const realm of sortedRealms) {
        if (path.startsWith(realm)) {
          path = path.slice(realm.length);
          break;
        }
      }
      // Fallback: if no realm matched and path is still an absolute URL,
      // strip the origin and use the decoded pathname — same as
      // ListingPathResolver.local() fallback.
      try {
        let url = new URL(path);
        path = decodeURI(url.pathname);
      } catch {
        // not a URL — already a relative path
      }
      if (path.startsWith('/')) {
        path = path.slice(1);
      }
      return path;
    };

    const toRepoRelativePath = (fullUrl: string, extension: string): string => {
      let path = toRepoPathNoExt(fullUrl);
      if (!path.endsWith(extension)) {
        path = path + extension;
      }
      return path;
    };

    // Build a map of source URL (extension-less) → PR path (extension-less).
    // After the PR merges into the catalog, cross-realm references in the
    // submitted files must resolve to their new co-located files. We rewrite
    // all references in file contents to relative paths so the submission is
    // self-contained and deployment-agnostic.
    let urlToRepoPath = new Map<string, string>();
    if (listing.id) {
      urlToRepoPath.set(listing.id, toRepoPathNoExt(listing.id));
    }
    for (const moduleMeta of plan.modulesToInstall as CopyModuleMeta[]) {
      if (moduleMeta?.sourceModule) {
        urlToRepoPath.set(
          moduleMeta.sourceModule,
          toRepoPathNoExt(moduleMeta.sourceModule),
        );
      }
    }
    for (const copyMeta of plan.instancesCopy as CopyInstanceMeta[]) {
      if (copyMeta?.sourceCard?.id) {
        urlToRepoPath.set(
          copyMeta.sourceCard.id,
          toRepoPathNoExt(copyMeta.sourceCard.id),
        );
      }
    }

    const rewriteReferences = (content: string, fromPath: string): string => {
      let entries = [...urlToRepoPath.entries()].sort(
        (a, b) => b[0].length - a[0].length,
      );
      for (const [sourceUrl, targetPath] of entries) {
        let relative = relativeRepoPath(fromPath, targetPath);
        let escaped = sourceUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let pattern = new RegExp(escaped + '(?![a-zA-Z0-9_\\-\\.])', 'g');
        content = content.replace(pattern, relative);
      }
      return content;
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
        filesWithContent.push({
          path,
          content: rewriteReferences(source.content, path),
        });
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
        try {
          let source = await readSourceCommand.execute({
            path: moduleMeta.sourceModule,
          });
          filesWithContent.push({
            path,
            content: rewriteReferences(source.content, path),
          });
        } catch (e: any) {
          if (isAccessError(e)) {
            throw new Error(
              `Cannot collect files: no access to read module ${moduleMeta.sourceModule}`,
            );
          }
          throw e;
        }
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
        try {
          let source = await readSourceCommand.execute({
            path: `${sourceCardId}.json`,
          });
          filesWithContent.push({
            path,
            content: rewriteReferences(source.content, path),
          });
        } catch (e: any) {
          if (isAccessError(e)) {
            throw new Error(
              `Cannot collect files: no access to read card ${sourceCardId}`,
            );
          }
          throw e;
        }
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

function isAccessError(e: any): boolean {
  let status = e?.status ?? e?.response?.status ?? e?.code;
  if (status === 401 || status === 403) {
    return true;
  }
  let msg = typeof e?.message === 'string' ? e.message : '';
  return msg.includes('Unauthorized') || msg.includes('Forbidden');
}

function relativeRepoPath(fromPath: string, toPath: string): string {
  let fromDir = fromPath.split('/').slice(0, -1);
  let toParts = toPath.split('/');
  let common = 0;
  while (
    common < fromDir.length &&
    common < toParts.length &&
    fromDir[common] === toParts[common]
  ) {
    common++;
  }
  let up = fromDir.length - common;
  let down = toParts.slice(common);
  let parts = up > 0 ? [...Array(up).fill('..'), ...down] : ['.', ...down];
  return parts.join('/');
}
