import { service } from '@ember/service';

import {
  isCardInstance,
  isRealmIndexCardId,
  RealmPaths,
  resolveRRIReference,
  ri,
  rri,
  trimJsonExtension,
} from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';

import type NetworkService from '../services/network';
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
    let { virtualNetwork } = this.network;
    let cardId = rri(trimJsonExtension(input.cardId));
    let indexId = new RealmPaths(ri(realmURL)).fileRRI('index');
    let loader = this.loaderService.loader;
    // Unpinning never loads the card, so a card that fails to load can still
    // be unpinned.
    let [
      workspaceModule,
      { rawArrayValues },
      { isNonPresentLink },
      index,
      card,
    ] = await Promise.all([
      loader.import<typeof import('@cardstack/base/workspace')>(
        '@cardstack/base/workspace',
      ),
      loader.import<typeof import('@cardstack/base/watched-array')>(
        '@cardstack/base/watched-array',
      ),
      loader.import<typeof import('@cardstack/base/field-support')>(
        '@cardstack/base/field-support',
      ),
      this.store.get(indexId),
      input.pinned ? this.store.get(cardId) : undefined,
    ]);
    if (!(index instanceof workspaceModule.Workspace)) {
      throw new Error(
        `The index card of ${realmURL} isn't a Workspace card, so it has no pins.`,
      );
    }
    let cardToPin: CardDef | undefined;
    if (input.pinned) {
      if (!isCardInstance(card)) {
        throw new Error(`Card not found: ${input.cardId}`);
      }
      // Checked on the loaded card, since the realm's root URL also loads it.
      if (
        isRealmIndexCardId(rri(card.id as string), ri(realmURL), virtualNetwork)
      ) {
        throw new Error(`A workspace's index card can't be one of its pins.`);
      }
      cardToPin = card;
    }
    // A pin is a loaded card, or the link of one that is missing or not
    // loaded yet, written as a URL, a registered prefix, or relative to the
    // index card. Pins are compared by the URL they name.
    let urlOf = (reference: string) => {
      try {
        return trimJsonExtension(
          virtualNetwork.keyForIdentifier(
            resolveRRIReference(reference, rri(index.id as string)),
          ),
        );
      } catch {
        return undefined;
      }
    };
    let target = urlOf(cardId);
    let isPinned = (pin: unknown) => {
      let reference = isCardInstance(pin)
        ? (pin.id as string)
        : isNonPresentLink(pin)
          ? pin.reference
          : undefined;
      return (
        target !== undefined &&
        reference !== undefined &&
        urlOf(reference) === target
      );
    };
    // The raw backing array keeps the links of pins whose cards are missing or
    // not loaded yet, which reading the field directly would save as empty.
    let pins = rawArrayValues(index.entryPoints ?? []);
    let pinned = pins.some(isPinned);
    // A save that failed leaves its change on the card, so the card is saved
    // again even when it already says what was asked.
    let lastSaveFailed = Boolean(
      this.store.getSaveState(index.id as string)?.lastSaveError,
    );
    if (Boolean(input.pinned) === pinned && !lastSaveFailed) {
      return undefined;
    }
    if (cardToPin && !pinned) {
      index.entryPoints = [...pins, cardToPin];
    } else if (!input.pinned && pinned) {
      index.entryPoints = pins.filter((pin) => !isPinned(pin));
    }
    this.store.save(index.id as string);
    await this.store.flushSaves();
    let saveError = this.store.getSaveState(index.id as string)?.lastSaveError;
    if (saveError) {
      throw new Error(
        `The pins of ${realmURL} couldn't be saved: ${saveError.message}`,
      );
    }
    return undefined;
  }
}
