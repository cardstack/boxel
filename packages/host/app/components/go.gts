import Component from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { service } from '@ember/service';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';
import { tracked } from '@glimmer/tracking';
import { isCardDocument, isSingleCardDocument } from '@cardstack/runtime-common';
import { RealmPaths } from '@cardstack/runtime-common/paths';
import type LoaderService from '../services/loader-service';
import type CardService from '../services/card-service';
import type { FileResource } from '../resources/file';
import CardEditor from './card-editor';
import Module from './module';
import FileTree from './file-tree';
import {
  getLangFromFileExtension,
  extendMonacoLanguage,
  languageConfigs
} from '../utils/editor-language';
import monaco from '../modifiers/monaco';
import type { Card } from 'https://cardstack.com/base/card-api';
import InLocalRealm from './in-local-realm';
import log from 'loglevel';
import ENV from '@cardstack/host/config/environment';

const { demoRealmURL } = ENV;

interface Signature {
  Args: {
    openFile: FileResource | undefined;
    openDirs: string[];
    path: string | undefined;
  }
}

export default class Go extends Component<Signature> {
  <template>
    <div class="main">
      <div class="main__column">
        {{#if demoRealmURL}}
          <FileTree @url={{demoRealmURL}} @openFile={{@path}} @openDirs={{@openDirs}} />
        {{else}}
          <InLocalRealm as |url|>
            <FileTree @url={{url}} @openFile={{@path}} @openDirs={{@openDirs}} />
          </InLocalRealm>
        {{/if}}
      </div>
      {{#if this.openFile}}
        <div {{monaco content=this.openFile.content
                      language=(getLangFromFileExtension this.openFile.name)
                      contentChanged=this.contentChanged}}>
        </div>
        <div class="main__column">
          {{#if (isRunnable this.openFile.name)}}
            <Module @file={{this.openFile}}/>
          {{else if this.openFileCardJSON}}
            {{#if this.card}}
              <CardEditor
                @card={{this.card}}
                @format="isolated"
                @onSave={{this.onSave}}
              />
            {{/if}}
          {{else if this.jsonError}}
            <h2>Encountered error parsing JSON</h2>
            <pre>{{this.jsonError}}</pre>
          {{/if}}
          <button type="button" {{on "click" this.removeFile}}>Delete</button>
        </div>
      {{/if}}
    </div>
  </template>

  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @tracked jsonError: string | undefined;
  @tracked card: Card | undefined;

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);
    languageConfigs.map(lang => extendMonacoLanguage(lang));
  }

  @action
  contentChanged(content: string) {
    if (this.args.openFile?.state === 'ready' && content !== this.args.openFile.content) {
      // if the file is a card instance, then use the card-service to update the content
      if (this.args.openFile.name.endsWith('.json')) {
        let json: any;
        try {
          json = JSON.parse(content);
        } catch (err) {
          log.warn(`content for ${this.args.path} is not valid JSON, skipping write`);
          return;
        }
        if (isSingleCardDocument(json)) {
          let realmPath = new RealmPaths(this.cardService.defaultURL);
          let url = realmPath.fileURL(this.args.path!.replace(/\.json$/, ''));
          // note: intentionally not awaiting this promise, we may want to keep track of it...
          this.cardService.saveCardDocument(json, url);
          return
        }
      }
      this.args.openFile.write(content);
    }
  }

  @cached
  get openFileCardJSON() {
    this.jsonError = undefined;
    if (this.args.openFile?.state === 'ready' && this.args.openFile.name.endsWith('.json')) {
      let maybeCard: any;
      try {
        maybeCard = JSON.parse(this.args.openFile.content);
      } catch(err: any) {
        this.jsonError = err.message;
        return undefined;
      }
      if (isCardDocument(maybeCard)) {
        let url = this.args.openFile?.url.replace(/\.json$/, '');
        if (!url) {
          return undefined;
        }
        taskFor(this.loadCard).perform(new URL(url));
        return maybeCard;
      }
    }
    return undefined;
  }

  @restartableTask private async loadCard(url: URL): Promise<void> {
    this.card = await this.cardService.loadModel(url);
  }

  @action
  onSave(card: Card) {
    this.card = card;
  }

  get openFile() {
    if (this.args.openFile?.state !== 'ready') {
      return undefined;
    }
    return this.args.openFile;
  }

  get path() {
    return this.args.path ?? '/';
  }

  @action
  removeFile() {
    if (!this.openFile) { return; }
    taskFor(this.remove).perform(this.openFile.url);
  }

  @restartableTask private async remove(url: string): Promise<void> {
    let headersAccept = this.openFileCardJSON ? 'application/vnd.api+json' : 'application/vnd.card+source';
    url = this.openFileCardJSON ? url.replace(/\.json$/, '') : url;
    let response = await this.loaderService.loader.fetch(url, { method: 'DELETE', headers: { 'Accept': headersAccept }});
    if (!response.ok) {
      throw new Error(`could not delete file, status: ${response.status} - ${response.statusText}. ${await response.text()}`);
    }
  }
}

function isRunnable(filename: string): boolean {
  return ['.gjs', '.js', '.gts', '.ts'].some(extension => filename.endsWith(extension));
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    Go: typeof Go;
   }
}
