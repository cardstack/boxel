import { service } from '@ember/service';

import deburr from 'lodash/deburr';
import { v4 as uuidv4 } from 'uuid';

import {
  codeRefWithAbsoluteURL,
  isResolvedCodeRef,
  loadCardDef,
} from '@cardstack/runtime-common';

import * as CardAPI from 'https://cardstack.com/base/card-api';
import * as BaseCommandModule from 'https://cardstack.com/base/command';

import type { Skill } from 'https://cardstack.com/base/skill';

import HostBaseCommand from '../lib/host-base-command';

import CopyCardCommand from './copy-card';
import SaveCardCommand from './save-card';

import type RealmServerService from '../services/realm-server';
import type { Listing } from '@cardstack/catalog/listing/listing';

function nameWithUuid(listingName?: string) {
  if (!listingName) {
    return '';
  }
  // sanitize the listing name, eg: Blog App -> blog-app
  const sanitizedListingName = deburr(listingName.toLocaleLowerCase())
    .replace(/ /g, '-')
    .replace(/'/g, '');
  const newPackageName = `${sanitizedListingName}-${uuidv4()}`;
  return newPackageName;
}
export default class ListingUseCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingInput
> {
  @service declare private realmServer: RealmServerService;

  description = 'Catalog listing use command';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ListingInput } = commandModule;
    return ListingInput;
  }

  protected async run(
    input: BaseCommandModule.ListingInput,
  ): Promise<undefined> {
    let realmUrls = this.realmServer.availableRealmURLs;
    let { realm: realmUrl, listing: listingInput } = input;

    const listing = listingInput as Listing;

    // Make sure realm is valid
    if (!realmUrls.includes(realmUrl)) {
      throw new Error(`Invalid realm: ${realmUrl}`);
    }

    const specsToCopy = listing.specs ?? [];
    const specsWithoutFields = specsToCopy.filter(
      (spec) => spec.specType !== 'field',
    );

    const localDir = nameWithUuid(listing.name);

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
        await new CopyCardCommand(this.commandContext).execute({
          sourceCard: card,
          realm: realmUrl,
          localDir,
        });
      }
    }

    if ('skills' in listing && Array.isArray(listing.skills)) {
      await Promise.all(
        listing.skills.map((skill: Skill) =>
          new CopyCardCommand(this.commandContext).execute({
            sourceCard: skill,
            realm: realmUrl,
            localDir,
          }),
        ),
      );
    }
  }
}
