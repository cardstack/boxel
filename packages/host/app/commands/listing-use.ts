import { service } from '@ember/service';

import {
  codeRefWithAbsoluteIdentifier,
  isResolvedCodeRef,
  loadCardDef,
  generateInstallFolderName,
  rri,
} from '@cardstack/runtime-common';

import type { Listing } from '@cardstack/runtime-common';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import type { Skill } from 'https://cardstack.com/base/skill';

import HostBaseCommand from '../lib/host-base-command';

import CopyCardToRealmCommand from './copy-card';
import SaveCardCommand from './save-card';
import ValidateRealmCommand from './validate-realm';

import type NetworkService from '../services/network';

export default class ListingUseCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingInstallInput
> {
  @service declare private network: NetworkService;

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

    let { realmIdentifier } = await new ValidateRealmCommand(
      this.commandContext,
    ).execute({ realmIdentifier: realm });

    const specsToCopy = listing.specs ?? [];
    const specsWithoutFields = specsToCopy.filter(
      (spec) => spec.specType !== 'field',
    );

    const localDir = generateInstallFolderName(listing.name);

    for (const spec of specsWithoutFields) {
      if (spec.isComponent) {
        return;
      }
      let ref = codeRefWithAbsoluteIdentifier(
        spec.ref,
        rri(spec.id),
        undefined,
        this.network.virtualNetwork,
      );
      if (!isResolvedCodeRef(ref)) {
        throw new Error('ref is not a resolved code ref');
      }
      let Klass = await loadCardDef(ref, {
        loader: this.loaderService.loader,
      });
      let card = new Klass({}) as CardAPI.CardDef;
      await new SaveCardCommand(this.commandContext).execute({
        card,
        realm: realmIdentifier,
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
          targetRealm: realmIdentifier,
          localDir,
        });
      }
    }

    if ('skills' in listing && Array.isArray(listing.skills)) {
      await Promise.all(
        listing.skills.map((skill: Skill) =>
          new CopyCardToRealmCommand(this.commandContext).execute({
            sourceCard: skill,
            targetRealm: realmIdentifier,
            localDir,
          }),
        ),
      );
    }
  }
}
