import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type RealmServerService from '../services/realm-server';

export default class GetAvailableRealmUrlsCommand extends HostBaseCommand<
  undefined,
  typeof BaseCommandModule.GetAvailableRealmUrlsResult
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Get Realm URLs';
  description = 'Get the list of available realm URLs';

  async getInputType() {
    return undefined;
  }

  protected async run(): Promise<BaseCommandModule.GetAvailableRealmUrlsResult> {
    let commandModule = await this.loadCommandModule();
    const { GetAvailableRealmUrlsResult } = commandModule;
    return new GetAvailableRealmUrlsResult({
      urls: this.realmServer.availableRealmURLs,
    });
  }
}
