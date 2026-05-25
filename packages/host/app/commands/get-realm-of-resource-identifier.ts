import { service } from '@ember/service';

import { rri } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type RealmService from '../services/realm';

export default class GetRealmOfResourceIdentifierCommand extends HostBaseCommand<
  typeof BaseCommandModule.GetRealmOfResourceIdentifierInput,
  typeof BaseCommandModule.GetRealmOfResourceIdentifierResult
> {
  @service declare private realm: RealmService;

  description = 'Get the realm that contains a given resource';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { GetRealmOfResourceIdentifierInput } = commandModule;
    return GetRealmOfResourceIdentifierInput;
  }

  requireInputFields = ['resourceIdentifier'];

  protected async run(
    input: BaseCommandModule.GetRealmOfResourceIdentifierInput,
  ): Promise<BaseCommandModule.GetRealmOfResourceIdentifierResult> {
    let commandModule = await this.loadCommandModule();
    const { GetRealmOfResourceIdentifierResult } = commandModule;
    const realmIdentifier = this.realm.realmOf(rri(input.resourceIdentifier));
    return new GetRealmOfResourceIdentifierResult({
      realmIdentifier: realmIdentifier ?? '',
    });
  }
}
