import { getOwner } from '@ember/application';
import type Owner from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import { scheduleOnce } from '@ember/runloop';
import Service, { service } from '@ember/service';

import { tracked, cached } from '@glimmer/tracking';

import { task, restartableTask } from 'ember-concurrency';
import window from 'ember-window-mock';
import stringify from 'safe-stable-stringify';
import { TrackedArray, TrackedMap, TrackedObject } from 'tracked-built-ins';

import {
  RealmPaths,
  type LocalPath,
  CodeRef,
  isResolvedCodeRef,
  isCardInstance,
  type ResolvedCodeRef,
  internalKeyFor,
  isLocalId,
  SupportedMimeType,
} from '@cardstack/runtime-common';

import { Submode, Submodes } from '@cardstack/host/components/submode-switcher';
import { StackItem } from '@cardstack/host/lib/stack-item';

import {
  file,
  isReady,
  type FileResource,
} from '@cardstack/host/resources/file';
import { maybe } from '@cardstack/host/resources/maybe';
import type LoaderService from '@cardstack/host/services/loader-service';
import type MessageService from '@cardstack/host/services/message-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import { PlaygroundSelection } from '@cardstack/host/services/playground-panel-service';
import type Realm from '@cardstack/host/services/realm';
import type RecentCardsService from '@cardstack/host/services/recent-cards-service';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import { Format } from 'https://cardstack.com/base/card-api';

import { BoxelContext } from 'https://cardstack.com/base/matrix-event';

import { type Stack } from '../components/operator-mode/interact-submode';

import { removeFileExtension } from '../components/search-sheet/utils';

import {
  ModuleInspectorSelections,
  PlaygroundSelections,
} from '../utils/local-storage-keys';

import MatrixService from './matrix-service';
import NetworkService from './network';

import type CardService from './card-service';
import type { RecentFile } from './recent-files-service';
import type ResetService from './reset';
import type SpecPanelService from './spec-panel-service';
import type StoreService from './store';

import type IndexController from '../controllers';

// Below types form a raw POJO representation of operator mode state.
// This state differs from OperatorModeState in that it only contains cards that have been saved (i.e. have an ID).
// This is because we don't have a way to serialize a stack configuration of linked cards that have not been saved yet.

export interface OperatorModeState {
  stacks: Stack[];
  submode: Submode;
  codePath: URL | null;
  aiAssistantOpen: boolean;
  fileView?: FileView;
  openDirs: Map<string, string[]>;
  codeSelection?: string;
  fieldSelection?: string;
  moduleInspector?: ModuleInspectorView;
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
  fieldSelection?: string;
  aiAssistantOpen?: boolean;
  moduleInspector?: ModuleInspectorView;
};

interface OpenFileSubscriber {
  onStateChange: (state: FileResource['state']) => void;
}

export type ModuleInspectorView = 'schema' | 'spec' | 'preview';

export default class OperatorModeStateService extends Service {
  @tracked private _state: OperatorModeState = new TrackedObject({
    stacks: new TrackedArray<Stack>([]),
    submode: Submodes.Interact,
    codePath: null,
    openDirs: new TrackedMap<string, string[]>(),
    aiAssistantOpen: false,
  });
  private cachedRealmURL: URL | null = null;
  private openFileSubscribers: OpenFileSubscriber[] = [];
  private cardTitles = new TrackedMap<string, string>();

  private panelSelections: Record<string, ModuleInspectorView>;

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
  @service declare private store: StoreService;
  @service declare private playgroundPanelService: PlaygroundPanelService;
  @service declare private specPanelService: SpecPanelService;

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);

    let panelSelections = window.localStorage.getItem(
      ModuleInspectorSelections,
    );
    this.panelSelections = new TrackedObject(
      panelSelections ? JSON.parse(panelSelections) : {},
    );
  }

  get state() {
    return {
      stacks: this._state.stacks,
      submode: this._state.submode,
      codePath: this._state.codePath,
      fileView: this._state.fileView,
      openDirs: this._state.openDirs,
      codeSelection: this._state.codeSelection,
      fieldSelection: this._state.fieldSelection,
      aiAssistantOpen: this._state.aiAssistantOpen,
      moduleInspector: this._state.moduleInspector,
    } as const;
  }

  get aiAssistantOpen() {
    return this._state.aiAssistantOpen;
  }

  openAiAssistant = () => {
    this._state.aiAssistantOpen = true;
    this.schedulePersist();
  };

  closeAiAssistant = () => {
    this._state.aiAssistantOpen = false;
    this.schedulePersist();
  };

  resetState() {
    this._state = new TrackedObject({
      stacks: new TrackedArray([]),
      submode: Submodes.Interact,
      codePath: null,
      openDirs: new TrackedMap<string, string[]>(),
      aiAssistantOpen: false,
      moduleInspector: 'schema' as ModuleInspectorView, // FIXME duplicate?
    });
    this.cachedRealmURL = null;
    this.openFileSubscribers = [];
    this.schedulePersist();
  }

  restore(rawState: SerializedState) {
    this._state = this.deserialize(rawState);
  }

  addItemToStack(item: StackItem) {
    let stackIndex = item.stackIndex;
    if (!this._state.stacks[stackIndex]) {
      this._state.stacks[stackIndex] = new TrackedArray([]);
    }
    if (
      item.id &&
      this._state.stacks[stackIndex].find((i: StackItem) => i.id === item.id)
    ) {
      // this card is already in the stack, do nothing (maybe we could hoist
      // this card to the top instead?)
      return;
    }
    this._state.stacks[stackIndex].push(item);
    if (item.id) {
      this.recentCardsService.add(item.id);
    }
    this.schedulePersist();
  }

  async deleteCard(cardId: string) {
    let cardRealmUrl = (await this.network.authedFetch(cardId)).headers.get(
      'X-Boxel-Realm-Url',
    );
    if (!cardRealmUrl) {
      throw new Error(`Could not determine the realm for card "${cardId}"`);
    }

    await this.store.delete(cardId);

    // remove all stack items for the deleted card
    let items: StackItem[] = [];
    for (let stack of this._state.stacks || []) {
      items.push(
        ...(stack.filter(
          (i: StackItem) => i.id && removeFileExtension(i.id) === cardId,
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

  async copySource(fromUrl: string, toUrl: string) {
    await this.cardService.copySource(new URL(fromUrl), new URL(toUrl));
  }

  trimItemsFromStack(item: StackItem) {
    let stackIndex = item.stackIndex;
    let itemIndex = this._state.stacks[stackIndex].indexOf(item);
    this._state.stacks[stackIndex].splice(itemIndex); // Remove anything above the item

    // If the resulting stack is now empty, remove it
    if (this.stackIsEmpty(stackIndex) && this._state.stacks.length >= 1) {
      this._state.stacks.splice(stackIndex, 1);

      // If we just removed the last item in the stack, and we also removed the stack because of that, we need
      // to update the stackIndex of all items in the stacks that come after the removed stack.
      // This is another code smell that the stackIndex should perhaps not not live in the item. For now, we keep it for convenience.
      this._state.stacks
        .filter((_, stackIndex) => stackIndex >= item.stackIndex)
        .forEach((stack, realStackIndex) => {
          stack.forEach((stackItem: StackItem) => {
            if (stackItem.stackIndex !== realStackIndex) {
              stackItem.stackIndex = realStackIndex;
            }
          });
        });
    }

    if (this._state.stacks.length === 0) {
      this.operatorModeController.workspaceChooserOpened = true;
    }

    this.schedulePersist();
  }

  popItemFromStack(stackIndex: number) {
    let stack = this._state.stacks[stackIndex];
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
    let itemIndex = this._state.stacks[stackIndex].indexOf(item);

    if (newItem.stackIndex !== stackIndex) {
      // this could be a smell that the stack index should not live in the item
      throw new Error(
        'cannot move stack item to different stack--this can destabilize contained card pointers',
      );
    }

    this._state.stacks[stackIndex].splice(itemIndex, 1, newItem);
    this.schedulePersist();
  }

  clearStackAndAdd(stackIndex: number, newItem: StackItem) {
    let itemsToPopCount = this._state.stacks[stackIndex].length;

    for (let i = 0; i < itemsToPopCount; i++) {
      this.popItemFromStack(stackIndex);
    }

    this.addItemToStack(newItem);
  }

  numberOfStacks() {
    return this._state.stacks.length;
  }

  rightMostStack() {
    if (this.numberOfStacks() > 0) {
      return this._state.stacks[this._state.stacks.length - 1];
    }
    return;
  }

  topMostStackItems() {
    return this._state.stacks
      .filter((stack) => stack.length > 0)
      .map((stack) => stack[stack.length - 1]);
  }

  getOpenCardIds(selectedCardRef?: ResolvedCodeRef): string[] {
    if (this._state.submode === Submodes.Code) {
      let openCardsInCodeMode = [];
      // selectedCardRef is only needed for determining open playground card id in code submode
      if (selectedCardRef) {
        let moduleId = internalKeyFor(selectedCardRef, undefined);
        openCardsInCodeMode.push(
          this.playgroundPanelService.getSelection(moduleId)?.cardId,
        );
      }
      // Alternatively we may simply be looking at a card in code mode
      if (this._state.codePath?.href.endsWith('.json')) {
        let cardId = this._state.codePath.href.replace(/\.json$/, '');
        if (!openCardsInCodeMode.includes(cardId)) {
          openCardsInCodeMode.push(cardId);
        }
      }
      return openCardsInCodeMode;
    } else {
      // Interact mode
      return this.topMostStackItems()
        .filter((stackItem: StackItem) => stackItem)
        .map((stackItem: StackItem) => stackItem.id)
        .filter(Boolean) as string[];
    }
  }

  getOpenCards = restartableTask(async (selectedCardRef?: ResolvedCodeRef) => {
    let cardIds = this.getOpenCardIds(selectedCardRef);
    if (!cardIds) {
      return;
    }
    let cards = (await Promise.all(cardIds.map((id) => this.store.get(id))))
      .filter(Boolean)
      .filter(isCardInstance);
    return cards;
  });

  get openFileURL(): string | undefined {
    if (this._state.submode === Submodes.Code) {
      return this._state.codePath?.href;
    }
    return undefined;
  }

  stackIsEmpty(stackIndex: number) {
    return this._state.stacks[stackIndex].length === 0;
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

  async updateSubmode(submode: Submode) {
    this._state.submode = submode;
    this.schedulePersist();

    if (submode === Submodes.Code) {
      await Promise.all([
        this.matrixService.setLLMForCodeMode(),
        this.matrixService.activateCodingSkill(),
      ]);
    }
  }

  async updateModuleInspectorView(view: ModuleInspectorView) {
    this._state.moduleInspector = view;
    this.panelSelections[this.state.codePath?.href ?? ''] = view;
    window.localStorage.setItem(
      ModuleInspectorSelections,
      JSON.stringify(this.panelSelections),
    );
    this.schedulePersist();
  }

  async updateCodePathWithSelection({
    codeRef,
    localName,
    fieldName,
    onLocalSelection,
  }: {
    codeRef: CodeRef | undefined;
    localName: string | undefined;
    fieldName: string | undefined;
    onLocalSelection?: (name: string, fieldName?: string) => void;
  }) {
    //moving from one definition to another
    if (codeRef && isResolvedCodeRef(codeRef)) {
      //(possibly) in a different module
      this._state.codeSelection = codeRef.name;
      await this.updateCodePath(new URL(codeRef.module));
    } else if (
      codeRef &&
      'type' in codeRef &&
      codeRef.type === 'fieldOf' &&
      'card' in codeRef &&
      isResolvedCodeRef(codeRef.card)
    ) {
      this._state.fieldSelection = codeRef.field;
      this._state.codeSelection = codeRef.card.name;
      await this.updateCodePath(new URL(codeRef.card.module));
    } else if (localName && onLocalSelection) {
      //in the same module
      this._state.codeSelection = localName;
      this._state.fieldSelection = fieldName;
      this.schedulePersist();
      onLocalSelection(localName, fieldName);
    }
  }

  get codePathRelativeToRealm() {
    if (this._state.codePath && this.realmURL) {
      let realmPath = new RealmPaths(this.realmURL);

      if (realmPath.inRealm(this._state.codePath)) {
        try {
          return realmPath.local(this._state.codePath!);
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
    return this._state.codePath?.toString();
  }

  onFileSelected = async (entryPath: LocalPath) => {
    let fileUrl = new RealmPaths(this.realmURL).fileURL(entryPath);
    await this.updateCodePath(fileUrl);
  };

  async updateCodePath(codePath: URL | null) {
    let canonicalCodePath = await this.determineCanonicalCodePath(codePath);
    this._state.codePath = canonicalCodePath;
    this.updateOpenDirsForNestedPath();
    this.schedulePersist();

    let moduleInspectorView =
      this.panelSelections[codePath?.href ?? ''] ?? 'schema';

    this.updateModuleInspectorView(moduleInspectorView);

    this.specPanelService.setSelection(null);
  }

  private persistModuleInspectorView(
    codePath: string | null,
    moduleInspector: ModuleInspectorView,
  ) {
    if (codePath) {
      this.panelSelections[codePath] = moduleInspector;
      window.localStorage.setItem(
        ModuleInspectorSelections,
        JSON.stringify(this.panelSelections),
      );
    }
  }

  private async determineCanonicalCodePath(codePath: URL | null) {
    if (!codePath) {
      return codePath;
    }

    let response;
    try {
      // TODO Change to HEAD in CS-8846
      response = await this.network.authedFetch(codePath, {
        headers: { Accept: SupportedMimeType.CardSource },
      });

      if (response.ok) {
        return new URL(response.url);
      }

      return codePath;
    } catch (_e) {
      return codePath;
    }
  }

  replaceCodePath(codePath: URL | null) {
    // replace history explicitly
    // typically used when, serving a redirect in the code path
    // solve UX issues with back button referring back to request url of redirect
    // when it should refer back to the previous code path
    this._state.codePath = codePath;
    this.router.replaceWith('index', {
      queryParams: {
        operatorModeState: this.serialize(),
      },
    });
  }

  setCardTitle(url: string, title: string) {
    this.setCardTitleTask.perform(url, title);
  }

  // we use a task to organize simultaneous updates, otherwise you may get error
  // around updating a value previously used in a computation
  private setCardTitleTask = task(async (url: string, title: string) => {
    await Promise.resolve(); // wait 1 micro task
    this.cardTitles.set(url, title);
  });

  @cached
  get title() {
    if (this._state.submode === Submodes.Code) {
      return `${this.codePathRelativeToRealm} in ${
        this.realm.info(this.realmURL.href).name
      }`;
    } else {
      let itemForTitle = this.topMostStackItems().pop(); // top-most card of right stack
      return (
        (itemForTitle?.id ? this.cardTitles.get(itemForTitle.id) : 'Boxel') ??
        'Boxel'
      );
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
    this._state.fileView = fileView;
    this.schedulePersist();
  }

  clearStacks() {
    this._state.stacks.splice(0);
    this.schedulePersist();
  }

  // when a stack item's card has been saved we need to update the URL to reflect the saved card's remote ID
  // TODO make test for reloading after card has been saved
  handleCardIdAssignment(localId: string) {
    if (
      this._state.stacks.find((stack) =>
        stack.find((item) => item.id === localId),
      )
    ) {
      this.schedulePersist();
    }
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
  // clicking on "Create New" in linked card editor. Here we want to draw a boundary
  // between navigable states in the query parameter
  rawStateWithSavedCardsOnly() {
    let state: SerializedState = {
      stacks: [],
      submode: this._state.submode,
      codePath: this._state.codePath?.toString(),
      fileView: this._state.fileView?.toString() as FileView,
      openDirs: Object.fromEntries(this._state.openDirs.entries()),
      codeSelection: this._state.codeSelection,
      fieldSelection: this._state.fieldSelection,
      aiAssistantOpen: this._state.aiAssistantOpen,
      moduleInspector: this._state.moduleInspector,
    };

    for (let stack of this._state.stacks) {
      let serializedStack: SerializedStack = [];
      for (let item of stack) {
        if (item.format !== 'isolated' && item.format !== 'edit') {
          throw new Error(`Unknown format for card on stack ${item.format}`);
        }
        if (item.id) {
          let instance = this.store.peek(item.id);
          if (!isLocalId(item.id) || instance?.id) {
            serializedStack.push({
              id: instance?.id ?? item.id,
              format: item.format,
            });
          }
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

  createStackItem(
    id: string,
    stackIndex: number,
    format: 'isolated' | 'edit' = 'isolated',
  ) {
    let stackItem = new StackItem({
      id,
      stackIndex,
      format,
    });
    return stackItem;
  }

  // Deserialize a stringified JSON version of OperatorModeState into a Glimmer tracked object
  // so that templates can react to changes in stacks and their items
  deserialize(rawState: SerializedState): OperatorModeState {
    let openDirs = new TrackedMap<string, string[]>(
      Object.entries(rawState.openDirs ?? {}).map(([realmURL, dirs]) => [
        realmURL,
        new TrackedArray(dirs),
      ]),
    );

    console.log('in deserialise', rawState.codePath, rawState.moduleInspector);

    let newState: OperatorModeState = new TrackedObject({
      stacks: new TrackedArray([]),
      submode: rawState.submode ?? Submodes.Interact,
      codePath: rawState.codePath ? new URL(rawState.codePath) : null,
      fileView: rawState.fileView ?? 'inspector',
      openDirs,
      codeSelection: rawState.codeSelection,
      fieldSelection: rawState.fieldSelection,
      aiAssistantOpen: rawState.aiAssistantOpen ?? false,
      moduleInspector: rawState.moduleInspector ?? 'schema', // FIXME this is defined elsewhere?
    });

    if (rawState.codePath && rawState.moduleInspector) {
      this.persistModuleInspectorView(
        rawState.codePath,
        rawState.moduleInspector,
      );
    }

    let stackIndex = 0;
    for (let stack of rawState.stacks) {
      let newStack: Stack = new TrackedArray([]);
      for (let item of stack) {
        let { format } = item;
        newStack.push(
          new StackItem({
            id: item.id,
            format,
            stackIndex,
          }),
        );
      }
      newState.stacks.push(newStack);
      stackIndex++;
    }

    return newState;
  }

  get openDirs() {
    return this._state.openDirs ?? new TrackedMap();
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
      `cannot access file contents ${this._state.codePath} before file is open`,
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

  openFile = maybe(this, (context: object) => {
    let codePath = this._state.codePath;

    if (!codePath) {
      return undefined;
    }

    return file(context, () => ({
      url: codePath!.href,
      onStateChange: (state: FileResource['state']) => {
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

  openCardInInteractMode(id: string, format: Format = 'isolated') {
    this.clearStacks();
    let indexItem = new StackItem({
      id: `${this.realm.url(id)}index`,
      stackIndex: 0,
      format: 'isolated',
    });
    let newItem = new StackItem({
      id,
      stackIndex: 0,
      format,
    });
    this.addItemToStack(indexItem);
    this.addItemToStack(newItem);
    this.updateSubmode(Submodes.Interact);
  }

  openWorkspace = async (realmUrl: string) => {
    let id = `${realmUrl}index`;
    let stackItem = new StackItem({
      id,
      format: 'isolated',
      stackIndex: 0,
    });
    this.clearStacks();
    this.addItemToStack(stackItem);

    let lastOpenedFile = this.recentFilesService.recentFiles.find(
      (file: RecentFile) => file.realmURL.href === realmUrl,
    );
    await this.updateCodePath(
      lastOpenedFile
        ? new URL(`${lastOpenedFile.realmURL}${lastOpenedFile.filePath}`)
        : new URL(id),
    );

    this.operatorModeController.workspaceChooserOpened = false;
  };

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

  get moduleInspectorPanel() {
    return (
      JSON.parse(window.localStorage.getItem(CodeModePanelSelections) ?? '{}')[
        this.codePathString ?? ''
      ] ?? 'schema'
    );
  }

  get playgroundPanelSelection(): PlaygroundSelection | undefined {
    if (this.moduleInspectorPanel === 'preview') {
      let playgroundSelections = JSON.parse(
        window.localStorage.getItem(PlaygroundSelections) ?? '{}',
      );
      let playgroundPanelSelection = Object.values(playgroundSelections).find(
        (selection: any) => selection.url === this.codePathString,
      );
      return playgroundPanelSelection as PlaygroundSelection | undefined;
    }
    return undefined;
  }

  getSummaryForAIBot(
    openCardIds: Set<string> = new Set([...this.getOpenCardIds()]),
  ): BoxelContext {
    let codeMode =
      this._state.submode === Submodes.Code
        ? {
            currentFile: this.codePathString,
            moduleInspectorPanel: this.moduleInspectorPanel,
            previewPanelSelection: this.playgroundPanelSelection
              ? {
                  cardId: this.playgroundPanelSelection.cardId,
                  format: this.playgroundPanelSelection.format,
                }
              : undefined,
          }
        : undefined;

    return {
      agentId: this.matrixService.agentId,
      submode: this._state.submode,
      debug: this.operatorModeController.debug,
      openCardIds: this.makeRemoteIdsList([...openCardIds]),
      realmUrl: this.realmURL.href,
      codeMode,
    };
  }

  private makeRemoteIdsList(ids: (string | undefined)[]) {
    return ids
      .map((id) => {
        if (!id) {
          return undefined;
        }
        if (isLocalId(id)) {
          let maybeInstance = this.store.peek(id);
          if (
            maybeInstance &&
            isCardInstance(maybeInstance) &&
            maybeInstance.id
          ) {
            return maybeInstance.id;
          } else {
            return undefined;
          }
        }
        return id;
      })
      .filter(Boolean) as string[];
  }
}

declare module '@ember/service' {
  interface Registry {
    'operator-mode-state-service': OperatorModeStateService;
  }
}
