import { service } from '@ember/service';

import { isCardInstance, rri } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';

import type RealmService from '../services/realm';
import type StoreService from '../services/store';
import type { CardDef } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';

// A workspace's pins are the `entryPoints` links of its Workspace card, the
// realm's index card. This adds a card to them, or removes it.
export default class SetWorkspacePinTool extends HostBaseTool<
  typeof BaseToolModule.SetWorkspacePinInput,
  undefined
> {
  @service declare private realm: RealmService;
  @service declare private store: StoreService;

  static actionVerb = 'Pin';

  description =
    "Pin a card to its workspace, or unpin it. Pinned cards show on the workspace's Home and on its desk in the dashboard. Only works in a workspace whose index card is a Workspace card.";

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.SetWorkspacePinInput;
  }

  requireInputFields = ['cardId'];

  protected async run(
    input: BaseToolModule.SetWorkspacePinInput,
  ): Promise<undefined> {
    let realmURL = this.realm.realmURLOf(input.cardId);
    if (!realmURL) {
      throw new Error(`No known workspace holds ${input.cardId}.`);
    }
    let indexId = `${realmURL}index`;
    let [workspaceModule, index, card] = await Promise.all([
      this.loaderService.loader.import<
        typeof import('@cardstack/base/workspace')
      >('@cardstack/base/workspace'),
      this.store.get(indexId),
      this.store.get(input.cardId),
    ]);
    if (!(index instanceof workspaceModule.Workspace)) {
      throw new Error(
        `The index card of ${realmURL} isn't a Workspace card, so it has no pins.`,
      );
    }
    if (!isCardInstance(card)) {
      throw new Error(`Card not found: ${input.cardId}`);
    }
    let pinnedId = rri(card.id as string);
    let pins = (index.entryPoints ?? []) as CardDef[];
    let isPinned = (pin: CardDef | undefined) =>
      typeof pin?.id === 'string' && rri(pin.id) === pinnedId;
    if (Boolean(input.pinned) === pins.some(isPinned)) {
      return undefined;
    }
    index.entryPoints = input.pinned
      ? [...pins, card]
      : pins.filter((pin) => !isPinned(pin));
    this.store.save(index.id as string);
    await this.store.flushSaves();
    return undefined;
  }
}
