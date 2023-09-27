import { registerDestructor } from '@ember/destroyable';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import { buildWaiter } from '@ember/test-waiters';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';
//@ts-expect-error cached type not available yet
import { cached, tracked } from '@glimmer/tracking';

import { task, restartableTask, timeout, all } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import { use, resource } from 'ember-resources';
import isEqual from 'lodash/isEqual';
import { TrackedObject } from 'tracked-built-ins';

import {
  LoadingIndicator,
  Button,
  ResizablePanelGroup,
  PanelContext,
} from '@cardstack/boxel-ui';
import cn from '@cardstack/boxel-ui/helpers/cn';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { and } from '@cardstack/boxel-ui/helpers/truth-helpers';

import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';

import {
  type RealmInfo,
  type SingleCardDocument,
  type LooseSingleCardDocument,
  type CodeRef,
  RealmPaths,
  logger,
  isCardDocument,
  isSingleCardDocument,
  identifyCard,
  moduleFrom,
  hasExecutableExtension,
} from '@cardstack/runtime-common';

import RecentFiles from '@cardstack/host/components/editor/recent-files';
import CardAdoptionChain from '@cardstack/host/components/operator-mode/card-adoption-chain';
import config from '@cardstack/host/config/environment';

import monacoModifier from '@cardstack/host/modifiers/monaco';

import {
  getCardType,
  type CardType,
} from '@cardstack/host/resources/card-type';
import {
  file,
  isReady,
  type Ready,
  type FileResource,
} from '@cardstack/host/resources/file';

import { importResource } from '@cardstack/host/resources/import';

import { maybe } from '@cardstack/host/resources/maybe';

import type CardService from '@cardstack/host/services/card-service';

import type LoaderService from '@cardstack/host/services/loader-service';

// host components

// host resources

// host services
import type MessageService from '@cardstack/host/services/message-service';
import type MonacoService from '@cardstack/host/services/monaco-service';
import type { MonacoSDK } from '@cardstack/host/services/monaco-service';
import type { FileView } from '@cardstack/host/services/operator-mode-state-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import RecentFilesService from '@cardstack/host/services/recent-files-service';

import { CardDef } from 'https://cardstack.com/base/card-api';

import { type BaseDef } from 'https://cardstack.com/base/card-api';

import FileTree from '../editor/file-tree';

import BinaryFileInfo from './binary-file-info';
import CardPreviewPanel from './card-preview-panel';
import CardURLBar from './card-url-bar';
import DetailPanel from './detail-panel';

interface Signature {
  Args: {
    delete: (card: CardDef, afterDelete?: () => void) => void;
    saveSourceOnClose: (url: URL, content: string) => void;
    saveCardOnClose: (card: CardDef) => void;
  };
}
const log = logger('component:code-mode');
const waiter = buildWaiter('code-mode:load-card-waiter');
let { autoSaveDelayMs } = config;

type PanelWidths = {
  rightPanel: string;
  codeEditorPanel: string;
  leftPanel: string;
  emptyCodeModePanel: string;
};

const CodeModePanelWidths = 'code-mode-panel-widths';
const defaultPanelWidths: PanelWidths = {
  leftPanel: 'var(--operator-mode-left-column)',
  codeEditorPanel: '48%',
  rightPanel: '32%',
  emptyCodeModePanel: '80%',
};

interface ExportedCard {
  cardType: CardType;
  card: typeof BaseDef;
}

// Element
// - exported / unexported card or field
// - exported class or function
export type ElementInFile = ExportedCard; // can add more types here

export default class CodeMode extends Component<Signature> {
  @service declare monacoService: MonacoService;
  @service declare cardService: CardService;
  @service declare messageService: MessageService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare recentFilesService: RecentFilesService;
  @service declare loaderService: LoaderService;

  @tracked private loadFileError: string | null = null;
  @tracked private maybeMonacoSDK: MonacoSDK | undefined;
  @tracked private card: CardDef | undefined;
  @tracked private cardError: Error | undefined;
  @tracked private userHasDismissedURLError = false;
  @tracked private selectedElement: ElementInFile | undefined;
  private hasUnsavedSourceChanges = false;
  private hasUnsavedCardChanges = false;
  private panelWidths: PanelWidths;
  private realmSubscription:
    | { url: string; unsubscribe: () => void }
    | undefined;
  // This is to cache realm info during reload after code path change so
  // that realm assets don't produce a flicker when code patch changes and
  // the realm is the same
  private cachedRealmInfo: RealmInfo | null = null;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.panelWidths = localStorage.getItem(CodeModePanelWidths)
      ? // @ts-ignore Type 'null' is not assignable to type 'string'
        JSON.parse(localStorage.getItem(CodeModePanelWidths))
      : defaultPanelWidths;

    let url = `${this.cardService.defaultURL}_message`;
    this.realmSubscription = {
      url,
      unsubscribe: this.messageService.subscribe(
        url,
        ({ type, data: dataStr }) => {
          if (type !== 'index') {
            return;
          }
          let data = JSON.parse(dataStr);
          if (!this.card || data.type !== 'incremental') {
            return;
          }
          let invalidations = data.invalidations as string[];
          if (invalidations.includes(this.card.id)) {
            this.maybeReloadCard.perform(this.card.id);
          }
        },
      ),
    };
    registerDestructor(this, () => {
      // destructor functons are called synchronously. in order to save,
      // which is async, we leverage an EC task that is running in a
      // parent component (EC task lifetimes are bound to their context)
      // that is not being destroyed.
      if (this.codePath && this.hasUnsavedSourceChanges) {
        // we let the monaco changes win if there are unsaved changes both
        // monaco and the card preview (an arbitrary choice)
        this.args.saveSourceOnClose(this.codePath, getMonacoContent());
      } else if (this.hasUnsavedCardChanges && this.card) {
        this.args.saveCardOnClose(this.card);
      }
      this.realmSubscription?.unsubscribe();
    });
    this.loadMonaco.perform();
  }

  private get realmInfo() {
    return this.realmInfoResource.value;
  }

  private get backgroundURL() {
    return this.realmInfo?.backgroundURL;
  }

  private get backgroundURLStyle() {
    return htmlSafe(`background-image: url(${this.backgroundURL});`);
  }

  @action setFileView(view: FileView) {
    this.operatorModeStateService.updateFileView(view);
  }

  get fileView() {
    return this.operatorModeStateService.state.fileView;
  }

  get fileViewTitle() {
    return this.fileView === 'inheritance' ? 'Inheritance' : 'File Browser';
  }

  private get realmURL() {
    return this.isReady
      ? this.readyFile.realmURL
      : this.cardService.defaultURL.href;
  }

  private get realmIconURL() {
    return this.realmInfo?.iconURL;
  }

  private get isLoading() {
    return (
      this.loadMonaco.isRunning || this.openFile.current?.state === 'loading'
    );
  }

  private get isReady() {
    return this.maybeMonacoSDK && isReady(this.openFile.current);
  }

  private get schemaEditorIncompatible() {
    return this.readyFile.isBinary || this.isNonCardJson;
  }

  private isNonCardJson() {
    return (
      this.readyFile.name.endsWith('.json') &&
      !isCardDocument(this.readyFile.content)
    );
  }

  private get emptyOrNotFound() {
    return !this.codePath || this.openFile.current?.state === 'not-found';
  }

  private loadMonaco = task(async () => {
    this.maybeMonacoSDK = await this.monacoService.getMonacoContext();
  });

  private get readyFile() {
    if (isReady(this.openFile.current)) {
      return this.openFile.current;
    }
    throw new Error(
      `cannot access file contents ${this.codePath} before file is open`,
    );
  }

  private get monacoSDK() {
    if (this.maybeMonacoSDK) {
      return this.maybeMonacoSDK;
    }
    throw new Error(`cannot use monaco SDK before it has loaded`);
  }

  private get codePath() {
    return this.operatorModeStateService.state.codePath;
  }

  @action private resetLoadFileError() {
    this.loadFileError = null;
  }

  @action private dismissURLError() {
    this.userHasDismissedURLError = true;
  }

  @use private realmInfoResource = resource(() => {
    if (!this.realmURL) {
      return new TrackedObject({
        error: null,
        isLoading: false,
        value: this.cachedRealmInfo,
        load: () => Promise<void>,
      });
    }

    const state: {
      isLoading: boolean;
      value: RealmInfo | null;
      error: Error | undefined;
      load: () => Promise<void>;
    } = new TrackedObject({
      isLoading: true,
      value: this.cachedRealmInfo,
      error: undefined,
      load: async () => {
        state.isLoading = true;

        try {
          let realmInfo = await this.cardService.getRealmInfoByRealmURL(
            new URL(this.realmURL),
          );

          if (realmInfo) {
            this.cachedRealmInfo = realmInfo;
          }

          state.value = realmInfo;
        } catch (error: any) {
          state.error = error;
        } finally {
          state.isLoading = false;
        }
      },
    });

    state.load();
    return state;
  });

  @use private elements = resource(({ on }) => {
    on.cleanup(() => {
      this.selectedElement = undefined;
    });
    if (!this.importedModule) {
      return new TrackedObject({
        error: null,
        isLoading: false,
        value: [],
        load: () => Promise<void>,
      });
    }

    const state: {
      isLoading: boolean;
      value: ElementInFile[] | null;
      error: Error | undefined;
      load: () => Promise<void>;
    } = new TrackedObject({
      isLoading: true,
      value: [],
      error: undefined,
      load: async () => {
        state.isLoading = true;
        if (this.importedModule === undefined) {
          state.value = [];
          return;
        }
        try {
          await this.importedModule.loaded;
          let module = this.importedModule?.module;
          if (module) {
            let cards = cardsOrFieldsFromModule(module);
            let elements: ElementInFile[] = cards.map((card) => {
              return {
                cardType: getCardType(this, () => card),
                card: card,
              };
            });
            state.value = elements;
          }
        } catch (error: any) {
          state.error = error;
        } finally {
          state.isLoading = false;
        }
      },
    });

    state.load();
    return state;
  });

  private openFile = maybe(this, (context) => {
    if (!this.codePath) {
      this.setFileView('browser');
      return undefined;
    }

    return file(context, () => ({
      url: this.codePath!.href,
      onStateChange: (state) => {
        this.userHasDismissedURLError = false;
        if (state === 'not-found') {
          this.loadFileError = 'This resource does not exist';
          this.setFileView('browser');
        } else if (state === 'ready') {
          this.loadFileError = null;
        }
      },
      onRedirect: (url: string) => {
        this.operatorModeStateService.replaceCodePath(new URL(url));
      },
    }));
  });

  @use private importedModule = resource(() => {
    if (isReady(this.openFile.current)) {
      let f: Ready = this.openFile.current;
      if (f.url.endsWith('.json')) {
        let ref = identifyCard(this.card?.constructor);
        if (ref !== undefined) {
          return importResource(this, () => moduleFrom(ref as CodeRef));
        } else {
          return;
        }
      } else if (hasExecutableExtension(f.url)) {
        return importResource(this, () => f.url);
      }
    }
    return undefined;
  });

  private maybeReloadCard = restartableTask(async (id: string) => {
    if (this.card?.id === id) {
      try {
        await this.loadIfDifferent.perform(
          new URL(id),
          // we need to be careful that we are not responding to our own echo.
          // first test to see if the card is actually different by comparing
          // the serializations
          (await this.cardService.fetchJSON(id)) as SingleCardDocument,
        );
      } catch (e: any) {
        if ('status' in e && e.status === 404) {
          return; // card has been deleted
        }
        throw e;
      }
    }
  });
  // We are actually loading cards using a side-effect of this cached getter
  // instead of a resource because with a resource it becomes impossible
  // to ignore our own auto-save echoes, since the act of auto-saving triggers
  // the openFile resource to update which would otherwise trigger a card
  // resource to update (and hence invalidate components can consume this card
  // resource.) By using this side effect we can prevent invalidations when the
  // card isn't actually different and we are just seeing SSE events in response
  // to our own activity.
  @cached
  private get openFileCardJSON() {
    this.cardError = undefined;
    if (
      this.openFile.current?.state === 'ready' &&
      this.openFile.current.name.endsWith('.json')
    ) {
      let maybeCard: any;
      try {
        maybeCard = JSON.parse(this.openFile.current.content);
      } catch (err: any) {
        this.cardError = err;
        return undefined;
      }
      if (isSingleCardDocument(maybeCard)) {
        let url = this.openFile.current.url.replace(/\.json$/, '');
        if (!url) {
          return undefined;
        }
        this.loadIfDifferent.perform(new URL(url), maybeCard);
        return maybeCard;
      }
    }
    // in order to not get trapped in a glimmer invalidation cycle we need to
    // unload the card in a different closure
    this.unloadCard.perform();
    return undefined;
  }

  private unloadCard = task(async () => {
    await Promise.resolve();
    this.card = undefined;
    this.cardError = undefined;
  });

  private get cardIsLoaded() {
    return (
      isReady(this.openFile.current) &&
      this.openFileCardJSON &&
      this.card?.id === this.openFile.current.url.replace(/\.json$/, '')
    );
  }

  private get loadedCard() {
    if (!this.card) {
      throw new Error(`bug: card ${this.codePath} is not loaded`);
    }
    return this.card;
  }

  private get selectedElementInFile() {
    if (this.selectedElement) {
      return this.selectedElement;
    } else {
      if (this.elementsInFile === null) {
        return;
      }
      return this.elementsInFile.length > 0
        ? this.elementsInFile[0]
        : undefined;
    }
  }

  @action
  private selectElementInFile(el: ElementInFile) {
    this.selectedElement = el;
  }

  get elementsInFile() {
    if (this.elements.value === null) {
      return [];
    }
    return this.elements.value;
  }

  private loadIfDifferent = restartableTask(
    async (url: URL, incomingDoc?: SingleCardDocument) => {
      await this.withTestWaiters(async () => {
        let card = await this.cardService.loadModel(url);
        if (this.card && incomingDoc) {
          let incoming = comparableSerialization(incomingDoc);
          let current = comparableSerialization(
            await this.cardService.serializeCard(this.card),
          );
          if (isEqual(incoming, current)) {
            return;
          }
        }
        if (this.card) {
          this.cardService.unsubscribe(this.card, this.onCardChange);
        }
        this.card = card;
        this.cardService.subscribe(this.card, this.onCardChange);
      });
    },
  );

  private onCardChange = () => {
    this.doWhenCardChanges.perform();
  };

  private doWhenCardChanges = restartableTask(async () => {
    if (this.card) {
      this.hasUnsavedCardChanges = true;
      await timeout(autoSaveDelayMs);
      await this.saveCard.perform(this.card);
      this.hasUnsavedCardChanges = false;
    }
  });

  private saveCard = restartableTask(async (card: CardDef) => {
    // these saves can happen so fast that we'll make sure to wait at
    // least 500ms for human consumption
    await all([this.cardService.saveModel(card), timeout(500)]);
  });

  private contentChangedTask = restartableTask(async (content: string) => {
    this.hasUnsavedSourceChanges = true;
    await timeout(autoSaveDelayMs);
    if (
      !isReady(this.openFile.current) ||
      content === this.openFile.current?.content
    ) {
      return;
    }

    let isJSON = this.openFile.current.name.endsWith('.json');
    let validJSON = isJSON && this.safeJSONParse(content);
    // Here lies the difference in how json files and other source code files
    // are treated during editing in the code editor
    if (validJSON && isSingleCardDocument(validJSON)) {
      // writes json instance but doesn't update state of the file resource
      // relies on message service subscription to update state
      await this.saveFileSerializedCard.perform(validJSON);
    } else if (!isJSON || validJSON) {
      // writes source code and non-card instance valid JSON,
      // then updates the state of the file resource
      this.writeSourceCodeToFile(this.openFile.current, content);
      this.waitForSourceCodeWrite.perform();
    }
    this.hasUnsavedSourceChanges = false;
  });

  // these saves can happen so fast that we'll make sure to wait at
  // least 500ms for human consumption
  private waitForSourceCodeWrite = restartableTask(async () => {
    if (isReady(this.openFile.current)) {
      await all([this.openFile.current.writing, timeout(500)]);
    }
  });

  // We use this to write non-cards to the realm--so it doesn't make
  // sense to go thru the card-service for this
  private writeSourceCodeToFile(file: FileResource, content: string) {
    if (file.state !== 'ready') {
      throw new Error('File is not ready to be written to');
    }

    return file.write(content);
  }

  private safeJSONParse(content: string) {
    try {
      return JSON.parse(content);
    } catch (err) {
      log.warn(
        `content for ${this.codePath} is not valid JSON, skipping write`,
      );
      return;
    }
  }

  private saveFileSerializedCard = task(async (json: SingleCardDocument) => {
    if (!this.codePath) {
      return;
    }
    let realmPath = new RealmPaths(this.cardService.defaultURL);
    let url = realmPath.fileURL(this.codePath.href.replace(/\.json$/, ''));
    let realmURL = this.readyFile.realmURL;
    if (!realmURL) {
      throw new Error(`cannot determine realm for ${this.codePath}`);
    }

    let doc = this.monacoService.reverseFileSerialization(
      json,
      url.href,
      realmURL,
    );
    let card: CardDef | undefined;
    try {
      card = await this.cardService.createFromSerialized(doc.data, doc, url);
    } catch (e) {
      // TODO probably we should show a message in the UI that the card
      // instance JSON is not actually a valid card
      console.error(
        'JSON is not a valid card--TODO this should be an error message in the code editor',
      );
      return;
    }

    try {
      // these saves can happen so fast that we'll make sure to wait at
      // least 500ms for human consumption
      await all([this.cardService.saveModel(card), timeout(500)]);
      await this.maybeReloadCard.perform(card.id);
    } catch (e) {
      console.error('Failed to save single card document', e);
    }
  });

  private get language(): string | undefined {
    if (this.codePath) {
      const editorLanguages = this.monacoSDK.languages.getLanguages();
      let extension = '.' + this.codePath.href.split('.').pop();
      let language = editorLanguages.find((lang) =>
        lang.extensions?.find((ext) => ext === extension),
      );
      return language?.id ?? 'plaintext';
    }
    return undefined;
  }

  private get isSaving() {
    return (
      this.waitForSourceCodeWrite.isRunning ||
      this.saveFileSerializedCard.isRunning ||
      this.saveCard.isRunning
    );
  }

  @action
  private onListPanelContextChange(listPanelContext: PanelContext[]) {
    this.panelWidths.leftPanel = listPanelContext[0]?.width;
    this.panelWidths.codeEditorPanel = listPanelContext[1]?.width;
    this.panelWidths.rightPanel = listPanelContext[2]?.width;

    localStorage.setItem(CodeModePanelWidths, JSON.stringify(this.panelWidths));
  }

  @action
  private delete() {
    if (this.card) {
      this.args.delete(this.card, () => {
        let recentFile = this.recentFilesService.recentFiles[0];

        if (recentFile) {
          let recentFileUrl = `${recentFile.realmURL}${recentFile.filePath}`;

          this.operatorModeStateService.updateCodePath(new URL(recentFileUrl));
        } else {
          this.operatorModeStateService.updateCodePath(null);
        }
      });
    } else {
      throw new Error(`TODO: non-card instance deletes are not yet supported`);
    }
  }

  private async withTestWaiters<T>(cb: () => Promise<T>) {
    let token = waiter.beginAsync();
    try {
      let result = await cb();
      // only do this in test env--this makes sure that we also wait for any
      // interior card instance async as part of our ember-test-waiters
      if (isTesting()) {
        await this.cardService.cardsSettled();
      }
      return result;
    } finally {
      waiter.endAsync(token);
    }
  }

  <template>
    <div class='code-mode-background' style={{this.backgroundURLStyle}}></div>
    <CardURLBar
      @loadFileError={{this.loadFileError}}
      @resetLoadFileError={{this.resetLoadFileError}}
      @userHasDismissedError={{this.userHasDismissedURLError}}
      @dismissURLError={{this.dismissURLError}}
      @realmInfo={{this.realmInfo}}
      class='card-url-bar'
    />
    <div
      class='code-mode'
      data-test-code-mode
      data-test-save-idle={{and
        this.contentChangedTask.isIdle
        this.maybeReloadCard.isIdle
        this.doWhenCardChanges.isIdle
      }}
    >
      <ResizablePanelGroup
        @onListPanelContextChange={{this.onListPanelContextChange}}
        class='columns'
        as |ResizablePanel|
      >
        <ResizablePanel
          @defaultWidth={{defaultPanelWidths.leftPanel}}
          @width='var(--operator-mode-left-column)'
        >
          <div class='column'>
            {{! Move each container and styles to separate component }}
            <div
              class='inner-container file-view
                {{if (eq this.fileView "browser") "file-browser"}}'
            >
              <header
                class='file-view__header'
                aria-label={{this.fileViewTitle}}
                data-test-file-view-header
              >
                <Button
                  @disabled={{this.emptyOrNotFound}}
                  @kind={{if
                    (eq this.fileView 'inheritance')
                    'primary-dark'
                    'secondary'
                  }}
                  @size='extra-small'
                  class={{cn
                    'file-view__header-btn'
                    active=(eq this.fileView 'inheritance')
                  }}
                  {{on 'click' (fn this.setFileView 'inheritance')}}
                  data-test-inheritance-toggle
                >
                  Inspector</Button>
                <Button
                  @kind={{if
                    (eq this.fileView 'browser')
                    'primary-dark'
                    'secondary'
                  }}
                  @size='extra-small'
                  class={{cn
                    'file-view__header-btn'
                    active=(eq this.fileView 'browser')
                  }}
                  {{on 'click' (fn this.setFileView 'browser')}}
                  data-test-file-browser-toggle
                >
                  File Tree</Button>
              </header>
              <section class='inner-container__content'>
                {{#if (eq this.fileView 'inheritance')}}
                  <section class='inner-container__content'>
                    {{#if this.isReady}}
                      <DetailPanel
                        @cardInstance={{this.card}}
                        @readyFile={{this.readyFile}}
                        @realmInfo={{this.realmInfo}}
                        @selectedElement={{this.selectedElementInFile}}
                        @elements={{this.elementsInFile}}
                        @selectElement={{this.selectElementInFile}}
                        @delete={{this.delete}}
                        data-test-card-inheritance-panel
                      />
                    {{else if this.emptyOrNotFound}}
                      Inspector is not available
                    {{/if}}
                  </section>
                {{else}}
                  <FileTree @realmURL={{this.realmURL}} />
                {{/if}}
              </section>
            </div>
            <aside class='inner-container'>
              <header
                class='inner-container__header'
                aria-label='Recent Files Header'
              >
                Recent Files
              </header>
              <section class='inner-container__content'>
                <RecentFiles />
              </section>
            </aside>
          </div>
        </ResizablePanel>
        {{#if this.codePath}}
          <ResizablePanel
            @defaultWidth={{defaultPanelWidths.codeEditorPanel}}
            @width={{this.panelWidths.codeEditorPanel}}
            @minWidth='300px'
          >
            <div class='inner-container'>
              {{#if this.isReady}}
                {{#if this.readyFile.isBinary}}
                  <BinaryFileInfo @readyFile={{this.readyFile}} />
                {{else}}
                  <div
                    class='monaco-container'
                    data-test-editor
                    {{monacoModifier
                      content=this.readyFile.content
                      contentChanged=(perform this.contentChangedTask)
                      monacoSDK=this.monacoSDK
                      language=this.language
                    }}
                  ></div>
                {{/if}}
                <div class='save-indicator {{if this.isSaving "visible"}}'>
                  {{#if this.isSaving}}
                    <span class='saving-msg'>
                      Now Saving
                    </span>
                    <span class='save-spinner'>
                      <span class='save-spinner-inner'>
                        <LoadingIndicator />
                      </span>
                    </span>
                  {{else}}
                    <span class='saved-msg'>
                      Saved
                    </span>
                    {{svgJar 'check-mark' width='27' height='27'}}
                  {{/if}}
                </div>
              {{else if this.isLoading}}
                <div class='loading'>
                  <LoadingIndicator />
                </div>
              {{/if}}
            </div>
          </ResizablePanel>
          <ResizablePanel
            @defaultWidth={{defaultPanelWidths.rightPanel}}
            @width={{this.panelWidths.rightPanel}}
          >
            <div class='inner-container'>
              {{#if this.isReady}}
                {{#if this.cardIsLoaded}}
                  <CardPreviewPanel
                    @card={{this.loadedCard}}
                    @realmIconURL={{this.realmIconURL}}
                    data-test-card-resource-loaded
                  />
                {{else if this.importedModule.module}}
                  <CardAdoptionChain
                    @file={{this.readyFile}}
                    @importedModule={{this.importedModule.module}}
                  />
                {{else if this.cardError}}
                  {{this.cardError.message}}
                {{else if this.schemaEditorIncompatible}}
                  <div
                    class='binary-file-schema-editor'
                    data-test-binary-file-schema-editor
                  >Schema Editor cannot be used with this file type</div>
                {{/if}}
              {{/if}}
            </div>
          </ResizablePanel>
        {{else}}
          <ResizablePanel
            @defaultWidth={{defaultPanelWidths.emptyCodeModePanel}}
            @width={{this.panelWidths.emptyCodeModePanel}}
          >
            <div
              class='inner-container inner-container--empty'
              data-test-empty-code-mode
            >
              {{svgJar 'file' width='40' height='40' role='presentation'}}
              <h3 class='choose-file-prompt'>
                Choose a file on the left to open it
              </h3>
            </div>
          </ResizablePanel>
        {{/if}}
      </ResizablePanelGroup>
    </div>

    <style>
      :global(:root) {
        --code-mode-padding-top: calc(
          var(--submode-switcher-trigger-height) + (2 * (var(--boxel-sp)))
        );
        --code-mode-padding-bottom: calc(
          var(--search-sheet-closed-height) + (var(--boxel-sp))
        );
      }

      .code-mode {
        height: 100%;
        max-height: 100vh;
        left: 0;
        right: 0;
        z-index: 1;
        padding: var(--code-mode-padding-top) var(--boxel-sp)
          var(--code-mode-padding-bottom);
        overflow: auto;
      }

      .code-mode-background {
        position: fixed;
        left: 0;
        right: 0;
        display: block;
        width: 100%;
        height: 100%;
        filter: blur(15px);
        background-size: cover;
      }

      .columns {
        display: flex;
        flex-direction: row;
        flex-shrink: 0;
        height: 100%;
      }
      .column {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        height: 100%;
      }
      .column:nth-child(2) {
        flex: 2;
      }
      .column:last-child {
        flex: 1.2;
      }
      .column:first-child > *:first-child {
        max-height: 50%;
      }
      .column:first-child > *:last-child {
        max-height: calc(50% - var(--boxel-sp));
        background-color: var(--boxel-200);
      }

      .inner-container {
        height: 100%;
        position: relative;
        display: flex;
        flex-direction: column;
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
        box-shadow: var(--boxel-deep-box-shadow);
        overflow: hidden;
      }
      .inner-container__header {
        padding: var(--boxel-sp-sm) var(--boxel-sp-xs);
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .inner-container__content {
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs) var(--boxel-sp-sm);
        overflow-y: auto;
      }
      .inner-container--empty {
        background-color: var(--boxel-light-100);
        align-items: center;
        justify-content: center;
      }
      .inner-container--empty > :deep(svg) {
        --icon-color: var(--boxel-highlight);
      }

      .choose-file-prompt {
        margin: 0;
        padding: var(--boxel-sp);
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }

      .file-view__header {
        display: flex;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        background-color: var(--boxel-200);
      }
      .file-view__header-btn {
        --boxel-button-border: 1px solid var(--boxel-400);
        --boxel-button-font: 700 var(--boxel-font-xs);
        --boxel-button-letter-spacing: var(--boxel-lsp-xs);
        --boxel-button-min-width: 6rem;
        --boxel-button-padding: 0;
        border-radius: var(--boxel-border-radius);
        flex: 1;
      }
      .file-view__header-btn:hover:not(:disabled) {
        border-color: var(--boxel-dark);
      }
      .file-view__header-btn.active {
        border-color: var(--boxel-dark);
        --boxel-button-text-color: var(--boxel-highlight);
      }

      .file-view.file-browser .inner-container__content {
        background: var(--boxel-light);
      }

      .card-url-bar {
        position: absolute;
        top: var(--boxel-sp);
        left: calc(var(--submode-switcher-width) + (var(--boxel-sp) * 2));

        --card-url-bar-width: calc(
          100% - (var(--submode-switcher-width) + (var(--boxel-sp) * 3))
        );
        height: var(--submode-switcher-height);

        z-index: 2;
      }

      .monaco-container {
        height: 100%;
        min-height: 100%;
        width: 100%;
        min-width: 100%;
        padding: var(--boxel-sp) 0;
      }

      .loading {
        margin: 40vh auto;
      }

      .save-indicator {
        --icon-color: var(--boxel-highlight);
        position: absolute;
        display: flex;
        align-items: center;
        height: 2.5rem;
        width: 140px;
        bottom: 0;
        right: 0;
        background-color: var(--boxel-200);
        padding: 0 var(--boxel-sp-xxs) 0 var(--boxel-sp-sm);
        border-top-left-radius: var(--boxel-border-radius);
        font: var(--boxel-font-sm);
        font-weight: 500;
        transform: translateX(140px);
        transition: all var(--boxel-transition);
        transition-delay: 5s;
      }
      .save-indicator.visible {
        transform: translateX(0px);
        transition-delay: 0s;
      }
      .save-spinner {
        display: inline-block;
        position: relative;
      }
      .save-spinner-inner {
        display: inline-block;
        position: absolute;
        top: -7px;
      }
      .saving-msg {
        margin-right: var(--boxel-sp-sm);
      }
      .saved-msg {
        margin-right: var(--boxel-sp-xxs);
      }
      .binary-file-schema-editor {
        display: flex;
        flex-wrap: wrap;
        align-content: center;
        justify-content: center;
        text-align: center;
        height: 100%;
        background-color: var(--boxel-200);
        font: var(--boxel-font-sm);
        color: var(--boxel-450);
        font-weight: 500;
        padding: var(--boxel-sp-xl);
      }
    </style>
  </template>
}

function getMonacoContent() {
  return (window as any).monaco.editor.getModels()[0].getValue();
}

function comparableSerialization(doc: LooseSingleCardDocument) {
  delete doc.included;
  delete doc.data.links;
  delete (doc.data as any).meta;
  delete doc.data.type;
  delete doc.data.id;
  for (let rel of Object.keys(doc.data.relationships ?? {})) {
    delete doc.data.relationships?.[rel].data;
  }
  return doc;
}

function isCardOrField(cardOrField: any): cardOrField is typeof BaseDef {
  return typeof cardOrField === 'function' && 'baseDef' in cardOrField;
}

function cardsOrFieldsFromModule(
  module: Record<string, any>,
  _never?: never, // glint insists that w/o this last param that there are actually no params
): (typeof BaseDef)[] {
  return Object.values(module).filter(isCardOrField);
}
