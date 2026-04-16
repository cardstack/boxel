import type {
  ListingPathResolver,
  ModuleResource,
  LooseCardResource,
} from '@cardstack/runtime-common';
import {
  type ResolvedCodeRef,
  RealmPaths,
  join,
  planModuleInstall,
  planInstanceInstall,
  PlanBuilder,
  extractRelationshipIds,
  type Relationship,
} from '@cardstack/runtime-common';
import { logger } from '@cardstack/runtime-common';
import type { CopyInstanceMeta } from '@cardstack/runtime-common/catalog';
import type { CopyModuleMeta } from '@cardstack/runtime-common/catalog';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import ExecuteAtomicOperationsCommand from './execute-atomic-operations';
import FetchCardJsonCommand from './fetch-card-json';
import GetAvailableRealmUrlsCommand from './get-available-realm-urls';
import GetCardCommand from './get-card';
import ReadSourceCommand from './read-source';
import SerializeCardCommand from './serialize-card';

import type { Listing } from '@cardstack/catalog/catalog-app/listing/listing';

const log = logger('catalog:install');

export default class ListingInstallCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingInstallInput,
  typeof BaseCommandModule.ListingInstallResult
> {
  description =
    'Install catalog listing with bringing them to code mode, and then remixing them via AI';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ListingInstallInput } = commandModule;
    return ListingInstallInput;
  }

  requireInputFields = ['realm', 'listing'];

  protected async run(
    input: BaseCommandModule.ListingInstallInput,
  ): Promise<BaseCommandModule.ListingInstallResult> {
    let { realm, listing: listingInput } = input;

    let realmUrl = new RealmPaths(new URL(realm)).url;

    let { urls: realmUrls } = await new GetAvailableRealmUrlsCommand(
      this.commandContext,
    ).execute(undefined);
    if (!realmUrls.includes(realmUrl)) {
      throw new Error(`Invalid realm: ${realmUrl}`);
    }

    // this is intentionally to type because base command cannot interpret Listing type from catalog
    const listing = listingInput as Listing;

    let examplesToInstall = listing.examples;
    if (listing.examples?.length) {
      examplesToInstall = await this.expandInstances(listing.examples);
    }

    // side-effects
    let exampleCardId: string | undefined;
    let selectedCodeRef: ResolvedCodeRef | undefined;
    let skillCardId: string | undefined;

    const builder = new PlanBuilder(realmUrl, listing);

    builder
      .addIf(listing.specs?.length > 0, (resolver: ListingPathResolver) => {
        let r = planModuleInstall(listing.specs, resolver);
        selectedCodeRef = r.modulesCopy[0].targetCodeRef;
        return r;
      })
      .addIf(examplesToInstall?.length > 0, (resolver: ListingPathResolver) => {
        let r = planInstanceInstall(examplesToInstall, resolver);
        let firstInstance = r.instancesCopy[0];
        exampleCardId = join(realmUrl, firstInstance.lid);
        selectedCodeRef = firstInstance.targetCodeRef;
        return r;
      })
      .addIf(listing.skills?.length > 0, (resolver: ListingPathResolver) => {
        let r = planInstanceInstall(listing.skills, resolver);
        skillCardId = join(realmUrl, r.instancesCopy[0].lid);
        return r;
      });

    const plan = builder.build();

    let sourceOperations = await Promise.all(
      plan.modulesToInstall.map(async (moduleMeta: CopyModuleMeta) => {
        let { sourceModule, targetModule } = moduleMeta;
        let { content } = await new ReadSourceCommand(
          this.commandContext,
        ).execute({ path: sourceModule });
        let moduleResource: ModuleResource = {
          type: 'source',
          attributes: { content },
          meta: {},
        };
        let href = targetModule + '.gts';
        return { op: 'add' as const, href, data: moduleResource };
      }),
    );

    let instanceOperations = await Promise.all(
      plan.instancesCopy.map(async (copyInstanceMeta: CopyInstanceMeta) => {
        let { sourceCard } = copyInstanceMeta;
        let { document: doc } = await new FetchCardJsonCommand(
          this.commandContext,
        ).execute({ url: sourceCard.id });
        if (!doc || !('data' in doc)) {
          throw new Error('We are only expecting single documents returned');
        }
        delete (doc as any).data.id;
        delete (doc as any).included;
        let cardResource: LooseCardResource = (doc as any).data as LooseCardResource;
        let href = join(realmUrl, copyInstanceMeta.lid) + '.json';
        return { op: 'add' as const, href, data: cardResource };
      }),
    );

    const operations = [...sourceOperations, ...instanceOperations];

    const { results: atomicResults } = await new ExecuteAtomicOperationsCommand(
      this.commandContext,
    ).execute({ realmUrl, operations });

    let writtenFiles = (atomicResults as Array<Record<string, any>>).map(
      (r) => r.data?.id,
    );
    log.debug('=== Final Results ===');
    log.debug(JSON.stringify(writtenFiles, null, 2));

    let commandModule = await this.loadCommandModule();
    const { ListingInstallResult } = commandModule;
    return new ListingInstallResult({
      selectedCodeRef,
      exampleCardId,
      skillCardId,
    });
  }

  // Walk relationships by fetching linked cards and enqueueing their ids.
  private async expandInstances(instances: CardDef[]): Promise<CardDef[]> {
    let instancesById = new Map<string, CardDef>();
    let visited = new Set<string>();
    let queue: string[] = instances
      .map((instance) => instance.id)
      .filter((id): id is string => typeof id === 'string');

    // - Queue of ids to traverse; visited prevents duplicate relationship ids.
    // - Each loop extracts relationship ids and enqueues them, so we descend
    //   through the relationship graph breadth-first.
    while (queue.length > 0) {
      let id = queue.shift();
      if (!id || visited.has(id)) {
        continue;
      }
      visited.add(id);

      let instance = (await new GetCardCommand(this.commandContext).execute({
        cardId: id,
      })) as CardDef;
      instancesById.set(instance.id ?? id, instance);

      let { json: serialized } = await new SerializeCardCommand(
        this.commandContext,
      ).execute({ cardId: id });
      let baseUrl: string = (serialized as any)?.data?.id ?? id;
      let relationships: Record<string, Relationship | Relationship[]> =
        (serialized as any)?.data?.relationships ?? {};

      let entries = Object.entries(relationships);
      log.debug(`Relationships for ${id}:`);
      if (entries.length === 0) {
        log.debug('[]');
        continue;
      }
      let summary = entries.map(([field, rel]) => {
        let rels = Array.isArray(rel) ? rel : [rel];
        return {
          field,
          relationships: rels.map((relationship) => ({
            links: relationship.links ?? null,
            data: relationship.data ?? null,
          })),
        };
      });
      log.debug(JSON.stringify(summary, null, 2));

      for (let rel of Object.values(relationships)) {
        let rels = Array.isArray(rel) ? rel : [rel];
        for (let relationship of rels) {
          let relatedIds = extractRelationshipIds(relationship, baseUrl);
          for (let relatedId of relatedIds) {
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
