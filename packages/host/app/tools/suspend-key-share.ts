import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';
import { suspendKeyShare } from '../lib/key-shares';

import type RealmServerService from '../services/realm-server';
import type * as BaseToolModule from '@cardstack/base/command';

// Suspends one of a realm's active shares, so nothing in the realm uses its
// key until a direct writer resumes it or swaps a key in. Any direct writer of
// the realm may, for any reason; it takes no key write ticket, since it only
// stops a key being used.
export default class SuspendKeyShareTool extends HostBaseTool<
  typeof BaseToolModule.KeyShareInput,
  undefined
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Suspend';

  // Only a direct writer swapping a key in brings the share back, and the
  // cards that use it stop working until then, so the tool always waits for
  // the user's click, even in a mode that runs other tools on its own.
  static neverAutoExecutes = true;

  description =
    "Suspend one of a workspace's shared API keys (shareId), so cards there stop using it. Only the workspace's direct writers may.";

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { KeyShareInput } = commandModule;
    return KeyShareInput;
  }

  requireInputFields = ['shareId'];

  protected async run(input: BaseToolModule.KeyShareInput): Promise<undefined> {
    await suspendKeyShare(this.realmServer, input.shareId);
  }
}
