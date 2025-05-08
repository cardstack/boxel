import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';

export class RemixCommand extends HostBaseCommand<
  typeof BaseCommandModule.RemixInput
> {
  @service declare private store: StoreService;
  @service declare private realmServer: RealmServerService;

  description =
    'Install catalog listing with bringing them to code mode, and then remixing them via AI';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { RemixInput } = commandModule;
    return RemixInput;
  }

  protected async run(input: BaseCommandModule.RemixInput): Promise<undefined> {
    let realmUrls = this.realmServer.availableRealmURLs;
    let { realm, listing } = input;

    // Make sure realm is valid
    if (!realmUrls.includes(realm)) {
      throw new Error(`Invalid realm: ${realm}`);
    }

    // Make sure listingName is exists in the realm
    /*  let listing = await this.store.search(
      {
        filter: {
          eq: {
            name: listingName,
          },
        },
      },
      new URL(realm),
    );
    if (!listing) {
      throw new Error(`Listing ${listingName} not found in realm: ${realm}`);
    } */

    console.log('listing', listing);

    // Install the listing
    /// remix it as fitted
  }
}
