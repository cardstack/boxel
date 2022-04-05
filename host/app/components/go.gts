import { on } from '@ember/modifier';
import Component from '@glint/environment-ember-loose/glimmer-component';
import { action } from '@ember/object';
import monaco from '../modifiers/monaco';
import { service } from '@ember/service';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { tracked } from '@glimmer/tracking';
import { trackedFunction } from 'ember-resources';
import Helper, { helper } from '@glint/environment-ember-loose/ember-component/helper';
import { fn } from '@ember/helper';
import * as monacoEditor from 'monaco-editor';
import LocalRealm from '../services/local-realm';

interface Entry { 
  name: string;
  handle: FileSystemDirectoryHandle | FileSystemFileHandle;
  path: string;
  indent: number 
}

async function getDirectoryEntries(directoryHandle: FileSystemDirectoryHandle, dir = ['.']): Promise<Entry[]> {
  let entries: Entry[] = [];
  for await (let [name, handle] of (directoryHandle as any as AsyncIterable<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>)) {
    entries.push({ name, handle, path: [...dir, name].join('/'), indent: dir.length });
    if (handle.kind === 'directory') {
      entries.push(...await getDirectoryEntries(handle, [...dir, name]));
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

const eq = helper(<T>([a,b]: [T, T]): boolean => a === b);

class FakePageTitle extends Helper<{ PositionalArgs: [string]}> {}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    Go: typeof Go;
     'page-title': typeof FakePageTitle
   }
}

export default class Go extends Component {
  <template>
    <div class="editor">
      <div class="file-tree">
        {{#if this.localRealm.isAvailable}}
          <button {{on "click" this.closeRealm}}>Close local realm</button> 
          {{#each this.listing.value as |entry|}}
            {{#if (eq entry.handle.kind 'file')}}
              <div class="item file indent-{{entry.indent}}"
                   {{on "click" (fn this.open entry)}}>
                {{entry.name}}
              </div>
            {{else}}
              <div class="item directory indent-{{entry.indent}}">
                {{entry.name}}/
              </div>
            {{/if}}
          {{/each}}
        {{else if this.localRealm.isLoading }}
          ...
        {{else if this.localRealm.isEmpty}}
          <button {{on "click" this.openRealm}}>Open a local realm</button>
        {{/if}}
      </div>
      {{#if this.selectedFile}}
        <div {{monaco}}></div>
      {{/if}}
    </div>
  </template>

  @service declare localRealm: LocalRealm;
  @tracked selectedFile: Entry | undefined;

  @action 
  openRealm() {
    this.localRealm.chooseDirectory();
  }
  @action
  closeRealm() {
    if (this.localRealm.isAvailable) {
      this.localRealm.close();
      this.selectedFile = undefined;
    }
  }

  @action
  open(handle: Entry) {
    this.selectedFile = handle;
    taskFor(this.openFile).perform(handle);
  }

  listing = trackedFunction(this, async () => {
    if (!this.localRealm.isAvailable) {
      return [];
    }
    return getDirectoryEntries(this.localRealm.fsHandle)
  });

  @restartableTask async openFile(entry: Entry) {
    let { handle } = entry;
    if (handle.kind !== 'file') {
      throw new Error(`Cannot open the directory ${handle.name} in monaco`);
    }
    let file = await handle.getFile();
    let reader = new FileReader();
    let data = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });

    // Don't really understand what it means to have multiple models--but either
    // way we are editing the first one
    let [ model ] = monacoEditor.editor.getModels();

    // TODO we'll probably also wanna set the code language too based on the MIME
    // type/file extension
    model.setValue(data);
  }
}


