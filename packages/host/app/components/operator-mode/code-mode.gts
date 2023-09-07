import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import { action } from '@ember/object';
import MonacoService from '@cardstack/host/services/monaco-service';
import { htmlSafe } from '@ember/template';
import {
  type RealmInfo,
  isCardDocument,
  identifyCard,
  moduleFrom,
  type CodeRef,
} from '@cardstack/runtime-common';
import { maybe } from '@cardstack/host/resources/maybe';
import { Ready, file, isReady } from '@cardstack/host/resources/file';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type MessageService from '@cardstack/host/services/message-service';
import CardService from '@cardstack/host/services/card-service';
import { restartableTask } from 'ember-concurrency';
import { registerDestructor } from '@ember/destroyable';
import CardURLBar from '@cardstack/host/components/operator-mode/card-url-bar';
import CardPreviewPanel from '@cardstack/host/components/operator-mode/card-preview-panel';
import { CardDef } from 'https://cardstack.com/base/card-api';
import { use, resource } from 'ember-resources';
import { TrackedObject } from 'tracked-built-ins';
import CardInheritancePanel from '@cardstack/host/components/operator-mode/card-inheritance-panel';
import { importResource } from '@cardstack/host/resources/import';

interface Signature {
  Args: {};
}

export default class CodeMode extends Component<Signature> {
  @service declare monacoService: MonacoService;
  @service declare cardService: CardService;
  @service declare messageService: MessageService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @tracked loadFileError: string | null = null;
  _cachedRealmInfo: RealmInfo | null = null; // This is to cache realm info during reload after code path change so that realm assets don't produce a flicker when code patch changes and the realm is the same

  private subscription: { url: string; unsubscribe: () => void } | undefined;

  constructor(args: any, owner: any) {
    super(args, owner);
    let url = `${this.cardService.defaultURL}_message`;
    this.subscription = {
      url,
      unsubscribe: this.messageService.subscribe(
        url,
        ({ type, data: dataStr }) => {
          if (type !== 'index') {
            return;
          }
          let card = this.cardResource.value;
          let data = JSON.parse(dataStr);
          if (!card || data.type !== 'incremental') {
            return;
          }
          let invalidations = data.invalidations as string[];
          if (invalidations.includes(card.id)) {
            this.reloadCard.perform();
          }
        },
      ),
    };
    registerDestructor(this, () => {
      this.subscription?.unsubscribe();
    });
  }

  get realmInfo() {
    return this.realmInfoResource.value;
  }

  get backgroundURL() {
    return this.realmInfo?.backgroundURL;
  }

  get backgroundURLStyle() {
    return htmlSafe(`background-image: url(${this.backgroundURL});`);
  }

  get realmIconURL() {
    return this.realmInfo?.iconURL;
  }

  get codePath() {
    return this.operatorModeStateService.state.codePath;
  }

  @action resetLoadFileError() {
    this.loadFileError = null;
  }

  @use realmInfoResource = resource(() => {
    if (
      this.openFile.current?.state === 'ready' &&
      this.openFile.current.realmURL
    ) {
      let realmURL = this.openFile.current.realmURL;

      const state: {
        isLoading: boolean;
        value: RealmInfo | null;
        error: Error | undefined;
        load: () => Promise<void>;
      } = new TrackedObject({
        isLoading: true,
        value: this._cachedRealmInfo,
        error: undefined,
        load: async () => {
          state.isLoading = true;

          try {
            let realmInfo = await this.cardService.getRealmInfoByRealmURL(
              new URL(realmURL),
            );

            if (realmInfo) {
              this._cachedRealmInfo = realmInfo;
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
    } else {
      return new TrackedObject({
        error: null,
        isLoading: false,
        value: this._cachedRealmInfo,
        load: () => Promise<void>,
      });
    }
  });

  openFile = maybe(this, (context) => {
    if (!this.codePath) {
      return undefined;
    }

    return file(context, () => ({
      url: this.codePath!.href,
      onStateChange: (state) => {
        if (state === 'not-found') {
          this.loadFileError = 'File is not found';
        }
      },
    }));
  });

  @use importedModule = resource(() => {
    if (isReady(this.openFile.current)) {
      let f: Ready = this.openFile.current;
      if (f.name.endsWith('.json')) {
        let ref = identifyCard(this.cardResource.value?.constructor);
        if (ref !== undefined) {
          return importResource(this, () => moduleFrom(ref as CodeRef));
        } else {
          return;
        }
      } else {
        return importResource(this, () => f.url);
      }
    } else {
      return undefined;
    }
  });

  private reloadCard = restartableTask(async () => {
    await this.cardResource.load();
  });

  @use cardResource = resource(() => {
    let isFileReady =
      this.openFile.current?.state === 'ready' &&
      this.openFile.current.name.endsWith('.json');
    const state: {
      isLoading: boolean;
      value: CardDef | null;
      error: Error | undefined;
      load: () => Promise<void>;
    } = new TrackedObject({
      isLoading: isFileReady,
      value: null,
      error:
        this.openFile.current?.state == 'not-found'
          ? new Error('File not found')
          : undefined,
      load: async () => {
        state.isLoading = true;
        try {
          let currentlyOpenedFile = this.openFile.current as any;
          let cardDoc = JSON.parse(currentlyOpenedFile.content);
          if (isCardDocument(cardDoc)) {
            let url = currentlyOpenedFile.url.replace(/\.json$/, '');
            state.value = await this.cardService.loadModel(url);
          }
        } catch (error: any) {
          state.error = error;
        } finally {
          state.isLoading = false;
        }
      },
    });

    if (isFileReady) {
      state.load();
    }
    return state;
  });

  <template>
    <div class='code-mode-background' style={{this.backgroundURLStyle}}></div>
    <CardURLBar
      @loadFileError={{this.loadFileError}}
      @resetLoadFileError={{this.resetLoadFileError}}
      @realmInfo={{this.realmInfo}}
      class='card-url-bar'
    />
    <div class='code-mode' data-test-code-mode>
      <div class='columns'>
        <div class='column'>
          {{! Move each container and styles to separate component }}
          <div class='inner-container'>
            <header
              class='inner-container__header'
              aria-label='Inheritance Header'
            >
              Card Inheritance
            </header>
            <section class='inner-container__content'>
              <CardInheritancePanel
                @cardInstance={{this.cardResource.value}}
                @openFile={{this.openFile}}
                @realmInfo={{this.realmInfo}}
                @realmIconURL={{this.realmIconURL}}
                @importedModule={{this.importedModule}}
                data-test-card-inheritance-panel
              />
            </section>
          </div>
          <aside class='inner-container'>
            <header
              class='inner-container__header'
              aria-label='Recent Files Header'
            >
              Recent Files
            </header>
            <section class='inner-container__content'></section>
          </aside>
        </div>
        <div class='column'>
          <div class='inner-container'>
            Code, Open File Status:
            {{! This is to trigger openFile function }}
            {{this.openFile.current.state}}
          </div>
        </div>
        <div class='column'>
          <div class='inner-container'>
            {{#if this.cardResource.value}}
              <CardPreviewPanel
                @card={{this.cardResource.value}}
                @realmIconURL={{this.realmIconURL}}
                data-test-card-resource-loaded
              />
            {{else if this.cardResource.error}}
              {{this.cardResource.error.message}}
            {{/if}}
          </div>
        </div>
      </div>
    </div>

    <style>
      :global(:root) {
        --code-mode-padding-top: calc(
          var(--submode-switcher-trigger-height) + (2 * (var(--boxel-sp)))
        );
        --code-mode-padding-bottom: calc(
          var(--search-sheet-closed-height) + (var(--boxel-sp))
        );
        --code-mode-column-min-width: calc(
          var(--operator-mode-min-width) - 2 * var(--boxel-sp)
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
        gap: var(--boxel-sp-lg);
        height: 100%;
      }
      .column {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        min-width: var(--code-mode-column-min-width);
      }
      .column:nth-child(2) {
        flex: 2;
      }
      .column:last-child {
        flex: 1.2;
      }
      .column:first-child > *:first-child {
        max-height: 50%;
        background-color: var(--boxel-200);
      }
      .column:first-child > *:last-child {
        max-height: calc(50% - var(--boxel-sp));
        background-color: var(--boxel-200);
      }

      .inner-container {
        height: 100%;
        display: flex;
        flex-direction: column;
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
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
    </style>
  </template>
}
