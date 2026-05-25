import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type RealmServerService from '../services/realm-server';

export default class GetCatalogRealmIdentifiersCommand extends HostBaseCommand<
  undefined,
  typeof BaseCommandModule.GetCatalogRealmIdentifiersResult
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Get Catalog Realm Identifiers';
  description = 'Get the list of catalog realm identifiers';

  async getInputType() {
    return undefined;
  }

  protected async run(): Promise<BaseCommandModule.GetCatalogRealmIdentifiersResult> {
    let commandModule = await this.loadCommandModule();
    const { GetCatalogRealmIdentifiersResult } = commandModule;
    return new GetCatalogRealmIdentifiersResult({
      realmIdentifiers: this.realmServer.catalogRealmIdentifiers,
    });
  }
}
