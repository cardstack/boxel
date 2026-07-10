import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import type RealmServerService from '../services/realm-server';
import type * as BaseToolModule from '@cardstack/base/command';

type RegisterBotResult = {
  botRegistrationId: string;
};

export default class RegisterBotTool extends HostBaseTool<
  typeof BaseToolModule.RegisterBotInput,
  typeof BaseToolModule.RegisterBotResult
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Register';
  description = 'Register bot';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { RegisterBotInput } = commandModule;
    return RegisterBotInput;
  }

  protected async run(
    input: BaseToolModule.RegisterBotInput,
  ): Promise<BaseToolModule.RegisterBotResult> {
    const commandModule = await this.loadToolModule();
    const { RegisterBotResult } = commandModule;

    let registration = (await this.realmServer.registerBot(
      input.username,
    )) as RegisterBotResult;

    return new RegisterBotResult({
      botRegistrationId: registration.botRegistrationId,
    });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { RegisterBotTool as RegisterBotCommand };
