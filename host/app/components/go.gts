import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { action } from '@ember/object';
import monaco from '../modifiers/monaco';
import { service } from '@ember/service';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { tracked } from '@glimmer/tracking';
import { trackedFunction } from 'ember-resources';
import { helper } from '@ember/component/helper';
import { fn } from '@ember/helper';
import * as monacoEditor from 'monaco-editor';


export default class extends Component {
  <template>
    <div class="editor">
      <div class="file-tree">
        {{#if this.localRealm.isAvailable}}
          {{#each this.listing.value as |entry|}}
            {{#if (eq entry.handle.kind 'file')}}
              <div class="item file {{concat 'indent-' entry.indent}}"
                   {{on "click" (fn this.open entry)}}>
                {{entry.name}}
              </div>
            {{else}}
              <div class="item directory {{concat 'indent-' entry.indent}}">
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

  @service localRealm;
  @tracked selectedFile;

  @action
  openRealm() {
    this.localRealm.chooseDirectory();
  }

  @action
  open(handle) {
    this.selectedFile = handle;
    taskFor(this.openFile).perform(handle);
  }

  listing = trackedFunction(this, async () => {
    if (!this.localRealm.isAvailable) {
      return [];
    }
    return getDirectoryEntries(this.localRealm.fsHandle)
  });

  @restartableTask async openFile(entry) {
    let { handle } = entry;
    if (handle.kind !== 'file') {
      throw new Error(`Cannot open the directory ${handle.name} in monaco`);
    }
    let file = await handle.getFile();

    let language = getEditorLanguage(file.name);
    // if (file.type) {
    //   language = file.type.split('/')[1];
    // } else if (file.name.endsWith('.ts')) {
    //   language = 'typescript';
    // } else if (file.name.endsWith('.hbs')) {
    //   language = 'handlebars';
    // } else {
    //   language = 'plaintext';
    // }

    let reader = new FileReader();
    let data = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });

    // Don't really understand what it means to have multiple models--but either
    // way we are editing the first one
    let [ model ] = monacoEditor.editor.getModels();

    monacoEditor.editor.setModelLanguage(model, language);
    model.setValue(data);
  }
}

function getEditorLanguage(fileName) {
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

async function getDirectoryEntries(directoryHandle, dir = ['.']) {
  let entries = [];
  const EXCLUDED_DIRS = ['dist', 'tmp', 'node_modules', '.vscode', '.git'];
  const EXCLUDED_FILES = ['.gitkeep'];
  for await (let [name, handle] of directoryHandle.entries()) {
    if (EXCLUDED_DIRS.includes(name)) {
      continue;
    }
    entries.push({ name, handle, path: [...dir, name].join('/'), indent: dir.length });
    if (handle.kind === 'directory') {
      entries.push(...await getDirectoryEntries(handle, [...dir, name]));
      entries = entries.filter(entry => !EXCLUDED_FILES.includes(entry.name));
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

const concat = helper(([...params]) => params.join(''));
const eq = helper(([a, b]) => a === b);
