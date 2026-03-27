import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type RealmServerService from '../services/realm-server';

type RegisterBotResult = {
  botRegistrationId: string;
};

export default class RegisterBotCommand extends HostBaseCommand<
  typeof BaseCommandModule.RegisterBotInput,
  typeof BaseCommandModule.RegisterBotResult
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Register';
  description = 'Register bot';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { RegisterBotInput } = commandModule;
    return RegisterBotInput;
  }

  protected async run(
    input: BaseCommandModule.RegisterBotInput,
  ): Promise<BaseCommandModule.RegisterBotResult> {
    const commandModule = await this.loadCommandModule();
    const { RegisterBotResult } = commandModule;

    let registration = (await this.realmServer.registerBot(
      input.username,
    )) as RegisterBotResult;

    return new RegisterBotResult({
      botRegistrationId: registration.botRegistrationId,
    });
  }
}
