import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type RealmService from '../services/realm';

export default class ReindexRealmCommand extends HostBaseCommand<
  typeof BaseCommandModule.ReindexRealmInput,
  undefined
> {
  @service declare private realm: RealmService;

  static actionVerb = 'Reindex';
  description =
    'Reindex a realm using the lighter/default mode. This republishes a from-scratch indexing job but only revisits files whose indexed state appears stale based on current mtime, deletion, or error semantics. Use this when the user wants to pick up normal recent changes.';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ReindexRealmInput } = commandModule;
    return ReindexRealmInput;
  }

  protected async run(
    input: BaseCommandModule.ReindexRealmInput,
  ): Promise<undefined> {
    await this.realm.reindex(input.realmUrl);
  }
}
