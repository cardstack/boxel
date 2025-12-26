import { service } from '@ember/service';

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
  isCardInstance,
  isSingleCardDocument,
  type Relationship,
} from '@cardstack/runtime-common';
import { logger } from '@cardstack/runtime-common';
import type {
  AtomicOperation,
  AtomicOperationResult,
} from '@cardstack/runtime-common/atomic-document';
import type { CopyInstanceMeta } from '@cardstack/runtime-common/catalog';
import type { CopyModuleMeta } from '@cardstack/runtime-common/catalog';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';
import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';
import type { Listing } from '@cardstack/catalog/listing/listing';

const log = logger('catalog:install');

export default class ListingInstallCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingInstallInput,
  typeof BaseCommandModule.ListingInstallResult
> {
  @service declare private realmServer: RealmServerService;
  @service declare private cardService: CardService;
  @service declare private store: StoreService;

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
    let realmUrls = this.realmServer.availableRealmURLs;
    let { realm, listing: listingInput } = input;

    let realmUrl = new RealmPaths(new URL(realm)).url;

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
        let res = await this.cardService.getSource(new URL(sourceModule));
        let moduleResource: ModuleResource = {
          type: 'source',
          attributes: { content: res.content },
          meta: {},
        };
        let href = targetModule + '.gts';
        return {
          op: 'add' as const,
          href,
          data: moduleResource,
        };
      }),
    );
    let instanceOperations = await Promise.all(
      plan.instancesCopy.map(async (copyInstanceMeta: CopyInstanceMeta) => {
        let { sourceCard } = copyInstanceMeta;
        let doc = await this.cardService.fetchJSON(sourceCard.id);
        if (!isSingleCardDocument(doc)) {
          throw new Error('We are only expecting single documents returned');
        }
        delete doc.data.id;
        delete doc.included;
        let cardResource: LooseCardResource = doc?.data;
        let href = join(realmUrl, copyInstanceMeta.lid) + '.json';
        return {
          op: 'add' as const,
          href,
          data: cardResource,
        };
      }),
    );

    let operations: AtomicOperation[] = [
      ...sourceOperations,
      ...instanceOperations,
    ];

    let results = await this.cardService.executeAtomicOperations(
      operations,
      new URL(realmUrl),
    );

    let atomicResults: AtomicOperationResult[] = results['atomic:results'];
    let writtenFiles = atomicResults.map((r) => r.data.id);
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

      let cachedInstance = this.store.peek(id);
      let relationships: Record<string, Relationship | Relationship[]> = {};
      let baseUrl = id;
      let instance = isCardInstance(cachedInstance)
        ? cachedInstance
        : await this.store.get(id);
      if (!isCardInstance(instance)) {
        throw new Error(`Expected card instance for ${id}`);
      }
      instancesById.set(instance.id ?? id, instance);
      let serialized = await this.cardService.serializeCard(instance, {
        omitQueryFields: true,
      });
      if (serialized.data.id) {
        baseUrl = serialized.data.id;
      }
      relationships = serialized.data.relationships ?? {};

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
