import { getOwner } from '@ember/application';
import type RouterService from '@ember/routing/router-service';
import { scheduleOnce } from '@ember/runloop';
import Service, { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import window from 'ember-window-mock';
import stringify from 'safe-stable-stringify';
import { TrackedArray, TrackedMap, TrackedObject } from 'tracked-built-ins';

import { type ResolvedCodeRef } from '@cardstack/runtime-common/code-ref';
import { RealmPaths } from '@cardstack/runtime-common/paths';

import { Submode, Submodes } from '@cardstack/host/components/submode-switcher';
import { StackItem } from '@cardstack/host/lib/stack-item';

import { getCard } from '@cardstack/host/resources/card-resource';
import { file, isReady, FileResource } from '@cardstack/host/resources/file';
import { maybe } from '@cardstack/host/resources/maybe';
import type LoaderService from '@cardstack/host/services/loader-service';
import type MessageService from '@cardstack/host/services/message-service';
import type RealmInfoService from '@cardstack/host/services/realm-info-service';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { type Stack } from '../components/operator-mode/interact-submode';

import type CardService from '../services/card-service';

// Below types form a raw POJO representation of operator mode state.
// This state differs from OperatorModeState in that it only contains cards that have been saved (i.e. have an ID).
// This is because we don't have a way to serialize a stack configuration of linked cards that have not been saved yet.

export interface OperatorModeState {
  stacks: Stack[];
  submode: Submode;
  codePath: URL | null;
  fileView?: FileView;
  openDirs: Map<string, string[]>;
  codeSelection: CodeSelection;
}

interface CodeSelection {
  codeRef?: ResolvedCodeRef;
  localName?: string;
}

interface CardItem {
  id: string;
  format: 'isolated' | 'edit';
}

export type FileView = 'inspector' | 'browser';

type SerializedItem = CardItem;
type SerializedStack = SerializedItem[];

export type SerializedState = {
  stacks: SerializedStack[];
  submode?: Submode;
  codePath?: string;
  fileView?: FileView;
  openDirs?: Record<string, string[]>;
  codeSelection?: CodeSelection;
};

interface OpenFileSubscriber {
  onStateChange: (state: FileResource['state']) => void;
}

export default class OperatorModeStateService extends Service {
  @tracked state: OperatorModeState = new TrackedObject({
    stacks: new TrackedArray([]),
    submode: Submodes.Interact,
    codePath: null,
    openDirs: new TrackedMap<string, string[]>(),
    codeSelection: new TrackedObject({}),
  });
  @tracked recentCards = new TrackedArray<CardDef>([]);

  private cachedRealmURL: URL | null = null;

  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;
  @service declare messageService: MessageService;
  @service declare recentFilesService: RecentFilesService;
  @service declare realmInfoService: RealmInfoService;
  @service declare router: RouterService;

  private openFileSubscribers: OpenFileSubscriber[] = [];

  async restore(rawState: SerializedState) {
    this.state = await this.deserialize(rawState);
  }

  addItemToStack(item: StackItem) {
    let stackIndex = item.stackIndex;
    if (!this.state.stacks[stackIndex]) {
      this.state.stacks[stackIndex] = new TrackedArray([]);
    }
    this.state.stacks[stackIndex].push(item);
    this.addRecentCard(item.card);
    this.schedulePersist();
  }

  patchCard = task({ enqueue: true }, async (id: string, attributes: any) => {
    let stackItems = this.state?.stacks.flat() ?? [];
    for (let item of stackItems) {
      if ('card' in item && item.card.id == id) {
        let document = await this.cardService.serializeCard(item.card);
        document.data.attributes = {
          ...document.data.attributes,
          ...attributes,
        };

        await this.cardService.patchCard(item.card, document);
      }
    }
  });

  async deleteCard(card: CardDef) {
    // remove all stack items for the deleted card
    let items: StackItem[] = [];
    for (let stack of this.state.stacks || []) {
      items.push(
        ...(stack.filter((i) => i.card.id === card.id) as StackItem[]),
      );
    }
    for (let item of items) {
      this.trimItemsFromStack(item);
    }
    this.removeRecentCard(card.id);

    let cardRealmUrl = await this.cardService.getRealmURL(card);

    if (cardRealmUrl) {
      let realmPaths = new RealmPaths(cardRealmUrl);
      let cardPath = realmPaths.local(`${card.id}.json`);
      this.recentFilesService.removeRecentFile(cardPath);
    }
    await this.cardService.deleteCard(card);
  }

  trimItemsFromStack(item: StackItem) {
    let stackIndex = item.stackIndex;
    let itemIndex = this.state.stacks[stackIndex].indexOf(item);
    this.state.stacks[stackIndex].splice(itemIndex); // Remove anything above the item

    // If the resulting stack is now empty, remove it
    if (this.stackIsEmpty(stackIndex) && this.state.stacks.length > 1) {
      this.state.stacks.splice(stackIndex, 1);

      // If we just removed the last item in the stack, and we also removed the stack because of that, we need
      // to update the stackIndex of all items in the stacks that come after the removed stack.
      // This is another code smell that the stackIndex should perhaps not not live in the item. For now, we keep it for convenience.
      this.state.stacks
        .filter((_, stackIndex) => stackIndex >= item.stackIndex)
        .forEach((stack, realStackIndex) => {
          stack.forEach((stackItem) => {
            if (stackItem.stackIndex !== realStackIndex) {
              stackItem.stackIndex = realStackIndex;
            }
          });
        });
    }

    this.schedulePersist();
  }

  popItemFromStack(stackIndex: number) {
    let stack = this.state.stacks[stackIndex];
    if (!stack) {
      throw new Error(`No stack at index ${stackIndex}`);
    }
    let item = stack.pop();
    if (!item) {
      throw new Error(`No items in stack at index ${stackIndex}`);
    }
    this.schedulePersist();
    return item;
  }

  replaceItemInStack(item: StackItem, newItem: StackItem) {
    let stackIndex = item.stackIndex;
    let itemIndex = this.state.stacks[stackIndex].indexOf(item);

    if (newItem.stackIndex !== stackIndex) {
      // this could be a smell that the stack index should not live in the item
      throw new Error(
        'cannot move stack item to different stack--this can destabilize contained card pointers',
      );
    }

    this.state.stacks[stackIndex].splice(itemIndex, 1, newItem);
    this.schedulePersist();
  }

  clearStackAndAdd(stackIndex: number, newItem: StackItem) {
    let itemsToPopCount = this.state.stacks[stackIndex].length;

    for (let i = 0; i < itemsToPopCount; i++) {
      this.popItemFromStack(stackIndex);
    }

    this.addItemToStack(newItem);
  }

  numberOfStacks() {
    return this.state.stacks.length;
  }

  rightMostStack() {
    if (this.numberOfStacks() > 0) {
      return this.state.stacks[this.state.stacks.length - 1];
    }
    return;
  }

  topMostStackItems() {
    return this.state.stacks.map((stack) => stack[stack.length - 1]);
  }

  stackIsEmpty(stackIndex: number) {
    return this.state.stacks[stackIndex].length === 0;
  }

  shiftStack(stack: StackItem[], destinationIndex: number) {
    let stackItemsCopy = [...stack]; // The actions in the loop are mutating the stack items, so we need to make a copy to make sure to iterate over all items from the original stack

    stackItemsCopy.forEach((item) => {
      this.popItemFromStack(item.stackIndex);
      this.addItemToStack(
        item.clone({
          stackIndex: destinationIndex,
        }),
      );
    });

    return this.schedulePersist();
  }

  updateSubmode(submode: Submode) {
    this.state.submode = submode;
    this.schedulePersist();
  }

  updateCodeRefSelection(codeRef: ResolvedCodeRef) {
    this.state.codeSelection = {
      codeRef,
    };
    this.schedulePersist();
  }

  updateLocalNameSelection(localName: string | undefined) {
    this.state.codeSelection = { localName }; //we need to update localName independently because card and field don't have code ref
    this.schedulePersist();
  }

  get codePathRelativeToRealm() {
    if (this.state.codePath && this.resolvedRealmURL) {
      let realmPath = new RealmPaths(this.resolvedRealmURL);

      if (realmPath.inRealm(this.state.codePath)) {
        try {
          return realmPath.local(this.state.codePath!);
        } catch (err: any) {
          if (err.status === 404) {
            return undefined;
          }
          throw err;
        }
      }
    }

    return undefined;
  }

  updateCodePath(codePath: URL | null) {
    this.state.codePath = codePath;
    this.updateOpenDirsForNestedPath();
    this.schedulePersist();
  }

  replaceCodePath(codePath: URL | null) {
    // replace history explicitly
    // typically used when, serving a redirect in the code path
    // solve UX issues with back button referring back to request url of redirect
    // when it should refer back to the previous code path
    this.state.codePath = codePath;
    this.router.replaceWith('card', {
      queryParams: {
        operatorModeState: this.serialize(),
      },
    });
  }

  private updateOpenDirsForNestedPath() {
    let localPath = this.codePathRelativeToRealm;

    if (localPath) {
      let containingDirectory = localPath.split('/').slice(0, -1).join('/');

      if (containingDirectory) {
        containingDirectory += '/';

        if (!this.currentRealmOpenDirs.includes(containingDirectory)) {
          this.toggleOpenDir(containingDirectory);
        }
      }
    }
  }

  get currentRealmOpenDirs() {
    if (this.realmURL) {
      let currentRealmOpenDirs = this.openDirs.get(this.realmURL.href);

      if (currentRealmOpenDirs) {
        return currentRealmOpenDirs;
      }
    }

    return new TrackedArray([]);
  }

  updateFileView(fileView: FileView) {
    this.state.fileView = fileView;
    this.schedulePersist();
  }

  clearStacks() {
    this.state.stacks.splice(0);
    this.schedulePersist();
  }

  private schedulePersist() {
    // When multiple stack manipulations are bunched together in a loop, for example when closing multiple cards in a loop,
    // we get into a async race condition where the change to cardController.operatorModeState will reload the route and
    // restore the state from the query param in a way that is out of sync with the state in the service. To avoid this,
    // we do the change to the query param only after all modifications to the state have been rendered.
    scheduleOnce('afterRender', this, this.persist);
  }

  private persist() {
    let cardController = getOwner(this)!.lookup('controller:card') as any;
    if (!cardController) {
      throw new Error(
        'OperatorModeStateService must be used in the context of a CardController',
      );
    }

    // Setting this property will trigger a query param update on the controller, which will reload the route
    cardController.operatorModeState = this.serialize();
  }

  // Serialized POJO version of state, with only cards that have been saved.
  // The state can have cards that have not been saved yet, for example when
  // clicking on "Crate New" in linked card editor. Here we want to draw a boundary
  // between navigatable states in the query parameter
  rawStateWithSavedCardsOnly() {
    let state: SerializedState = {
      stacks: [],
      submode: this.state.submode,
      codePath: this.state.codePath?.toString(),
      fileView: this.state.fileView?.toString() as FileView,
      openDirs: Object.fromEntries(this.state.openDirs.entries()),
      codeSelection: this.state.codeSelection,
    };

    for (let stack of this.state.stacks) {
      let serializedStack: SerializedStack = [];
      for (let item of stack) {
        if (item.format !== 'isolated' && item.format !== 'edit') {
          throw new Error(`Unknown format for card on stack ${item.format}`);
        }
        if (item.url) {
          serializedStack.push({
            id: item.url.href,
            format: item.format,
          });
        }
      }
      state.stacks.push(serializedStack);
    }

    return state;
  }

  // Stringified JSON version of state, with only cards that have been saved, used for the query param
  serialize(): string {
    return stringify(this.rawStateWithSavedCardsOnly())!;
  }

  // Deserialize a stringified JSON version of OperatorModeState into a Glimmer tracked object
  // so that templates can react to changes in stacks and their items
  async deserialize(rawState: SerializedState): Promise<OperatorModeState> {
    let openDirs = new TrackedMap<string, string[]>(
      Object.entries(rawState.openDirs ?? {}).map(([realmURL, dirs]) => [
        realmURL,
        new TrackedArray(dirs),
      ]),
    );

    let newState: OperatorModeState = new TrackedObject({
      stacks: new TrackedArray([]),
      submode: rawState.submode ?? Submodes.Interact,
      codePath: rawState.codePath ? new URL(rawState.codePath) : null,
      fileView: rawState.fileView ?? 'inspector',
      openDirs,
      codeSelection: rawState.codeSelection ?? {},
    });

    let stackIndex = 0;
    for (let stack of rawState.stacks) {
      let newStack: Stack = new TrackedArray([]);
      for (let item of stack) {
        let { format } = item;
        let cardResource = getCard(this, () => item.id);
        let stackItem = new StackItem({
          owner: this, // ugh, not a great owner...
          cardResource,
          format,
          stackIndex,
        });
        await stackItem.ready();
        newStack.push(stackItem);
      }
      newState.stacks.push(newStack);
      stackIndex++;
    }

    return newState;
  }

  async constructRecentCards() {
    const recentCardIdsString = window.localStorage.getItem('recent-cards');
    if (!recentCardIdsString) {
      return;
    }

    const recentCardIds = JSON.parse(recentCardIdsString) as string[];
    for (const recentCardId of recentCardIds) {
      const cardResource = getCard(this, () => recentCardId);
      await cardResource.loaded;
      let { card } = cardResource;
      if (!card) {
        console.warn(`cannot load card ${recentCardId}`);
        continue;
      }
      this.recentCards.push(card);
    }
  }

  addRecentCard(card: CardDef) {
    const existingCardIndex = this.recentCards.findIndex(
      (recentCard) => recentCard.id === card.id,
    );
    if (existingCardIndex !== -1) {
      this.recentCards.splice(existingCardIndex, 1);
    }

    this.recentCards.push(card);
    if (this.recentCards.length > 10) {
      this.recentCards.splice(0, 1);
    }
    const recentCardIds = this.recentCards
      .map((recentCard) => recentCard.id)
      .filter(Boolean); // don't include cards that don't have an ID
    window.localStorage.setItem('recent-cards', JSON.stringify(recentCardIds));
  }

  removeRecentCard(id: string) {
    let index = this.recentCards.findIndex((c) => c.id === id);
    if (index === -1) {
      return;
    }
    while (index !== -1) {
      this.recentCards.splice(index, 1);
      index = this.recentCards.findIndex((c) => c.id === id);
    }
    window.localStorage.setItem(
      'recent-cards',
      JSON.stringify(this.recentCards.map((c) => c.id)),
    );
  }

  get openDirs() {
    return this.state.openDirs ?? new TrackedMap();
  }

  toggleOpenDir(entryPath: string): void {
    if (!this.realmURL) {
      return;
    }

    let dirs = this.currentRealmOpenDirs.slice();
    for (let i = 0; i < dirs.length; i++) {
      if (dirs[i].startsWith(entryPath)) {
        let localParts = entryPath.split('/').filter((p) => p.trim() != '');
        localParts.pop();
        if (localParts.length) {
          dirs[i] = localParts.join('/') + '/';
        } else {
          dirs.splice(i, 1);
        }
        this.openDirs.set(this.realmURL.href, new TrackedArray(dirs));
        return;
      } else if (entryPath.startsWith(dirs[i])) {
        dirs[i] = entryPath;
        this.openDirs.set(this.realmURL.href, new TrackedArray(dirs));
        return;
      }
    }
    this.openDirs.set(
      this.realmURL.href,
      new TrackedArray([...dirs, entryPath]),
    );
    this.schedulePersist();
  }

  private get readyFile() {
    if (isReady(this.openFile.current)) {
      return this.openFile.current;
    }
    throw new Error(
      `cannot access file contents ${this.state.codePath} before file is open`,
    );
  }

  get openFileIsReady() {
    return isReady(this.openFile.current);
  }

  get realmURL() {
    if (isReady(this.openFile.current)) {
      return new URL(this.readyFile.realmURL);
    } else if (this.cachedRealmURL) {
      return this.cachedRealmURL;
    }

    return this.cardService.defaultURL;
  }

  get resolvedRealmURL() {
    return this.loaderService.loader.resolve(this.realmURL);
  }

  subscribeToOpenFileStateChanges(subscriber: OpenFileSubscriber) {
    this.openFileSubscribers.push(subscriber);
  }

  unsubscribeFromOpenFileStateChanges(subscriber: OpenFileSubscriber) {
    let subscriberIndex = this.openFileSubscribers.indexOf(subscriber);

    if (subscriberIndex > -1) {
      this.openFileSubscribers.splice(subscriberIndex, 1);
    }
  }

  openFile = maybe(this, (context) => {
    let codePath = this.state.codePath;

    if (!codePath) {
      return undefined;
    }

    return file(context, () => ({
      url: codePath!.href,
      onStateChange: (state) => {
        if (state === 'ready') {
          this.cachedRealmURL = new URL(this.readyFile.realmURL);
          this.updateOpenDirsForNestedPath();
        }

        this.openFileSubscribers.forEach((subscriber) =>
          subscriber.onStateChange(state),
        );
      },
      onRedirect: (url: string) => {
        if (!url) {
          return;
        }
        this.replaceCodePath(new URL(url));
      },
    }));
  });
}
