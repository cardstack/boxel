import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type RealmServerService from '../services/realm-server';

export default class UnregisterBotCommand extends HostBaseCommand<
  typeof BaseCommandModule.UnregisterBotInput,
  undefined
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Unregister';
  description = 'Unregister the bot runner for this user';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { UnregisterBotInput } = commandModule;
    return UnregisterBotInput;
  }

  protected async run(
    input: BaseCommandModule.UnregisterBotInput,
  ): Promise<undefined> {
    await this.realmServer.unregisterBot(input.botRegistrationId);
  }
}
