import Component from '@glimmer/component';
import { Card, serializeCard, CardJSON, isCardJSON } from '../lib/card-api';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { moduleURL } from 'runtime-spike/resources/import';
import { render } from 'runtime-spike/resources/rendered-card';
import LocalRealm from '../services/local-realm';
import { service } from '@ember/service';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import type RouterService from '@ember/routing/router-service';

interface Signature {
  Args: {
    cardClass: typeof Card;
    module: Record<string, any>;
    name: string;
    onCancel: () => void;
  }
}

export default class CardCreator extends Component<Signature> {
  <template>
    {{#if this.rendered.component}}
      <this.rendered.component />
      {{!-- @glint-ignore glint doesn't know about EC task properties --}}
      {{#if this.writeAndTransition.last.isRunning}}
        <span>Saving...</span>
      {{else}}
        <button data-test-save-card {{on "click" this.save}}>Save</button>
        <button data-test-cancel-create {{on "click" this.cancel}}>cancel</button>
      {{/if}}
    {{/if}}
  </template>

  private newInstance = new this.args.cardClass();

  @service declare router: RouterService;
  @service declare localRealm: LocalRealm;

  @tracked
  private rendered = render(this, () => this.newInstance, () => 'edit');

  @action
  cancel() {
    this.args.onCancel();
  }

  @action
  async save() {
    let mod = moduleURL(this.args.module);
    if (!mod) {
      throw new Error(`can't save card in unknown module.`);
    }

    let json = {
      data: serializeCard(this.newInstance, {
        adoptsFrom: {
          module: mod,
          name: this.args.name
        }
      })
    };
    if (!isCardJSON(json)) {
      throw new Error(`can't serialize card data for ${JSON.stringify(json)}`);
    }
    taskFor(this.writeAndTransition).perform(this.newInstance.constructor.name, json);
  }

  @restartableTask private async writeAndTransition(cardName: string, json: CardJSON): Promise<void> {
    let dirHandle = await this.localRealm.fsHandle.getDirectoryHandle(cardName, { create: true });
    let fileName = await getNextJSONFileName(dirHandle);
    let handle = await dirHandle.getFileHandle(fileName, { create: true });

    // TypeScript seems to lack types for the writable stream features
    let stream = await (handle as any).createWritable();

    await stream.write(JSON.stringify(json, null, 2));
    await stream.close();

    this.router.transitionTo({ queryParams: { path: `${cardName}/${fileName}` } });
  }
}

async function getNextJSONFileName(dirHandle: FileSystemDirectoryHandle): Promise<string> {
  let index = 0;
  for await (let [name, handle ] of dirHandle as any as AsyncIterable<
    [string, FileSystemDirectoryHandle | FileSystemFileHandle]
  >) {
    if (handle.kind === 'directory') {
      continue;
    }
    if (!/^[\d]+\.json$/.test(name)) {
      continue;
    }
    let num = parseInt(name.replace('.json', ''));
    index = Math.max(index, num);
  }

  return `${++index}.json`;
}