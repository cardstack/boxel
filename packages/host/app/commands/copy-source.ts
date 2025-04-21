import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';

export default class CopySourceCommand extends HostBaseCommand<
  typeof BaseCommandModule.CopySourceInput
> {
  @service declare private cardService: CardService;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CopySourceInput } = commandModule;
    return CopySourceInput;
  }

  protected async run(
    input: BaseCommandModule.CopySourceInput,
  ): Promise<undefined> {
    const fromRealmUrl = new URL(input.fromRealmUrl);
    const toRealmUrl = new URL(input.toRealmUrl);
    await this.cardService.copySource(fromRealmUrl, toRealmUrl);
  }
}
