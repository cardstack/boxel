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

import type { CodeRef } from '@cardstack/runtime-common';
import {
  RealmPaths,
  type LocalPath,
  isResolvedCodeRef,
  isCardInstance,
  isLocalId,
  localId as localIdSymbol,
  Deferred,
  SupportedMimeType,
  internalKeyFor,
  realmURL as realmURLSymbol,
} from '@cardstack/runtime-common';

import type { Submode } from '@cardstack/host/components/submode-switcher';
import { Submodes } from '@cardstack/host/components/submode-switcher';
import { StackItem } from '@cardstack/host/lib/stack-item';

import {
  file,
  isReady,
  type FileResource,
} from '@cardstack/host/resources/file';
import { maybe } from '@cardstack/host/resources/maybe';
import type LoaderService from '@cardstack/host/services/loader-service';
import type MessageService from '@cardstack/host/services/message-service';
import type MonacoService from '@cardstack/host/services/monaco-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type { PlaygroundSelection } from '@cardstack/host/services/playground-panel-service';
import type Realm from '@cardstack/host/services/realm';
import type RealmServer from '@cardstack/host/services/realm-server';
import type RecentCardsService from '@cardstack/host/services/recent-cards-service';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';

import type { BoxelContext } from 'https://cardstack.com/base/matrix-event';

import { removeFileExtension } from '../components/search-sheet/utils';

import { ModuleInspectorSelections } from '../utils/local-storage-keys';

import { normalizeDirPath } from '../utils/normalized-dir-path';

import type CardService from './card-service';
import type CodeSemanticsService from './code-semantics-service';
import type ErrorDisplayService from './error-display';
import type MatrixService from './matrix-service';
import type NetworkService from './network';
import type { RecentFile } from './recent-files-service';
import type ResetService from './reset';
import type SpecPanelService from './spec-panel-service';
import type StoreService from './store';
import type { Stack } from '../components/operator-mode/interact-submode';

import type IndexController from '../controllers';

// Below types form a raw POJO representation of operator mode state.
// This state differs from OperatorModeState in that it only contains cards that have been saved (i.e. have an ID).
// This is because we don't have a way to serialize a stack configuration of linked cards that have not been saved yet.

export interface OperatorModeState {
  version: number;
  stacks: Stack[];
  submode: Submode;
  codePath: URL | null;
  hostModePrimaryCard: string | null;
  hostModeStack: string[];
  aiAssistantOpen: boolean;
  fileView?: FileView;
  openDirs: Map<string, string[]>;
  codeSelection?: string;
  fieldSelection?: string;
  moduleInspector?: ModuleInspectorView;
  newFileDropdownOpen?: boolean;
  cardPreviewFormat: Format;
  workspaceChooserOpened?: boolean;
}

interface CardItem {
  id: string;
  format: 'isolated' | 'edit';
}

export type FileView = 'inspector' | 'browser';

type SerializedItem = CardItem;
type SerializedStack = SerializedItem[];

export type SerializedState = {
  version?: number;
  stacks: SerializedStack[];
  submode?: Submode;
  codePath?: string;
  trail?: string[];
  fileView?: FileView;
  openDirs?: Record<string, string[]>;
  codeSelection?: string;
  fieldSelection?: string;
  aiAssistantOpen?: boolean;
  moduleInspector?: ModuleInspectorView;
  cardPreviewFormat?: Format;
  workspaceChooserOpened?: boolean;
};

interface OpenFileSubscriber {
  onStateChange: (state: FileResource['state']) => void;
}

export type ModuleInspectorView = 'schema' | 'spec' | 'preview';
export const DEFAULT_MODULE_INSPECTOR_VIEW: ModuleInspectorView = 'schema';

export default class OperatorModeStateService extends Service {
  @tracked private _state: OperatorModeState = new TrackedObject({
    version: 0,
    stacks: new TrackedArray<Stack>([]),
    submode: Submodes.Interact,
    codePath: null,
    hostModePrimaryCard: null,
    hostModeStack: [],
    openDirs: new TrackedMap<string, string[]>(),
    aiAssistantOpen: true,
    newFileDropdownOpen: false,
    cardPreviewFormat: 'isolated' as Format,
    workspaceChooserOpened: false,
  });
  private cachedRealmURL: URL | null = null;
  private openFileSubscribers: OpenFileSubscriber[] = [];
  private cardTitles = new TrackedMap<string, string>();

  private moduleInspectorHistory: Record<string, ModuleInspectorView>;

  @tracked profileSettingsOpen = false;

  @service declare private cardService: CardService;
  @service declare private codeSemanticsService: CodeSemanticsService;
  @service declare private errorDisplay: ErrorDisplayService;
  @service declare private loaderService: LoaderService;
  @service declare private messageService: MessageService;
  @service declare private monacoService: MonacoService;
  @service declare private realm: Realm;
  @service declare private realmServer: RealmServer;
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

    let moduleInspectorHistory = window.localStorage.getItem(
      ModuleInspectorSelections,
    );
    this.moduleInspectorHistory = new TrackedObject(
      moduleInspectorHistory ? JSON.parse(moduleInspectorHistory) : {},
    );
  }

  toggleProfileSettings = () => {
    this.profileSettingsOpen = !this.profileSettingsOpen;
  };

  get state() {
    return {
      version: this._state.version,
      stacks: this._state.stacks,
      submode: this._state.submode,
      codePath: this._state.codePath,
      hostModeStack: this._state.hostModeStack,
      hostModePrimaryCard: this._state.hostModePrimaryCard,
      fileView: this._state.fileView,
      openDirs: this._state.openDirs,
      codeSelection: this._state.codeSelection,
      fieldSelection: this._state.fieldSelection,
      aiAssistantOpen: this._state.aiAssistantOpen,
      moduleInspector: this._state.moduleInspector,
      newFileDropdownOpen: this._state.newFileDropdownOpen,
      cardPreviewFormat: this._state.cardPreviewFormat,
      workspaceChooserOpened: this._state.workspaceChooserOpened,
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

  setNewFileDropdownOpen = () => {
    this._state.newFileDropdownOpen = true;
    this.schedulePersist();
  };
  setNewFileDropdownClosed = () => {
    this._state.newFileDropdownOpen = false;
    this.schedulePersist();
  };

  resetState() {
    this._state = new TrackedObject({
      version: 0,
      stacks: new TrackedArray([]),
      submode: Submodes.Interact,
      codePath: null,
      hostModePrimaryCard: null,
      hostModeStack: new TrackedArray([]),
      openDirs: new TrackedMap<string, string[]>(),
      aiAssistantOpen: false,
      moduleInspector: DEFAULT_MODULE_INSPECTOR_VIEW,
      newFileDropdownOpen: false,
      cardPreviewFormat: 'isolated' as Format,
      workspaceChooserOpened: true,
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

  replaceCardOnStack(
    oldId: string,
    newId: string,
    stackIndex: number,
    format: Format = 'edit',
  ): StackItem {
    let stack = this._state.stacks[stackIndex];
    if (!stack) {
      throw new Error(`Stack ${stackIndex} does not exist`);
    }
    let normalizedOldId = oldId.replace(/\.json$/, '');
    let item = this.findCardInStack(normalizedOldId, stackIndex);
    let newItem = item.clone({
      id: newId,
      format,
    });
    this.replaceItemInStack(item, newItem);
    return newItem;
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
    let stack = this._state.stacks[stackIndex];
    if (!stack) {
      return;
    }
    let itemIndex = stack.indexOf(item);
    if (itemIndex === -1) {
      return;
    }
    stack.splice(itemIndex); // Remove anything above the item

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
      const realmURL = this.getRealmURLFromItemId(item.id);
      const isIndexCard = this.isIndexCard(realmURL, item);
      if (isIndexCard) {
        // Only open workspace chooser if the trimmed item was an index card
        this._state.workspaceChooserOpened = true;
      } else {
        // If the trimmed item was not an index card, add an index card to the stack
        const indexCardId = `${realmURL}index`;
        const indexCardItem = this.createStackItem(indexCardId, 0);
        this.addItemToStack(indexCardItem);
      }
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

  findCardInStack(card: CardDef | string, stackIndex: number): StackItem {
    let stack = this._state.stacks[stackIndex];
    if (!stack) {
      throw new Error(`Stack ${stackIndex} does not exist`);
    }
    let cardId = typeof card === 'string' ? card : (card.id as string);
    let normalizedId = cardId?.replace(/\.json$/, '');
    let localId =
      typeof card === 'string' ? undefined : (card as any)[localIdSymbol];
    let item = stack.find(
      (stackItem: StackItem) =>
        stackItem.id === normalizedId ||
        stackItem.id === cardId ||
        (localId && stackItem.id === localId),
    );
    if (!item) {
      throw new Error(
        `Could not find card ${cardId ?? '(unknown id)'} in stack ${stackIndex}`,
      );
    }
    return item;
  }

  editCardInStack(stackIndex: number, card: CardDef): void {
    let item = this.findCardInStack(card, stackIndex);
    this.replaceItemInStack(
      item,
      item.clone({
        request: new Deferred(),
        format: 'edit',
      }),
    );
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

  addToHostModeStack(cardId: string) {
    this._state.hostModeStack.push(cardId);
    this.schedulePersist();
  }

  removeFromHostModeStack(cardId: string) {
    let index = this._state.hostModeStack.findIndex((item) => item === cardId);
    if (index !== -1) {
      this._state.hostModeStack.splice(index, 1);
      this.schedulePersist();
    }
  }

  get hostModeStack(): string[] {
    return this._state.hostModeStack;
  }

  setHostModePrimaryCard(cardId?: string) {
    if (cardId && !isLocalId(cardId)) {
      this._state.hostModePrimaryCard = cardId.replace(/\.json$/, '');
    } else if (!cardId) {
      this._state.hostModePrimaryCard = null;
    }
    // reset stack when primary card is changed
    this._state.hostModeStack.splice(0, this._state.hostModeStack.length);
    this.schedulePersist();
  }

  get hostModePrimaryCard(): string | null {
    return this._state.hostModePrimaryCard ?? null;
  }

  get version(): number {
    return this._state.version ?? 0;
  }

  // Only used in host tests to avoid version conflict issues
  // since in host tests the `visit` is not fully refreshing the page
  resetVersion() {
    this._state.version = 0;
  }

  private getRealmURLFromItemId(itemId: string): string {
    try {
      const url = new URL(itemId);
      return this.realm.realmOfURL(url)?.href ?? this.realmURL.href;
    } catch (error) {
      return this.realmURL.href;
    }
  }

  private isIndexCard(realmURL: string, item: StackItem): boolean {
    const itemUrl = item.id;
    return itemUrl === `${realmURL}index`;
  }

  get isViewingCardInCodeMode() {
    return (
      this._state.submode === Submodes.Code &&
      this.codePathString?.endsWith('.json')
    );
  }

  /**
   * Determines if we're currently viewing a card in the playground panel
   */
  get isViewingCardInPlaygroundPanel(): boolean {
    return (
      this._state.submode === Submodes.Code &&
      this.moduleInspectorPanel === 'preview' &&
      !!this.playgroundPanelSelection?.cardId
    );
  }

  /**
   * Gets the current format being viewed for focus pill display
   */
  get currentViewingFormat(): Format | undefined {
    if (this.isViewingCardInCodeMode) {
      return this._state.cardPreviewFormat ?? 'isolated';
    } else if (this.isViewingCardInPlaygroundPanel) {
      return this.playgroundPanelSelection?.format ?? 'isolated';
    }
    return undefined;
  }

  getOpenCardIds(): string[] {
    if (this._state.submode === Submodes.Code) {
      let openCardsInCodeMode = [];
      if (this.playgroundPanelSelection) {
        openCardsInCodeMode.push(this.playgroundPanelSelection.cardId);
      }
      // Alternatively we may simply be looking at a card in code mode
      if (this.isViewingCardInCodeMode) {
        let cardId = this.codePathString!.replace(/\.json$/, '');
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

  getOpenCards = restartableTask(async () => {
    let cardIds = this.getOpenCardIds();
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
    } else if (submode === Submodes.Interact) {
      await this.matrixService.setLLMForInteractMode();
    }
  }

  async updateModuleInspectorView(view: ModuleInspectorView) {
    this._state.moduleInspector = view;
    this.moduleInspectorHistory[this.state.codePath?.href ?? ''] = view;
    window.localStorage.setItem(
      ModuleInspectorSelections,
      JSON.stringify(this.moduleInspectorHistory),
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
      this.moduleInspectorHistory[canonicalCodePath?.href ?? ''] ??
      DEFAULT_MODULE_INSPECTOR_VIEW;

    this.updateModuleInspectorView(moduleInspectorView);

    this.specPanelService.setSelection(null);
  }

  persistModuleInspectorView(
    codePath: string | null,
    moduleInspector: ModuleInspectorView,
  ) {
    if (codePath) {
      this.moduleInspectorHistory[codePath] = moduleInspector;
      window.localStorage.setItem(
        ModuleInspectorSelections,
        JSON.stringify(this.moduleInspectorHistory),
      );
    }
  }

  private async determineCanonicalCodePath(codePath: URL | null) {
    if (!codePath) {
      return codePath;
    }

    let response;
    try {
      response = await this.network.authedFetch(codePath, {
        method: 'HEAD',
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
    this.router.replaceWith('index-root', {
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
      let segments = localPath.split('/').slice(0, -1).filter(Boolean);
      let accumulator: string[] = [];

      for (let segment of segments) {
        accumulator.push(segment);
        let dirPath = `${accumulator.join('/')}/`;

        if (!this.currentRealmOpenDirs.includes(dirPath)) {
          this.toggleOpenDir(dirPath);
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

  updateCardPreviewFormat(format: Format) {
    this._state.cardPreviewFormat = format;
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
    this._state.version = (this._state.version ?? 0) + 1;
    scheduleOnce('afterRender', this, this.persist);
  }

  private persist() {
    if (this.isDestroyed) {
      return;
    }
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
    let trail = [
      this._state.hostModePrimaryCard,
      ...this._state.hostModeStack.map((item) => item),
    ].filter(Boolean) as string[];
    let state: SerializedState = {
      version: this._state.version,
      stacks: [],
      submode: this._state.submode,
      codePath: this._state.codePath?.toString(),
      trail,
      fileView: this._state.fileView?.toString() as FileView,
      openDirs: Object.fromEntries(this._state.openDirs.entries()),
      codeSelection: this._state.codeSelection,
      fieldSelection: this._state.fieldSelection,
      moduleInspector: this._state.moduleInspector,
      cardPreviewFormat: this._state.cardPreviewFormat,
    };
    if (this._state.aiAssistantOpen) {
      state.aiAssistantOpen = this._state.aiAssistantOpen;
    }
    if (this._state.workspaceChooserOpened) {
      state.workspaceChooserOpened = this._state.workspaceChooserOpened;
    }

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
    relationshipContext?: {
      fieldName?: string;
      fieldType?: 'linksTo' | 'linksToMany';
    },
  ) {
    let stackItem = new StackItem({
      id,
      stackIndex,
      format,
      relationshipContext,
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

    let newState: OperatorModeState = new TrackedObject({
      version: rawState.version ?? 0,
      stacks: new TrackedArray([]),
      submode: rawState.submode ?? Submodes.Interact,
      codePath: rawState.codePath ? new URL(rawState.codePath) : null,
      hostModePrimaryCard: rawState.trail?.[0]?.replace(/\.json$/, '') ?? null,
      hostModeStack: new TrackedArray(
        rawState.trail
          ?.slice(1, rawState.trail?.length)
          .map((item) => item.replace(/\.json$/, '')) ?? [],
      ),
      fileView: rawState.fileView ?? 'inspector',
      openDirs,
      codeSelection: rawState.codeSelection,
      fieldSelection: rawState.fieldSelection,
      aiAssistantOpen: rawState.aiAssistantOpen ?? false,
      moduleInspector:
        rawState.moduleInspector ?? DEFAULT_MODULE_INSPECTOR_VIEW,
      cardPreviewFormat: rawState.cardPreviewFormat ?? 'isolated',
      workspaceChooserOpened: rawState.workspaceChooserOpened ?? false,
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

    let dirPath = normalizeDirPath(entryPath);
    let dirs = this.currentRealmOpenDirs.slice();
    let index = dirs.indexOf(dirPath);

    if (index !== -1) {
      dirs.splice(index, 1);
    } else {
      dirs.push(dirPath);
    }

    this.openDirs.set(this.realmURL.href, new TrackedArray(dirs));
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

  get realmURL(): URL {
    let { submode } = this._state;
    if (submode === Submodes.Code) {
      if (isReady(this.openFile.current)) {
        return new URL(this.readyFile.realmURL);
      }
    }

    // For interact mode, the idea of "current realm" is a bit abstract. the
    // realm background that you see in interact mode is the realm of the
    // bottom-most card in the stack. however you can have cards of differing
    // realms in the same stack and keep in mind you can have multiple stacks...
    if (submode === Submodes.Interact) {
      // Precedence rules for determining "current realm" for READ purposes:
      // 1. cardURL of the index card to determine current realm
      // 2. If no index card available, the realm of the top-most card
      let stack = this.rightMostStack(); // using right-most stack
      if (stack) {
        let cardId =
          stack[0]?.id &&
          this.realmServer.availableRealmIndexCardIds.includes(stack[0]?.id)
            ? stack[0].id
            : stack[stack.length - 1]?.id;
        if (cardId) {
          let realm = this.realm.url(cardId);
          if (realm) {
            return new URL(realm);
          }
        }
      }
    }

    // For host mode, determine realm from hostModePrimaryCard using availableRealmIndexCardIds
    if (submode === Submodes.Host) {
      // Check if hostModePrimaryCard is an available realm index card
      // If hostModePrimaryCard is not an index card, try to find the realm from the card's realm
      if (this._state.hostModePrimaryCard) {
        let cardId = this._state.hostModePrimaryCard.replace(/\.json$/, '');
        let realm = this.realm.url(cardId);
        if (realm) {
          return new URL(realm);
        }
      }
    }

    if (this.cachedRealmURL) {
      return this.cachedRealmURL;
    }

    return new URL(this.realm.defaultReadableRealm.path);
  }

  get currentRealmInfo() {
    return this.realm.info(this.realmURL.href);
  }

  getWritableRealmURL = (preferredURLs: string[] = []) => {
    // Optional `preferredURLs` argument with highest priority with fallback options below
    // Precedence rules for determining "current realm" for WRITE purposes:
    // 1. cardURL of the index card to determine current realm
    // 2. If no index card available, the realm of the top-most card if the realm is writable.
    // 3. Otherwise, fallback to the last opened writable realm, especially if the opening click is from dashboard.
    let urlsToCheck = [
      ...preferredURLs,
      this.realmURL.href,
      this.cachedRealmURL?.href,
    ].filter(Boolean) as string[];

    let foundURL = urlsToCheck.find((url) => this.realm.canWrite(url));

    if (foundURL) {
      return new URL(this.realm.url(foundURL)!);
    }

    if (this.realm.defaultWritableRealm) {
      return new URL(this.realm.defaultWritableRealm.path);
    }

    return undefined; // no writable realm found
  };

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
    // Determine realm URL. If id is a localId, look up the instance in the store to read its realm.
    let realmHref: string | undefined;
    if (isLocalId(id)) {
      let instance = this.store.peek(id);
      if (instance && isCardInstance(instance)) {
        realmHref = (instance as any)[realmURLSymbol]?.href;
      }
    } else {
      realmHref = this.realm.url(id) ?? undefined;
    }
    if (!realmHref) {
      // Fallback to default readable realm so UI still opens; this should be unusual.
      realmHref = this.realm.defaultReadableRealm.path;
    }
    if (!realmHref.endsWith('/')) {
      realmHref = realmHref + '/';
    }
    let indexItem = new StackItem({
      id: `${realmHref}index`,
      stackIndex: 0,
      format: 'isolated',
    });
    let newItem = new StackItem({
      id, // keep provided id (may be localId) so later replacement on save works
      stackIndex: 0,
      format,
    });
    this.addItemToStack(indexItem);
    this.addItemToStack(newItem);
    this.updateSubmode(Submodes.Interact);
  }

  openWorkspaceChooser() {
    this._state.workspaceChooserOpened = true;
    this.schedulePersist();
  }

  closeWorkspaceChooser() {
    this._state.workspaceChooserOpened = false;
    this.schedulePersist();
  }

  openWorkspace = async (realmUrl: string) => {
    // Ensure realmUrl has a trailing slash
    if (!realmUrl.endsWith('/')) {
      realmUrl = realmUrl + '/';
    }
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
    this.updateSubmode(Submodes.Interact);

    this._state.workspaceChooserOpened = false;
    this.cachedRealmURL = new URL(realmUrl);
  };

  get workspaceChooserOpened() {
    return this.state.workspaceChooserOpened ?? false;
  }

  set workspaceChooserOpened(workspaceChooserOpened: boolean) {
    this._state.workspaceChooserOpened = workspaceChooserOpened;
    this.schedulePersist();
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
      JSON.parse(
        window.localStorage.getItem(ModuleInspectorSelections) ?? '{}',
      )[this.codePathString ?? ''] ?? DEFAULT_MODULE_INSPECTOR_VIEW
    );
  }

  get playgroundPanelSelection(): PlaygroundSelection | undefined {
    if (this.moduleInspectorPanel === 'preview') {
      let playgroundSelections =
        this.playgroundPanelService.playgroundSelections ?? {};
      if (this.codePathString && playgroundSelections[this.codePathString]) {
        return playgroundSelections[this.codePathString];
      }
      let selectedCodeRefUrl = this.codeSemanticsService.selectedCodeRef
        ? internalKeyFor(this.codeSemanticsService.selectedCodeRef!, undefined)
        : null;
      if (selectedCodeRefUrl && playgroundSelections[selectedCodeRefUrl]) {
        return playgroundSelections[selectedCodeRefUrl];
      }
    }
    return undefined;
  }

  async getSummaryForAIBot(
    openCardIdsSet: Set<string> = new Set([...this.getOpenCardIds()]),
  ): Promise<BoxelContext> {
    let codeMode: BoxelContext['codeMode'] = undefined;
    if (this._state.workspaceChooserOpened) {
      let userWorkspaces = this.realmServer.userRealmURLs.map((url) => ({
        url,
        name: this.realm.info(url).name,
        type: 'user-workspace' as const,
      }));
      let catalogWorkspaces = this.realmServer.catalogRealmURLs.map((url) => ({
        url,
        name: this.realm.info(url).name,
        type: 'catalog-workspace' as const,
      }));
      let result: BoxelContext = {
        agentId: this.matrixService.agentId,
        submode: 'workspace-chooser',
        debug: this.operatorModeController.debug,
        openCardIds: [],
        workspaces: [...userWorkspaces, ...catalogWorkspaces],
      };
      let errorsDisplayed = this.errorDisplay.getDisplayedErrors();
      if (errorsDisplayed.length) {
        result.errorsDisplayed = errorsDisplayed;
      }
      return result;
    }
    if (this._state.submode === Submodes.Code) {
      codeMode = {
        currentFile: this.codePathString,
      };

      // Add selection range information when in code mode
      let selection = this.monacoService.getSelection();
      if (selection) {
        codeMode.selectionRange = {
          startLine: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLine: selection.endLineNumber,
          endColumn: selection.endColumn,
        };
      }

      if (this.isViewingCardInCodeMode) {
        codeMode.moduleInspectorPanel = 'preview';
        codeMode.previewPanelSelection = {
          cardId: this.codePathString!.replace(/\.json$/, ''),
          format: this.currentViewingFormat ?? 'isolated',
        };
      } else {
        codeMode.moduleInspectorPanel = this.moduleInspectorPanel;
        codeMode.previewPanelSelection = this.playgroundPanelSelection
          ? {
              cardId: this.playgroundPanelSelection.cardId,
              format: this.currentViewingFormat!,
            }
          : undefined;
        codeMode.selectedCodeRef = this.codeSemanticsService.selectedCodeRef;
        codeMode.inheritanceChain =
          await this.codeSemanticsService.getInheritanceChain();

        // Include active spec ID when spec pane is active
        if (
          this.moduleInspectorPanel === 'spec' &&
          this.specPanelService.specSelection
        ) {
          codeMode.activeSpecId = this.specPanelService.specSelection;
        }
      }
    }

    let openCardIds = this.makeRemoteIdsList([...openCardIdsSet]);
    let realmUrl = this.realmURL.href;
    let realmPermissions = {
      canRead: this.realm.canRead(realmUrl),
      canWrite: this.realm.canWrite(realmUrl),
    };

    let result: BoxelContext = {
      agentId: this.matrixService.agentId,
      submode: this._state.submode,
      debug: this.operatorModeController.debug,
      openCardIds,
      realmUrl,
      realmPermissions,
      codeMode,
    };
    let errorsDisplayed = this.errorDisplay.getDisplayedErrors();
    if (errorsDisplayed.length) {
      result.errorsDisplayed = errorsDisplayed;
    }
    return result;
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
