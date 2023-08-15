import Component from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { restartableTask, timeout } from 'ember-concurrency';
import { service } from '@ember/service';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';
import { tracked } from '@glimmer/tracking';
import {
  SupportedMimeType,
  isCardDocument,
  isSingleCardDocument,
  logger,
} from '@cardstack/runtime-common';
import { RealmPaths } from '@cardstack/runtime-common/paths';
import type LoaderService from '@cardstack/host/services/loader-service';
import type CardService from '@cardstack/host/services/card-service';
import {
  file,
  FileResource,
  isReady,
  Ready,
} from '@cardstack/host/resources/file';
import CardEditor from '@cardstack/host/components/card-editor';
import Module from './module';
import FileTree from './file-tree';
import type { Card } from 'https://cardstack.com/base/card-api';
import ENV from '@cardstack/host/config/environment';
import momentFrom from 'ember-moment/helpers/moment-from';
import monacoModifier from '@cardstack/host/modifiers/monaco';
import type {
  MonacoSDK,
  IStandaloneCodeEditor,
} from '@cardstack/host/services/monaco-service';
import type { OpenFiles } from '@cardstack/host/controllers/code';
import { maybe } from '@cardstack/host/resources/maybe';

const { ownRealmURL } = ENV;
const log = logger('component:go');

interface Signature {
  Args: {
    openFiles: OpenFiles;
    monaco: MonacoSDK;
    onEditorSetup?(editor: IStandaloneCodeEditor): void;
  };
}

export default class Go extends Component<Signature> {
  <template>
    <div class='main'>
      <div class='main-column'>
        <FileTree @url={{ownRealmURL}} @openFiles={{@openFiles}} />
      </div>
      {{#if (isReady this.openFile.current)}}
        <div class='editor-column'>
          <menu class='editor-menu'>
            <li>
              {{#if this.contentChangedTask.isRunning}}
                <span data-test-saving>⟳ Saving…</span>
              {{else if this.contentChangedTask.lastComplete.isError}}
                <span data-test-save-error>✘</span>
              {{else}}
                <span data-test-saved>✔</span>
              {{/if}}
            </li>
            {{#if this.contentChangedTask.last.isError}}
              <li data-test-failed-to-save>Failed to save</li>
            {{else if this.openFile.current.lastModified}}
              <li data-test-last-edit>Last edit was
                {{momentFrom this.openFile.current.lastModified}}</li>
              <li data-test-editor-lang>Lang: {{this.language}}</li>
            {{/if}}
          </menu>
          <div
            class='editor-container'
            data-test-editor
            {{monacoModifier
              content=this.openFile.current.content
              contentChanged=this.contentChanged
              monacoSDK=@monaco
              language=this.language
              onSetup=@onEditorSetup
            }}
          >
          </div>
        </div>
        <div class='main-column'>
          {{#if this.isRunnable}}
            <Module @file={{this.openFile.current}} />
          {{else if this.openFileCardJSON}}
            {{#if this.card}}
              <CardEditor
                @card={{this.card}}
                @format='isolated'
                @onSave={{this.onSave}}
              />
            {{/if}}
          {{else if this.jsonError}}
            <h2>Encountered error parsing JSON</h2>
            <pre>{{this.jsonError}}</pre>
          {{/if}}
          <button {{on 'click' this.removeFile}}>Delete</button>
        </div>
      {{/if}}

    </div>
    <style>
      .main {
        position: relative;
        display: grid;
        grid-template-columns: 15rem 1fr 1fr;
        min-height: 100vh;
      }

      .main-column {
        padding: var(--boxel-sp);
      }

      .main-column > * + * {
        margin-top: var(--boxel-sp);
      }

      .editor-column {
        display: flex;
        flex-direction: column;
      }

      .editor-menu {
        list-style-type: none;
        padding: 0;
        display: flex;
        gap: var(--boxel-sp-sm);
      }
      .editor-container {
        flex: 1;
      }
    </style>
  </template>

  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @tracked jsonError: string | undefined;
  @tracked card: Card | undefined;

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);
  }

  @action
  contentChanged(content: string) {
    this.contentChangedTask.perform(content);
  }

  contentChangedTask = restartableTask(async (content: string) => {
    await timeout(500);
    if (
      this.openFile.current?.state !== 'ready' ||
      content === this.openFile.current?.content
    ) {
      return;
    }

    let isJSON = this.openFile.current.name.endsWith('.json');
    let json = isJSON && this.safeJSONParse(content);

    // Here lies the difference in how json files and other source code files
    // are treated during editing in the code editor
    if (json && isSingleCardDocument(json)) {
      // writes json instance but doesn't update state of the file resource
      // relies on message service subscription to update state
      await this.saveSingleCardDocument(json);
      return;
    } else {
      //writes source code and updates the state of the file resource
      await this.writeSourceCodeToFile(this.openFile.current, content);
    }
  });

  safeJSONParse(content: string) {
    try {
      return JSON.parse(content);
    } catch (err) {
      log.warn(
        `content for ${this.args.openFiles.path} is not valid JSON, skipping write`,
      );
      return;
    }
  }

  get language(): string | undefined {
    if (this.args.openFiles.path) {
      const editorLanguages = this.args.monaco.languages.getLanguages();
      let extension = '.' + this.args.openFiles.path.split('.').pop();
      let language = editorLanguages.find((lang) =>
        lang.extensions?.find((ext) => ext === extension),
      );
      return language?.id ?? 'plaintext';
    }
    return undefined;
  }

  openFile = maybe(this, (context) => {
    const relativePath = this.args.openFiles.path;
    if (relativePath) {
      return file(context, () => ({
        relativePath,
        realmURL: new RealmPaths(this.cardService.defaultURL).url,
        onStateChange: (state) => {
          if (state === 'not-found') {
            this.args.openFiles.path = undefined;
          }
        },
      }));
    } else {
      return undefined;
    }
  });

  writeSourceCodeToFile(file: FileResource, content: string) {
    if (file.state !== 'ready')
      throw new Error('File is not ready to be written to');

    return file.write(content);
  }

  async saveSingleCardDocument(json: any) {
    let realmPath = new RealmPaths(this.cardService.defaultURL);
    let url = realmPath.fileURL(
      this.args.openFiles.path!.replace(/\.json$/, ''),
    );

    try {
      await this.cardService.saveCardDocument(json, url);
      await this.loadCard.perform(url);
    } catch (e) {
      console.log('Failed to save single card document', e);
    }
  }

  @cached
  get openFileCardJSON() {
    this.jsonError = undefined;
    if (
      this.openFile.current?.state === 'ready' &&
      this.openFile.current.name.endsWith('.json')
    ) {
      let maybeCard: any;
      try {
        maybeCard = JSON.parse(this.openFile.current.content);
      } catch (err: any) {
        this.jsonError = err.message;
        return undefined;
      }
      if (isCardDocument(maybeCard)) {
        let url = this.openFile.current.url.replace(/\.json$/, '');
        if (!url) {
          return undefined;
        }
        this.loadCard.perform(new URL(url));
        return maybeCard;
      }
    }
    return undefined;
  }

  private loadCard = restartableTask(async (url: URL) => {
    this.card = await this.cardService.loadModel(url);
  });

  @action
  onSave(card: Card) {
    this.card = card;
  }

  get path() {
    return this.args.openFiles.path ?? '/';
  }

  get isRunnable(): boolean {
    let filename = this.path;
    return ['.gjs', '.js', '.gts', '.ts'].some((extension) =>
      filename.endsWith(extension),
    );
  }

  @action
  removeFile() {
    if (!this.openFile.current || !('url' in this.openFile.current)) {
      return;
    }
    this.remove.perform(this.openFile.current.url);
  }

  private remove = restartableTask(async (url: string) => {
    let headersAccept = this.openFileCardJSON
      ? SupportedMimeType.CardJson
      : SupportedMimeType.CardSource;
    url = this.openFileCardJSON ? url.replace(/\.json$/, '') : url;
    let response = await this.loaderService.loader.fetch(url, {
      method: 'DELETE',
      headers: { Accept: headersAccept },
    });
    if (!response.ok) {
      throw new Error(
        `could not delete file, status: ${response.status} - ${
          response.statusText
        }. ${await response.text()}`,
      );
    }
  });
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'Editor::Go': typeof Go;
  }
}
