import Component from '@glint/environment-ember-loose/glimmer-component';
import { action } from '@ember/object';
import monaco from '../modifiers/monaco';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import * as monacoEditor from 'monaco-editor';
import LocalRealm from '../services/local-realm';
import { directory, Entry } from '../resources/directory';
import { file } from '../resources/file';
import Preview from './preview';
import FileTree from './file-tree';

function getEditorLanguage(fileName: string) {
  const languages = monacoEditor.languages.getLanguages();
  let extension = '.' + fileName.split('.').pop();
  let language = languages.find(lang => {
    if (!lang.extensions || lang.extensions.length === 0) {
      return;
    }
    return lang.extensions.find(ext => ext === extension ? lang : null);
  });

  if (!language) {
    return 'plaintext';
  }
  return language.id;
}

function isRunnable(filename: string): boolean {
  return ['.gjs', '.js', '.gts', '.ts'].some(extension => filename.endsWith(extension));
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    Go: typeof Go;
   }
}

export default class Go extends Component {
  <template>
    <div class="editor">
      <div class="file-tree">
        <FileTree @localRealm={{this.localRealm}}
                  @onSelectedFile={{this.onSelectedFile}} />
      </div>
      {{#if this.openFile.ready}}
        <div {{monaco content=this.openFile.content
                      language=(getEditorLanguage this.openFile.name)
                      contentChanged=this.contentChanged}}></div>
        <div>
          {{#if (isRunnable this.openFile.name)}}
            <Preview @filename={{this.openFile.name}} />
          {{/if}}
        </div>
      {{/if}}              
    </div>
  </template>

  @service declare localRealm: LocalRealm;
  @tracked selectedFile: Entry | undefined;

  @action
  onSelectedFile(entry: Entry | undefined) {
    this.selectedFile = entry;
  }

  @action
  contentChanged(content: string) {
    if (this.openFile.ready && content !== this.openFile.content) {
      this.openFile.write(content);
    }
  }

  listing = directory(this, () => this.localRealm.isAvailable ? this.localRealm.fsHandle : null)

  openFile = file(this, () => {
    if (this.selectedFile) {
      let { handle } = this.selectedFile;
      if (handle.kind !== 'file') {
        throw new Error(`Cannot open the directory ${handle.name} in monaco`);
      }
      return handle;
    }
    return undefined;
  });
}
