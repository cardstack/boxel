import { service } from '@ember/service';

import {
  isCardInstance,
  isRealmIndexCardId,
  RealmPaths,
  resolveRRIReference,
  ri,
  rri,
  trimJsonExtension,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';

import type NetworkService from '../services/network';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';
import type { CardDef } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';

// A workspace's pins are the `entryPoints` links of its Workspace card, the
// realm's index card. This adds cards to them, or removes them, in one save.
export default class SetWorkspacePinTool extends HostBaseTool<
  typeof BaseToolModule.SetWorkspacePinInput,
  typeof BaseToolModule.SetWorkspacePinResult | undefined
> {
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;
  @service declare private store: StoreService;

  static actionVerb = 'Set';

  description =
    "Pin cards to their workspace, or unpin them: one card in cardId, or several in cardIds, all in the same workspace. Pins are added in the order given. Pinned cards show on the workspace's Home and on its desk in the dashboard. Only works in a workspace whose index card is a Workspace card. A card that can't be pinned, because it isn't found or is the workspace's index card, is left out; the others are still pinned, and the result's leftOut names the cards left out.";

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.SetWorkspacePinInput;
  }

  requireInputFields = ['pinned'];

  protected async run(
    input: BaseToolModule.SetWorkspacePinInput,
  ): Promise<BaseToolModule.SetWorkspacePinResult | undefined> {
    // A card named twice is loaded, checked and reported once.
    let inputIds = [
      ...(input.cardId ? [input.cardId] : []),
      ...(input.cardIds ?? []),
    ].filter(
      (id, i, ids) =>
        ids.findIndex(
          (other) => trimJsonExtension(other) === trimJsonExtension(id),
        ) === i,
    );
    if (inputIds.length === 0) {
      throw new Error('Name the cards to pin or unpin in cardId or cardIds.');
    }
    let [realmURL, ...otherRealmURLs] = inputIds.map((id) => {
      let realmOfId = this.realm.realmURLOf(id);
      if (!realmOfId) {
        throw new Error(`No known workspace holds ${id}.`);
      }
      return realmOfId;
    });
    let elsewhere = otherRealmURLs.findIndex((url) => url !== realmURL);
    if (elsewhere !== -1) {
      throw new Error(
        `${inputIds[elsewhere + 1]} and ${inputIds[0]} are in different workspaces. Pin or unpin each workspace's cards in a call of its own.`,
      );
    }
    if (!this.realm.canWrite(realmURL)) {
      throw new Error(`You can't change the pins of ${realmURL}.`);
    }
    let { virtualNetwork } = this.network;
    let cardIds = inputIds.map((id) => rri(trimJsonExtension(id)));
    let indexId = new RealmPaths(ri(realmURL)).fileRRI('index');
    let loader = this.loaderService.loader;
    // Unpinning never loads the cards, so a card that fails to load can still
    // be unpinned.
    let [
      { SetWorkspacePinResult },
      workspaceModule,
      { rawArrayValues },
      { isNonPresentLink },
      index,
      cards,
    ] = await Promise.all([
      this.loadToolModule(),
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
      input.pinned
        ? Promise.all(cardIds.map((cardId) => this.store.get(cardId)))
        : [],
    ]);
    if (!(index instanceof workspaceModule.Workspace)) {
      throw new Error(
        `The index card of ${realmURL} isn't a Workspace card, so it has no pins.`,
      );
    }
    // A card that fails to load, or is the workspace's index card, isn't
    // pinned. The others still are, and the result names the cards left out.
    let cardsToPin: { id: RealmResourceIdentifier; card: CardDef }[] = [];
    let notFound: string[] = [];
    let indexCards: string[] = [];
    for (let [i, card] of cards.entries()) {
      if (!isCardInstance(card)) {
        notFound.push(inputIds[i]);
        continue;
      }
      // Checked on the loaded card, since the realm's root URL also loads it.
      if (
        isRealmIndexCardId(rri(card.id as string), ri(realmURL), virtualNetwork)
      ) {
        indexCards.push(inputIds[i]);
        continue;
      }
      cardsToPin.push({ id: cardIds[i], card });
    }
    let leftOut = [
      ...(notFound.length > 0
        ? [`Card not found: ${notFound.join(', ')}.`]
        : []),
      ...(indexCards.length > 0
        ? [
            `A workspace's index card can't be one of its pins: ${indexCards.join(', ')}.`,
          ]
        : []),
    ].join(' ');
    if (leftOut && cardsToPin.length === 0) {
      throw new Error(leftOut);
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
    let pinURLOf = (pin: unknown) => {
      let reference = isCardInstance(pin)
        ? (pin.id as string)
        : isNonPresentLink(pin)
          ? pin.reference
          : undefined;
      return reference === undefined ? undefined : urlOf(reference);
    };
    // The raw backing array keeps the links of pins whose cards are missing or
    // not loaded yet, which reading the field directly would save as empty.
    let pins = rawArrayValues(index.entryPoints ?? []);
    let pinnedURLs = new Set(pins.map(pinURLOf));
    let newPins: CardDef[] = [];
    let remainingPins = pins;
    if (input.pinned) {
      // A card already pinned, or named twice, is pinned once. One whose URL
      // can't be worked out is told apart by its id.
      for (let { id, card } of cardsToPin) {
        let key = urlOf(id) ?? card.id;
        if (key !== undefined && pinnedURLs.has(key)) {
          continue;
        }
        pinnedURLs.add(key);
        newPins.push(card);
      }
    } else {
      let targets = new Set(cardIds.map(urlOf));
      targets.delete(undefined);
      remainingPins = pins.filter((pin) => !targets.has(pinURLOf(pin)));
    }
    let changed = newPins.length > 0 || remainingPins.length < pins.length;
    // A save that failed leaves its change on the card, so the card is saved
    // again even when it already says what was asked.
    let lastSaveFailed = Boolean(
      this.store.getSaveState(index.id as string)?.lastSaveError,
    );
    if (changed || lastSaveFailed) {
      if (changed) {
        index.entryPoints = [...remainingPins, ...newPins];
      }
      this.store.save(index.id as string);
      await this.store.flushSaves();
      let saveError = this.store.getSaveState(
        index.id as string,
      )?.lastSaveError;
      if (saveError) {
        throw new Error(
          [
            `The pins of ${realmURL} couldn't be saved: ${saveError.message}`,
            leftOut,
          ]
            .filter(Boolean)
            .join(' '),
        );
      }
    }
    if (leftOut) {
      return new SetWorkspacePinResult({
        leftOut: `${leftOut} The other cards are pinned.`,
      });
    }
    return undefined;
  }
}
