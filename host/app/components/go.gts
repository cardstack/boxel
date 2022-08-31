import Component from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { service } from '@ember/service';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';
import { tracked } from '@glimmer/tracking';
import { isCardJSON, Loader, type ExistingCardArgs } from '@cardstack/runtime-common';
import type { Format } from "https://cardstack.com/base/card-api";

import LocalRealm from '../services/local-realm';
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

interface Signature {
  Args: {
    openFile: FileResource | undefined;
    path: string | undefined
  }
}

const formats: Format[] = ['isolated', 'embedded', 'edit'];

export default class Go extends Component<Signature> {
  <template>
    <div class="editor">
      <div class="file-tree">
        <FileTree @localRealm={{this.localRealm}} @path={{@path}} />
      </div>
      {{#if this.openFile}}
        <div {{monaco content=this.openFile.content
                      language=(getLangFromFileExtension this.openFile.name)
                      contentChanged=this.contentChanged}}></div>
        <div class="preview">
          {{#if (isRunnable this.openFile.name)}}
            <Module @url={{this.openFile.url}} />
          {{else if this.openFileCardJSON}}
            <CardEditor
              @moduleURL={{relativeFrom this.openFileCardJSON.data.meta.adoptsFrom.module this.openFile.url}}
              @cardArgs={{this.cardArgs}}
              @formats={{this.formats}}
            />
          {{else if this.jsonError}}
            <h2>Encountered error parsing JSON</h2>
            <pre>{{this.jsonError}}</pre>
          {{/if}}
          <button type="button" {{on "click" this.removeFile}}>Delete</button>
        </div>
      {{/if}}
    </div>
  </template>

  formats = formats;
  @service declare localRealm: LocalRealm;
  @tracked jsonError: string | undefined;

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);
    languageConfigs.map(lang => extendMonacoLanguage(lang));
  }

  @action
  contentChanged(content: string) {
    if (this.args.openFile?.state === 'ready' && content !== this.args.openFile.content) {
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
      } catch(err) {
        this.jsonError = err.message;
        return undefined;
      }
      if (isCardJSON(maybeCard)) {
        return maybeCard;
      }
    }
    return undefined;
  }

  get cardArgs(): ExistingCardArgs {
    if (this.args.openFile?.state !== 'ready') {
      throw new Error('No file has been opened yet');
    }
    if (!this.openFileCardJSON) {
      throw new Error('Card JSON is not currently available');
    }
    return {
      type: 'existing',
      url: this.args.openFile.url.replace(/\.json$/, ''),
    }
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
    let response = await Loader.fetch(url, { method: 'DELETE', headers: { 'Accept': headersAccept }});
    if (!response.ok) {
      throw new Error(`could not delete file, status: ${response.status} - ${response.statusText}. ${await response.text()}`);
    }
  }
}

function isRunnable(filename: string): boolean {
  return ['.gjs', '.js', '.gts', '.ts'].some(extension => filename.endsWith(extension));
}

function relativeFrom(url: string, base: string): string {
  return new URL(url, base).href;
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    Go: typeof Go;
   }
}
