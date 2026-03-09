import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type RealmService from '../services/realm';

export default class CancelIndexingJobCommand extends HostBaseCommand<
  typeof BaseCommandModule.RealmUrlCard,
  undefined
> {
  @service declare private realm: RealmService;

  static actionVerb = 'Cancel';
  description = 'Cancel any currently running indexing job for a realm';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { RealmUrlCard } = commandModule;
    return RealmUrlCard;
  }

  protected async run(
    input: BaseCommandModule.RealmUrlCard,
  ): Promise<undefined> {
    await this.realm.cancelIndexingJob(input.realmUrl);
  }
}
