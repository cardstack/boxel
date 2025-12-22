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
  isCardCollectionDocument,
  isSingleCardDocument,
} from '@cardstack/runtime-common';
import { logger } from '@cardstack/runtime-common';
import type {
  AtomicOperation,
  AtomicOperationResult,
} from '@cardstack/runtime-common/atomic-document';
import type { CopyInstanceMeta } from '@cardstack/runtime-common/catalog';
import type { CopyModuleMeta } from '@cardstack/runtime-common/catalog';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import type { CardDef } from 'https://cardstack.com/base/card-api';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';
import type RealmServerService from '../services/realm-server';
import type { Listing } from '@cardstack/catalog/listing/listing';

const log = logger('catalog:install');

export default class ListingInstallCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingInstallInput,
  typeof BaseCommandModule.ListingInstallResult
> {
  @service declare private realmServer: RealmServerService;
  @service declare private cardService: CardService;

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
      examplesToInstall = await this.expandExampleInstances(listing.examples);
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

  private async expandExampleInstances(
    examples: Array<{ id: string }>,
  ): Promise<CardDef[]> {
    let api = await this.cardService.getAPI();
    let instancesById = new Map<string, CardDef>();
    let visited = new Set<string>();
    let queue: string[] = examples.map((example) => example.id);

    while (queue.length > 0) {
      let id = queue.shift();
      if (!id || visited.has(id)) {
        continue;
      }
      visited.add(id);

      let doc = await this.cardService.fetchJSON(id);
      if (!isSingleCardDocument(doc)) {
        throw new Error(`Expected single document for ${id}`);
      }
      if (!doc.data.id) {
        doc.data.id = id;
      }
      let instance = (await api.createFromSerialized(
        doc.data,
        doc,
        new URL(doc.data.id),
      )) as CardDef;
      instancesById.set(instance.id ?? doc.data.id, instance);

      let relationships = doc.data.relationships ?? {};
      let entries = Object.entries(relationships);
      log.debug(`Relationships for ${id}:`);
      if (entries.length === 0) {
        log.debug('[]');
        continue;
      }
      let summary = entries.map(([field, rel]) => ({
        field,
        links: rel.links ?? null,
        data: rel.data ?? null,
      }));
      log.debug(JSON.stringify(summary, null, 2));

      for (let rel of Object.values(relationships)) {
        let relatedIds = await this.collectRelationshipIds(
          rel,
          doc.data.id ?? id,
        );
        for (let relatedId of relatedIds) {
          if (!visited.has(relatedId)) {
            queue.push(relatedId);
          }
        }
      }
    }

    return [...instancesById.values()];
  }

  private async collectRelationshipIds(
    relationship: { links?: { self?: string | null; related?: string | null }; data?: unknown },
    relativeTo: string,
  ): Promise<string[]> {
    let ids = this.extractRelationshipIds(relationship.data);
    if (ids.length > 0) {
      return ids;
    }

    let link = relationship.links?.related ?? relationship.links?.self;
    if (!link) {
      return ids;
    }
    let href = new URL(link, relativeTo).href;
    let response = await this.cardService.fetchJSON(href);
    if (!response) {
      return ids;
    }
    if (isSingleCardDocument(response)) {
      if (response.data.id) {
        ids.push(response.data.id);
      }
      return ids;
    }
    if (isCardCollectionDocument(response)) {
      for (let item of response.data) {
        if (item.id) {
          ids.push(item.id);
        }
      }
      return ids;
    }
    if (typeof response === 'object' && response !== null && 'data' in response) {
      ids.push(...this.extractRelationshipIds((response as { data?: unknown }).data));
    }
    return ids;
  }

  private extractRelationshipIds(data: unknown): string[] {
    let ids: string[] = [];
    if (!data || typeof data !== 'object') {
      return ids;
    }
    if (Array.isArray(data)) {
      for (let item of data) {
        if (item && typeof item === 'object' && 'id' in item) {
          let id = (item as { id?: string }).id;
          if (typeof id === 'string') {
            ids.push(id);
          }
        }
      }
      return ids;
    }
    if ('id' in data) {
      let id = (data as { id?: string }).id;
      if (typeof id === 'string') {
        ids.push(id);
      }
    }
    return ids;
  }
}
