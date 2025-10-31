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
      .addIf(listing.examples?.length > 0, (resolver: ListingPathResolver) => {
        let r = planInstanceInstall(listing.examples, resolver);
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
}
