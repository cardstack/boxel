import { service } from '@ember/service';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type RealmServerService from '../services/realm-server';

export default class UnregisterBotTool extends HostBaseTool<
  typeof BaseToolModule.UnregisterBotInput,
  undefined
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Unregister';
  description = 'Unregister bot';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { UnregisterBotInput } = commandModule;
    return UnregisterBotInput;
  }

  protected async run(
    input: BaseToolModule.UnregisterBotInput,
  ): Promise<undefined> {
    await this.realmServer.unregisterBot(input.botRegistrationId);
  }
}
