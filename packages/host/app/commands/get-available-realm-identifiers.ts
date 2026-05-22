import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type RealmServerService from '../services/realm-server';

export default class GetAvailableRealmIdentifiersCommand extends HostBaseCommand<
  undefined,
  typeof BaseCommandModule.GetAvailableRealmIdentifiersResult
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Get Realm Identifiers';
  description = 'Get the list of available realm identifiers';

  async getInputType() {
    return undefined;
  }

  protected async run(): Promise<BaseCommandModule.GetAvailableRealmIdentifiersResult> {
    let commandModule = await this.loadCommandModule();
    const { GetAvailableRealmIdentifiersResult } = commandModule;
    return new GetAvailableRealmIdentifiersResult({
      realmIdentifiers: this.realmServer.availableRealmIdentifiers,
    });
  }
}
