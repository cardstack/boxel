import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type RealmService from '../services/realm';

export default class InvalidateRealmUrlsCommand extends HostBaseCommand<
  typeof BaseCommandModule.InvalidateRealmUrlsInput,
  undefined
> {
  @service declare private realm: RealmService;

  static actionVerb = 'Invalidate';
  description =
    'Invalidate files in a realm to trigger re-indexing. A user may request that they want to reload or refresh a card in order to re-index it.';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { InvalidateRealmUrlsInput } = commandModule;
    return InvalidateRealmUrlsInput;
  }

  protected async run(
    input: BaseCommandModule.InvalidateRealmUrlsInput,
  ): Promise<undefined> {
    await this.realm.invalidateUrls(input.realmUrl, input.urls);
  }
}
