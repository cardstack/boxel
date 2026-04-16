import {
  cardIdToURL,
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
import GetAvailableRealmUrlsCommand from './get-available-realm-urls';
import SaveCardCommand from './save-card';

import type { Listing } from '@cardstack/catalog/catalog-app/listing/listing';

export default class ListingUseCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingInstallInput
> {
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
    let { realm, listing: listingInput } = input;

    const listing = listingInput as Listing;

    let realmUrl = new RealmPaths(new URL(realm)).url;

    // Make sure realm is valid
    let { urls: realmUrls } = await new GetAvailableRealmUrlsCommand(
      this.commandContext,
    ).execute(undefined);
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
      let url = cardIdToURL(spec.id);
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
