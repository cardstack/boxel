import { service } from '@ember/service';

import {
  isCardInstance,
  isRealmIndexCardId,
  RealmPaths,
  ri,
  rri,
} from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';

import type NetworkService from '../services/network';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';
import type * as BaseToolModule from '@cardstack/base/command';

// A workspace's pins are the `entryPoints` links of its Workspace card, the
// realm's index card. This adds a card to them, or removes it.
export default class SetWorkspacePinTool extends HostBaseTool<
  typeof BaseToolModule.SetWorkspacePinInput,
  undefined
> {
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;
  @service declare private store: StoreService;

  static actionVerb = 'Set';

  description =
    "Pin a card to its workspace, or unpin it. Pinned cards show on the workspace's Home and on its desk in the dashboard. Only works in a workspace whose index card is a Workspace card.";

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.SetWorkspacePinInput;
  }

  requireInputFields = ['cardId', 'pinned'];

  protected async run(
    input: BaseToolModule.SetWorkspacePinInput,
  ): Promise<undefined> {
    let realmURL = this.realm.realmURLOf(input.cardId);
    if (!realmURL) {
      throw new Error(`No known workspace holds ${input.cardId}.`);
    }
    if (!this.realm.canWrite(realmURL)) {
      throw new Error(`You can't change the pins of ${realmURL}.`);
    }
    let indexId = new RealmPaths(ri(realmURL)).fileRRI('index');
    let loader = this.loaderService.loader;
    let [workspaceModule, { rawArrayValues }, index, card] = await Promise.all([
      loader.import<typeof import('@cardstack/base/workspace')>(
        '@cardstack/base/workspace',
      ),
      loader.import<typeof import('@cardstack/base/watched-array')>(
        '@cardstack/base/watched-array',
      ),
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
    if (
      isRealmIndexCardId(pinnedId, ri(realmURL), this.network.virtualNetwork)
    ) {
      throw new Error(`A workspace's index card can't be one of its pins.`);
    }
    // The raw backing array keeps the links of pins whose cards are missing or
    // not loaded yet, which reading the field directly would save as empty.
    let pins = rawArrayValues(index.entryPoints ?? []);
    let isPinned = (pin: unknown) =>
      isCardInstance(pin) && rri(pin.id as string) === pinnedId;
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
