import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';

export default class CopySourceCommand extends HostBaseCommand<
  typeof BaseCommandModule.CopySourceInput,
  typeof BaseCommandModule.CopySourceResult
> {
  @service declare private cardService: CardService;

  static actionVerb = 'Copy';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CopySourceInput } = commandModule;
    return CopySourceInput;
  }

  protected async run(
    input: BaseCommandModule.CopySourceInput,
  ): Promise<BaseCommandModule.CopySourceResult> {
    const fromRealmUrl = new URL(input.fromRealmUrl);
    const toRealmUrl = new URL(input.toRealmUrl);
    let r = await this.cardService.copySource(fromRealmUrl, toRealmUrl);
    let commandModule = await this.loadCommandModule();
    const { CopySourceResult } = commandModule;
    if (r.ok && r.url) {
      return new CopySourceResult({ url: r.url });
    }
  }
}
