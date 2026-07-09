import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type RealmServerService from '../services/realm-server';

export default class GetAvailableRealmIdentifiersTool extends HostBaseTool<
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
