import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';
import { unshareKey } from '../lib/key-shares';

import type RealmServerService from '../services/realm-server';
import type * as BaseToolModule from '@cardstack/base/command';

// Withdraws one of the user's own shares from its realm. Only a share's owner
// unshares it, whether or not they still write the realm; the key itself is
// kept, and stays shared everywhere else.
export default class UnshareKeyTool extends HostBaseTool<
  typeof BaseToolModule.KeyShareInput,
  undefined
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Unshare';

  // Deleting a share can't be undone: its label, and the cards that name it,
  // come back only if its owner shares the key again. So the tool always waits
  // for the user's click, even in a mode that runs other tools on its own.
  static neverAutoExecutes = true;

  description =
    "Withdraw one of the user's own shared API keys (shareId) from its workspace. The key is kept and stays shared everywhere else.";

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { KeyShareInput } = commandModule;
    return KeyShareInput;
  }

  requireInputFields = ['shareId'];

  protected async run(input: BaseToolModule.KeyShareInput): Promise<undefined> {
    await unshareKey(this.realmServer, input.shareId);
  }
}
