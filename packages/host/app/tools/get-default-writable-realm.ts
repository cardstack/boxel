import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type RealmService from '../services/realm';

export default class GetDefaultWritableRealmTool extends HostBaseTool<
  undefined,
  typeof BaseCommandModule.GetDefaultWritableRealmResult
> {
  @service declare private realm: RealmService;

  description = 'Get the path of the default writable realm';

  async getInputType() {
    return undefined;
  }

  protected async run(): Promise<BaseCommandModule.GetDefaultWritableRealmResult> {
    let commandModule = await this.loadCommandModule();
    const { GetDefaultWritableRealmResult } = commandModule;
    return new GetDefaultWritableRealmResult({
      realmIdentifier: this.realm.defaultWritableRealm?.path ?? '',
    });
  }
}
