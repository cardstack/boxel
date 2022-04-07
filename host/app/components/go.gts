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
import { task, } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';

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

interface Args {

  Args: {
    initialFile: string | undefined;
    onSelectedFile: (filename: string | undefined) => void;
  }
}

export default class Go extends Component<Args> {
  <template>
    <div class="editor">
      <div class="file-tree">
        <FileTree @localRealm={{this.localRealm}}
                  @initialFile={{this.args.initialFile}}
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

  constructor(owner: unknown, args: Args ) {
    super(owner, args as any); // unsure if the glint wrapped component's types are lining up, `Args` doesn't work here
    if (this.args.initialFile) {
      taskFor(this.loadInitialFile).perform(this.args.initialFile);
    }
  }

  @task private async loadInitialFile(path: string) {
    await Promise.resolve();
    await this.localRealm.startedUp;
    if (this.localRealm.isAvailable) {
      let handle: FileSystemFileHandle | undefined;
      try {
        handle = await this.localRealm.fsHandle.getFileHandle(path);
      } catch (err: unknown) {
        if ((err as DOMException).name === 'NotFoundError') {
          console.error(`${path} was not found in the local realm`);
          return;
        }
        throw err;
      }
      this.selectedFile = {
        handle,
        name: handle.name,
        path,
        indent: path.split('/').length
      }
    }
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
