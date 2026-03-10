import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type RealmService from '../services/realm';

export default class ReindexRealmCommand extends HostBaseCommand<
  typeof BaseCommandModule.RealmUrlCard,
  undefined
> {
  @service declare private realm: RealmService;

  static actionVerb = 'Reindex';
  description =
    'Reindex a realm using the lighter/default mode. This republishes a from-scratch indexing job but only revisits files whose indexed state appears stale based on current mtime, deletion, or error semantics. Use this when the user wants to pick up normal recent changes. A user may request that they want to reload or refresh a realm in order to re-index it.';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { RealmUrlCard } = commandModule;
    return RealmUrlCard;
  }

  protected async run(
    input: BaseCommandModule.RealmUrlCard,
  ): Promise<undefined> {
    await this.realm.reindex(input.realmUrl);
  }
}
