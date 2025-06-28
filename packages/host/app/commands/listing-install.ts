import { service } from '@ember/service';

import {
  type ResolvedCodeRef,
  type Command,
  CommandContext,
  RealmPaths,
  join,
  type FinalInstallPlan,
  InstallOptions,
  planModuleInstall,
  planInstanceInstall,
  PlanBuilder,
  LocalPath,
} from '@cardstack/runtime-common';

import { logger } from '@cardstack/runtime-common';

import * as CardAPI from 'https://cardstack.com/base/card-api';
import * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import CopyCardCommand from './copy-card';
import CopySourceCommand from './copy-source';

import type RealmServerService from '../services/realm-server';
import type { Listing } from '@cardstack/catalog/listing/listing';

const log = logger('catalog:install');

interface InstallListingInput {
  realmUrl: string;
  listing: Listing;
  commandContext: Command<
    typeof BaseCommandModule.ListingInput
  >['commandContext'];
  cardAPI: typeof CardAPI;
}

interface InstallListingResult {
  selectedCodeRef?: ResolvedCodeRef;
  shouldPersistPlaygroundSelection: boolean;
  firstExampleCardId?: string;
  firstSkillCardId?: string;
}

interface InstallResults {
  modules: string[];
  instances: string[];
}

async function install(
  plan: FinalInstallPlan,
  opts: InstallOptions,
  commandContext: CommandContext,
): Promise<InstallResults> {
  let r: InstallResults = {
    modules: [],
    instances: [],
  };
  for (const { sourceModule, targetModule } of plan.modulesToInstall) {
    let { url } = await new CopySourceCommand(commandContext).execute({
      fromRealmUrl: sourceModule,
      toRealmUrl: targetModule,
    });
    r.modules.push(url);
  }

  for (const { sourceCard, localDir, targetCodeRef } of plan.instancesCopy) {
    let { newCardId } = await new CopyCardCommand(commandContext).execute({
      sourceCard,
      realm: opts.targetRealm,
      localDir,
      codeRef: targetCodeRef,
    });
    r.instances.push(newCardId);
  }
  return r;
}

export async function installListing({
  realmUrl,
  listing,
  commandContext,
}: InstallListingInput): Promise<InstallListingResult> {
  let installOpts = new InstallOptions(realmUrl, listing);

  // side-effects
  let shouldPersistPlaygroundSelection = false;
  let firstExampleCardId: string | undefined;
  let selectedCodeRef: ResolvedCodeRef | undefined;
  let skillLocalDir: LocalPath | undefined;

  const builder = new PlanBuilder(installOpts);

  builder
    .addIf(listing.specs?.length > 0, (opts) => {
      let r = planModuleInstall(listing.specs, opts);
      selectedCodeRef = r.modulesCopy[0].targetCodeRef;
      shouldPersistPlaygroundSelection = true;
      return r;
    })
    .addIf(listing.examples?.length > 0, (opts) => {
      let r = planInstanceInstall(listing.examples, opts);
      firstExampleCardId = r.instancesCopy[0].sourceCard.id;
      return r;
    })
    .addIf(listing.skills?.length > 0, (opts) => {
      let r = planInstanceInstall(listing.skills, opts);
      skillLocalDir = r.instancesCopy[0].localDir;
      return r;
    });

  const finalPlan = builder.build();
  let results = await install(finalPlan, installOpts, commandContext);
  log.debug('=== Final Results ===');
  log.debug(JSON.stringify(results, null, 2));

  let firstSkillCardId = skillLocalDir
    ? results.instances.find((id) => {
        let root = join(realmUrl, skillLocalDir ?? '');
        return new RealmPaths(new URL(root)).inRealm(new URL(id));
      })
    : undefined;

  return {
    selectedCodeRef,
    shouldPersistPlaygroundSelection,
    firstExampleCardId,
    firstSkillCardId,
  };
}

export default class ListingInstallCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingInput
> {
  @service declare private realmServer: RealmServerService;

  #cardAPI?: typeof CardAPI;

  async loadCardAPI() {
    if (!this.#cardAPI) {
      this.#cardAPI = await this.loaderService.loader.import<typeof CardAPI>(
        'https://cardstack.com/base/card-api',
      );
    }
    return this.#cardAPI;
  }

  description =
    'Install catalog listing with bringing them to code mode, and then remixing them via AI';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ListingInput } = commandModule;
    return ListingInput;
  }

  protected async run(
    input: BaseCommandModule.ListingInput,
  ): Promise<undefined> {
    let realmUrls = this.realmServer.availableRealmURLs;
    let { realm, listing: listingInput } = input;

    let realmUrl = new RealmPaths(new URL(realm)).url;

    // Make sure realm is valid
    if (!realmUrls.includes(realmUrl)) {
      throw new Error(`Invalid realm: ${realmUrl}`);
    }

    // this is intentionally to type because base command cannot interpret Listing type from catalog
    const listing = listingInput as Listing;
    const cardAPI = await this.loadCardAPI();

    await installListing({
      realmUrl,
      listing,
      commandContext: this.commandContext,
      cardAPI,
    });
  }
}
