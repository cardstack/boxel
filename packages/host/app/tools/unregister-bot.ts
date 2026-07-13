import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import type RealmServerService from '../services/realm-server';
import type * as BaseToolModule from '@cardstack/base/command';

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

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { UnregisterBotTool as UnregisterBotCommand };
