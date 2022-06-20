import Component from '@glimmer/component';
import { action } from '@ember/object';
import monaco from '../modifiers/monaco';
import { service } from '@ember/service';
//@ts-ignore cached not available yet in definitely typed
import { tracked, cached } from '@glimmer/tracking';
import LocalRealm from '../services/local-realm';
import SchemaInspector from './schema-inspector';
import CardEditor, { ExistingCardArgs } from './card-editor';
import ImportModule from './import-module';
import FileTree from './file-tree';
import { CardInspector } from '../lib/schema-util';
import { Format } from '../lib/card-api';
import {
  getLangFromFileExtension,
  extendMonacoLanguage,
  languageConfigs
} from '../utils/editor-language';
import { externalsMap, isCardJSON } from '@cardstack/runtime-common';
import type { FileResource } from '../resources/file';

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
        <FileTree @localRealm={{this.localRealm}}
                  @path={{this.args.path}} />
      </div>
      {{#if this.openFile}}
        <div {{monaco content=this.openFile.content
                      language=(getLangFromFileExtension this.openFile.name)
                      contentChanged=this.contentChanged}}></div>
        <div class="preview">
          {{#if (isRunnable this.openFile.name)}}
            <ImportModule @url={{localRealmURL this.openFile.path}}>
              <:ready as |module|>
                <SchemaInspector
                  @url={{localRealmURL this.openFile.path}}
                  @module={{module}}
                  @src={{this.openFile.content}}
                  @inspector={{this.inspector}}
                />
              </:ready>
              <:error as |error|>
                <h2>Encountered {{error.type}} error</h2>
                <pre>{{error.message}}</pre>
              </:error>
            </ImportModule>
          {{else if this.openFileCardJSON}}
            <ImportModule @url={{relativeFrom this.openFileCardJSON.data.meta.adoptsFrom.module (localRealmURL this.openFile.path)}} >
              <:ready as |module|>
                <CardEditor
                  @module={{module}}
                  @card={{this.cardArgs}}
                  @formats={{formats}}
                />
              </:ready>
               <:error as |error|>
                <h2>Encountered {{error.type}} error</h2>
                <pre>{{error.message}}</pre>
              </:error>
            </ImportModule>
          {{else if this.jsonError}}
            <h2>Encountered error parsing JSON</h2>
            <pre>{{this.jsonError}}</pre>
          {{/if}}
        </div>
      {{/if}}
    </div>
  </template>

  @service declare localRealm: LocalRealm;
  @tracked jsonError: string | undefined;
  private inspector = new CardInspector({
    async resolveModule(specifier: string, currentPath: string) {
      if (externalsMap.has(specifier)) {
        specifier = `http://externals/${specifier}`;
      } else {
        let url = new URL(specifier, currentPath);
        specifier = url.href;
      }
      return await import(/* webpackIgnore: true */ specifier);
    },
  });

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
}


function isRunnable(filename: string): boolean {
  return ['.gjs', '.js', '.gts', '.ts'].some(extension => filename.endsWith(extension));
}

function localRealmURL(path: string): string {
  return `http://local-realm${path}`;
}

function relativeFrom(url: string, base: string): string {
  return new URL(url, base).href;
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    Go: typeof Go;
   }
}
