import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type RealmService from '../services/realm';

export default class GetRealmOfUrlCommand extends HostBaseCommand<
  typeof BaseCommandModule.GetRealmOfUrlInput,
  typeof BaseCommandModule.GetRealmOfUrlResult
> {
  @service declare private realm: RealmService;

  description = 'Get the realm URL that contains a given URL';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { GetRealmOfUrlInput } = commandModule;
    return GetRealmOfUrlInput;
  }

  requireInputFields = ['url'];

  protected async run(
    input: BaseCommandModule.GetRealmOfUrlInput,
  ): Promise<BaseCommandModule.GetRealmOfUrlResult> {
    let commandModule = await this.loadCommandModule();
    const { GetRealmOfUrlResult } = commandModule;
    const realmUrl = this.realm.realmOfURL(new URL(input.url));
    return new GetRealmOfUrlResult({ realmUrl: realmUrl?.href ?? '' });
  }
}
