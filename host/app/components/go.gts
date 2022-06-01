import Component from '@glimmer/component';
import { action } from '@ember/object';
import monaco from '../modifiers/monaco';
import { service } from '@ember/service';
//@ts-ignore cached not available yet in definitely typed
import { tracked, cached } from '@glimmer/tracking';
import LocalRealm from '../services/local-realm';
import { directory, Entry } from '../resources/directory';
import { file } from '../resources/file';
import SchemaInspector from './schema-inspector';
import CardEditor, { ExistingCardArgs } from './card-editor';
import ImportModule from './import-module';
import FileTree from './file-tree';
import { isCardJSON, Format } from '../lib/card-api';
import {
  getLangFromFileExtension,
  extendMonacoLanguage,
  languageConfigs
} from '../utils/editor-language';

interface Signature {
  Args: {
    path: string | undefined;
    onSelectedFile: (path: string | undefined) => void;
  }
}

const formats: Format[] = ['isolated', 'embedded', 'edit'];

export default class Go extends Component<Signature> {
  <template>
    <div class="editor">
      <div class="file-tree">
        <FileTree @localRealm={{this.localRealm}}
                  @path={{this.args.path}}
                  @onSelectedFile={{this.onSelectedFile}} />
      </div>
      {{#if this.openFile.ready}}
        <div {{monaco content=this.openFile.content
                      language=(getLangFromFileExtension this.openFile.name)
                      contentChanged=this.contentChanged}}></div>
        <div class="preview">
          {{#if (isRunnable this.openFile.name)}}
            <ImportModule @url={{localRealmURL this.openFile.name}}>
              <:ready as |module|>
                <SchemaInspector @module={{module}} />
              </:ready>
              <:error as |error|>
                <h2>Encountered {{error.type}} error</h2>
                <pre>{{error.message}}</pre>
              </:error>
            </ImportModule>
          {{else if this.openFileCardJSON}}
            <ImportModule @url={{relativeFrom this.openFileCardJSON.data.meta.adoptsFrom.module (localRealmURL this.openFile.name)}} >
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
  @tracked selectedFile: Entry | undefined;
  @tracked jsonError: string | undefined;

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);
    languageConfigs.map(lang => extendMonacoLanguage(lang));
  }

  @action
  onSelectedFile(entry: Entry | undefined) {
    this.selectedFile = entry;
    this.args.onSelectedFile(entry?.path);
  }

  @action
  contentChanged(content: string) {
    if (this.openFile.ready && content !== this.openFile.content) {
      this.openFile.write(content);
    }
  }

  listing = directory(this, () => this.localRealm.isAvailable ? this.localRealm.fsHandle : null)

  openFile = file(this,
    () => this.args.path,
    () => this.localRealm.isAvailable ? this.localRealm.fsHandle : undefined,
  );

  @cached
  get openFileCardJSON() {
    this.jsonError = undefined;
    if (this.openFile.ready && this.openFile.name.endsWith('.json')) {
      let maybeCard: any;
      try {
        maybeCard = JSON.parse(this.openFile.content);
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
    if (!this.openFile.ready) {
      throw new Error('No file has been opened yet');
    }
    if (!this.openFileCardJSON) {
      throw new Error('Card JSON is not currently available');
    }
    return {
      type: 'existing',
      json: this.openFileCardJSON,
      filename: this.openFile.name,
    }
  }
}


function isRunnable(filename: string): boolean {
  return ['.gjs', '.js', '.gts', '.ts'].some(extension => filename.endsWith(extension));
}

function localRealmURL(filename: string): string {
  return `http://local-realm/${filename}`;
}

function relativeFrom(url: string, base: string): string {
  return new URL(url, base).href;
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    Go: typeof Go;
   }
}
