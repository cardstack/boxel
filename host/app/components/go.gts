import Component from '@glimmer/component';
import { action } from '@ember/object';
import monaco from '../modifiers/monaco';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import LocalRealm from '../services/local-realm';
import { directory, Entry } from '../resources/directory';
import { file } from '../resources/file';
import Preview from './preview';
import FileTree from './file-tree';
import {
  getLangFromFileExtension,
  extendMonacoLanguage,
  languageConfigs
} from '../utils/editor-language';

interface Signature {
  Args: {
    file: string | undefined;
    onSelectedFile: (filename: string | undefined) => void;
  }
}

export default class Go extends Component<Signature> {
  <template>
    <div class="editor">
      <div class="file-tree">
        <FileTree @localRealm={{this.localRealm}}
                  @file={{this.args.file}}
                  @onSelectedFile={{this.onSelectedFile}} />
      </div>
      {{#if this.openFile.ready}}
        <div {{monaco content=this.openFile.content
                      language=(getLangFromFileExtension this.openFile.name)
                      contentChanged=this.contentChanged}}></div>
        <div class="preview">
          {{#if (isRunnable this.openFile.name)}}
            <Preview @filename={{this.openFile.name}} />
          {{/if}}
        </div>
      {{/if}}
    </div>
  </template>

  @service declare localRealm: LocalRealm;
  @tracked selectedFile: Entry | undefined;

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);
    languageConfigs.map(lang => extendMonacoLanguage(lang));
  }

  @action
  onSelectedFile(entry: Entry | undefined) {
    this.selectedFile = entry;
    this.args.onSelectedFile(entry?.name);
  }

  @action
  contentChanged(content: string) {
    if (this.openFile.ready && content !== this.openFile.content) {
      this.openFile.write(content);
    }
  }

  listing = directory(this, () => this.localRealm.isAvailable ? this.localRealm.fsHandle : null)

  openFile = file(this,
    () => this.args.file,
    () => this.localRealm.isAvailable ? this.localRealm.fsHandle : undefined,
  );
}

function isRunnable(filename: string): boolean {
  return ['.gjs', '.js', '.gts', '.ts'].some(extension => filename.endsWith(extension));
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    Go: typeof Go;
   }
}
