import { service } from '@ember/service';

import {
  codeRefWithAbsoluteURL,
  isResolvedCodeRef,
  loadCardDef,
  generateInstallFolderName,
  RealmPaths,
} from '@cardstack/runtime-common';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import type { Skill } from 'https://cardstack.com/base/skill';

import HostBaseCommand from '../lib/host-base-command';

import CopyCardToRealmCommand from './copy-card';
import SaveCardCommand from './save-card';

import type RealmServerService from '../services/realm-server';
import type { Listing } from '@cardstack/catalog/listing/listing';

export default class ListingUseCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingInstallInput
> {
  @service declare private realmServer: RealmServerService;

  description = 'Catalog listing use command';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ListingInstallInput } = commandModule;
    return ListingInstallInput;
  }

  requireInputFields = ['realm', 'listing'];

  protected async run(
    input: BaseCommandModule.ListingInstallInput,
  ): Promise<undefined> {
    let realmUrls = this.realmServer.availableRealmURLs;
    let { realm, listing: listingInput } = input;

    const listing = listingInput as Listing;

    let realmUrl = new RealmPaths(new URL(realm)).url;

    // Make sure realm is valid
    if (!realmUrls.includes(realmUrl)) {
      throw new Error(`Invalid realm: ${realmUrl}`);
    }

    const specsToCopy = listing.specs ?? [];
    const specsWithoutFields = specsToCopy.filter(
      (spec) => spec.specType !== 'field',
    );

    const localDir = generateInstallFolderName(listing.name);

    for (const spec of specsWithoutFields) {
      if (spec.isComponent) {
        return;
      }
      let url = new URL(spec.id);
      let ref = codeRefWithAbsoluteURL(spec.ref, url);
      if (!isResolvedCodeRef(ref)) {
        throw new Error('ref is not a resolved code ref');
      }
      let Klass = await loadCardDef(ref, {
        loader: this.loaderService.loader,
      });
      let card = new Klass({}) as CardAPI.CardDef;
      await new SaveCardCommand(this.commandContext).execute({
        card,
        realm: realmUrl,
        localDir,
      });
    }

    if (listing.examples) {
      const sourceCards = (listing.examples as CardAPI.CardDef[]).map(
        (example) => example,
      );
      for (const card of sourceCards) {
        await new CopyCardToRealmCommand(this.commandContext).execute({
          sourceCard: card,
          targetRealm: realmUrl,
          localDir,
        });
      }
    }

    if ('skills' in listing && Array.isArray(listing.skills)) {
      await Promise.all(
        listing.skills.map((skill: Skill) =>
          new CopyCardToRealmCommand(this.commandContext).execute({
            sourceCard: skill,
            targetRealm: realmUrl,
            localDir,
          }),
        ),
      );
    }
  }
}
