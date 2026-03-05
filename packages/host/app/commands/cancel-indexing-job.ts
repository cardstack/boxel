import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type RealmServerService from '../services/realm-server';

export default class CancelIndexingJobCommand extends HostBaseCommand<
  typeof BaseCommandModule.CancelIndexingJobInput,
  undefined
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Cancel';
  description = 'Cancel any currently running indexing job for a realm';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CancelIndexingJobInput } = commandModule;
    return CancelIndexingJobInput;
  }

  protected async run(
    input: BaseCommandModule.CancelIndexingJobInput,
  ): Promise<undefined> {
    await this.realmServer.cancelIndexingJob(input.realmUrl);
  }
}
