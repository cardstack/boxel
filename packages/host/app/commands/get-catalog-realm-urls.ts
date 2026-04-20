import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type RealmServerService from '../services/realm-server';

export default class GetCatalogRealmUrlsCommand extends HostBaseCommand<
  undefined,
  typeof BaseCommandModule.GetCatalogRealmUrlsResult
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Get Catalog Realm URLs';
  description = 'Get the list of catalog realm URLs';

  async getInputType() {
    return undefined;
  }

  protected async run(): Promise<BaseCommandModule.GetCatalogRealmUrlsResult> {
    let commandModule = await this.loadCommandModule();
    const { GetCatalogRealmUrlsResult } = commandModule;
    return new GetCatalogRealmUrlsResult({
      urls: this.realmServer.catalogRealmURLs,
    });
  }
}
