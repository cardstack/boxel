import { getOwner } from '@ember/application';
import type Owner from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import { scheduleOnce } from '@ember/runloop';
import Service, { service } from '@ember/service';

import { tracked, cached } from '@glimmer/tracking';

import { restartableTask, task } from 'ember-concurrency';
import { mergeWith } from 'lodash';
import stringify from 'safe-stable-stringify';
import { TrackedArray, TrackedMap, TrackedObject } from 'tracked-built-ins';

import {
  mergeRelationships,
  type PatchData,
  RealmPaths,
  type ResolvedCodeRef,
  type LocalPath,
} from '@cardstack/runtime-common';

import { Submode, Submodes } from '@cardstack/host/components/submode-switcher';
import { StackItem } from '@cardstack/host/lib/stack-item';

import { getCard } from '@cardstack/host/resources/card-resource';
import { file, isReady, FileResource } from '@cardstack/host/resources/file';
import { maybe } from '@cardstack/host/resources/maybe';
import type LoaderService from '@cardstack/host/services/loader-service';
import type MessageService from '@cardstack/host/services/message-service';
import type Realm from '@cardstack/host/services/realm';
import type RecentCardsService from '@cardstack/host/services/recent-cards-service';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import { Format } from 'https://cardstack.com/base/card-api';

import { type Stack } from '../components/operator-mode/interact-submode';

import { removeFileExtension } from '../components/search-sheet/utils';

import MatrixService from './matrix-service';
import NetworkService from './network';

import type CardService from './card-service';
import type ResetService from './reset';

import type IndexController from '../controllers';

// Below types form a raw POJO representation of operator mode state.
// This state differs from OperatorModeState in that it only contains cards that have been saved (i.e. have an ID).
// This is because we don't have a way to serialize a stack configuration of linked cards that have not been saved yet.

export interface OperatorModeState {
  stacks: Stack[];
  submode: Submode;
  codePath: URL | null;
  fileView?: FileView;
  openDirs: Map<string, string[]>;
  codeSelection?: string;
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
  codeSelection?: string;
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
  });
  @tracked private _aiAssistantOpen = false;
  private cachedRealmURL: URL | null = null;
  private openFileSubscribers: OpenFileSubscriber[] = [];

  @service declare private cardService: CardService;
  @service declare private loaderService: LoaderService;
  @service declare private messageService: MessageService;
  @service declare private realm: Realm;
  @service declare private recentCardsService: RecentCardsService;
  @service declare private recentFilesService: RecentFilesService;
  @service declare private router: RouterService;
  @service declare private reset: ResetService;
  @service declare private network: NetworkService;
  @service declare private matrixService: MatrixService;

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);
  }

  get aiAssistantOpen() {
    return this._aiAssistantOpen;
  }

  set aiAssistantOpen(value: boolean) {
    this._aiAssistantOpen = value;
  }

  toggleAiAssistant = () => {
    this.aiAssistantOpen = !this.aiAssistantOpen;
  };

  resetState() {
    this.state = new TrackedObject({
      stacks: new TrackedArray([]),
      submode: Submodes.Interact,
      codePath: null,
      openDirs: new TrackedMap<string, string[]>(),
    });
    this.cachedRealmURL = null;
    this.openFileSubscribers = [];
    this.schedulePersist();
  }

  async restore(rawState: SerializedState) {
    this.state = await this.deserialize(rawState);
  }

  addItemToStack(item: StackItem) {
    let stackIndex = item.stackIndex;
    if (!this.state.stacks[stackIndex]) {
      this.state.stacks[stackIndex] = new TrackedArray([]);
    }
    this.state.stacks[stackIndex].push(item);
    if (!item.cardError) {
      this.recentCardsService.add(item.card);
    }
    this.schedulePersist();
  }

  patchCard = task({ enqueue: true }, async (id: string, patch: PatchData) => {
    let card = await this.cardService.getCard(id);
    let document = await this.cardService.serializeCard(card);
    if (patch.attributes) {
      document.data.attributes = mergeWith(
        document.data.attributes,
        patch.attributes,
      );
    }
    if (patch.relationships) {
      let mergedRel = mergeRelationships(
        document.data.relationships,
        patch.relationships,
      );
      if (mergedRel && Object.keys(mergedRel).length !== 0) {
        document.data.relationships = mergedRel;
      }
    }
    await this.cardService.patchCard(card, document, patch);
    // TODO: if we introduce an identity map, we would not need this
    await this.reloadCardIfOpen(card.id);
  });

  async reloadCardIfOpen(id: string) {
    let stackItems = this.state?.stacks.flat() ?? [];
    for (let item of stackItems) {
      if ('card' in item && item.card.id == id) {
        this.cardService.reloadCard(item.card);
      }
    }
  }

  async deleteCard(cardId: string) {
    let cardRealmUrl = (await this.network.authedFetch(cardId)).headers.get(
      'X-Boxel-Realm-Url',
    );
    if (!cardRealmUrl) {
      throw new Error(`Could not determine the realm for card "${cardId}"`);
    }

    await this.cardService.deleteCard(cardId);

    // remove all stack items for the deleted card
    let items: StackItem[] = [];
    for (let stack of this.state.stacks || []) {
      items.push(
        ...(stack.filter(
          (i) => i.url?.href && removeFileExtension(i.url.href) === cardId,
        ) as StackItem[]),
      );
    }
    for (let item of items) {
      this.trimItemsFromStack(item);
    }
    let realmPaths = new RealmPaths(new URL(cardRealmUrl));
    let cardPath = realmPaths.local(new URL(`${cardId}.json`));
    this.recentFilesService.removeRecentFile(cardPath);
    this.recentCardsService.remove(cardId);
  }

  trimItemsFromStack(item: StackItem) {
    let stackIndex = item.stackIndex;
    let itemIndex = this.state.stacks[stackIndex].indexOf(item);
    this.state.stacks[stackIndex].splice(itemIndex); // Remove anything above the item

    // If the resulting stack is now empty, remove it
    if (this.stackIsEmpty(stackIndex) && this.state.stacks.length >= 1) {
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

    if (this.state.stacks.length === 0) {
      this.operatorModeController.workspaceChooserOpened = true;
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
    return this.state.stacks
      .filter((stack) => stack.length > 0)
      .map((stack) => stack[stack.length - 1]);
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

    if (submode === Submodes.Code) {
      this.matrixService.setLLMForCodeMode();
    }
  }

  updateCodePathWithCodeSelection(
    codeRef: ResolvedCodeRef | undefined,
    localName: string | undefined,
    onLocalSelection?: (name: string) => void,
  ) {
    //moving from one definition to another
    if (codeRef) {
      //(possibly) in a different module
      this.state.codeSelection = codeRef.name;
      this.updateCodePath(new URL(codeRef.module));
    } else if (localName && onLocalSelection) {
      //in the same module
      this.state.codeSelection = localName;
      this.schedulePersist();
      onLocalSelection(localName);
    }
  }

  get codePathRelativeToRealm() {
    if (this.state.codePath && this.realmURL) {
      let realmPath = new RealmPaths(this.realmURL);

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

  get codePathString() {
    return this.state.codePath?.toString();
  }

  onFileSelected = (entryPath: LocalPath) => {
    let fileUrl = new RealmPaths(this.realmURL).fileURL(entryPath);
    this.updateCodePath(fileUrl);
  };

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
    this.router.replaceWith('index', {
      queryParams: {
        operatorModeState: this.serialize(),
      },
    });
  }

  @cached
  get title() {
    if (this.state.submode === Submodes.Code) {
      return `${this.codePathRelativeToRealm} in ${
        this.realm.info(this.realmURL.href).name
      }`;
    } else {
      let itemForTitle = this.topMostStackItems().pop(); // top-most card of right stack
      return itemForTitle?.title ?? 'Boxel';
    }
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
    this.operatorModeController.operatorModeState = this.serialize();
    // This sets the title of the document for it's appearance in the browser
    // history (which needs to happen after the history pushState)--the
    // afterRender is the perfect place for this
    document.title = this.title;
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

  async createStackItem(
    url: URL,
    stackIndex: number,
    format: 'isolated' | 'edit' = 'isolated',
  ) {
    let stackItem = new StackItem({
      url,
      stackIndex,
      owner: this,
      format,
    });
    await stackItem.ready();
    return stackItem;
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
      codeSelection: rawState.codeSelection,
    });

    let stackIndex = 0;
    for (let stack of rawState.stacks) {
      let newStack: Stack = new TrackedArray([]);
      for (let item of stack) {
        let { format } = item;
        let cardResource = getCard(this, () => item.id, {
          isAutoSave: () => true,
        });
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

  get openDirs() {
    return this.state.openDirs ?? new TrackedMap();
  }

  toggleOpenDir = (entryPath: string): void => {
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
  };

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
    // i think we only want to use this logic in code mode (?)
    if (isReady(this.openFile.current)) {
      return new URL(this.readyFile.realmURL);
    } else if (this.cachedRealmURL) {
      return this.cachedRealmURL;
    }

    // For interact mode, the idea of "current realm" is a bit abstract. the
    // realm background that you see in interact mode is the realm of the
    // bottom-most card in the stack. however you can have cards of differing
    // realms in the same stack and keep in mind you can have multiple stacks...
    return new URL(this.realm.defaultReadableRealm.path);
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

  async openCardInInteractMode(url: URL, format: Format = 'isolated') {
    this.clearStacks();
    let newItem = new StackItem({
      url,
      stackIndex: 0,
      owner: this, // We need to think for better owner
      format,
    });
    await newItem.ready();
    this.addItemToStack(newItem);
    this.updateSubmode(Submodes.Interact);
  }

  openWorkspace = restartableTask(async (realmUrl: string) => {
    let url = new URL(`${realmUrl}index`);
    let stackItem = new StackItem({
      owner: this,
      url,
      format: 'isolated',
      stackIndex: 0,
    });
    await stackItem.ready();
    this.clearStacks();
    this.addItemToStack(stackItem);

    let lastOpenedFile = this.recentFilesService.recentFiles.find(
      (file) => file.realmURL.href === realmUrl,
    );
    this.updateCodePath(
      lastOpenedFile
        ? new URL(`${lastOpenedFile.realmURL}${lastOpenedFile.filePath}`)
        : url,
    );

    this.operatorModeController.workspaceChooserOpened = false;
  });

  get workspaceChooserOpened() {
    return this.operatorModeController.workspaceChooserOpened;
  }

  set workspaceChooserOpened(workspaceChooserOpened: boolean) {
    this.operatorModeController.workspaceChooserOpened = workspaceChooserOpened;
  }

  // Operator mode state is persisted in a query param, which lives in the index controller
  get operatorModeController(): IndexController {
    let controller = getOwner(this)!.lookup(
      'controller:index',
    ) as IndexController;

    return controller;
  }
}
