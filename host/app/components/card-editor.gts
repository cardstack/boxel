import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { service } from '@ember/service';
import LoaderService from '../services/loader-service';
import type LocalRealm from '../services/local-realm';
import { importResource } from '../resources/import';
import { baseRealm } from '@cardstack/runtime-common';
import type { Card, Format } from 'https://cardstack.com/base/card-api';
import FormatPicker from './format-picker';
import Preview from './preview';

type CardAPI = typeof import('https://cardstack.com/base/card-api');

interface Signature {
  Args: {
    card: Card;
    format?: Format;
    onCancel?: () => void;
    onSave?: (card: Card) => void;
  }
}

const formats: Format[] = ['isolated', 'embedded', 'edit'];

export default class CardEditor extends Component<Signature> {
  <template>
    <FormatPicker
      @formats={{this.formats}}
      @format={{this.format}}
      @setFormat={{this.setFormat}}
    />
    <Preview
      @format={{this.format}}
      @card={{@card}}
    />
    {{!-- @glint-ignore glint doesn't know about EC task properties --}}
    {{#if this.write.last.isRunning}}
      <span data-test-saving>Saving...</span>
    {{else}}
      <div>
        <button data-test-save-card {{on "click" this.save}} type="button">Save</button>
        {{#if @onCancel}}
          <button data-test-cancel-create {{on "click" @onCancel}} type="button">Cancel</button>
        {{/if}}
      </div>
    {{/if}}
  </template>

  formats = formats;
  @service declare loaderService: LoaderService;
  @service declare localRealm: LocalRealm;
  @tracked format: Format = this.args.format ?? 'edit';
  private apiModule = importResource(this, () => `${baseRealm.url}card-api`);

  private get api() {
    if (!this.apiModule.module) {
      throw new Error(
        `bug: card API has not loaded yet--make sure to await this.loaded before using the api`
      );
    }
    return this.apiModule.module as CardAPI;
  }

  @action
  setFormat(format: Format) {
    this.format = format;
  }

  @action
  save() {
    taskFor(this.write).perform();
  }

  @restartableTask private async write(): Promise<void> {
    let url = this.args.card.id ?? this.localRealm.url;
    let method = this.args.card.id ? 'PATCH' : 'POST';

    await this.apiModule.loaded;
    let currentJSON = this.api.serializeCard(this.args.card, { includeComputeds: true });

    let response = await this.loaderService.loader.fetch(url, {
      method,
      headers: {
        'Accept': 'application/vnd.api+json'
      },
      body: JSON.stringify(currentJSON, null, 2)
    });

    if (!response.ok) {
      throw new Error(`could not save file, status: ${response.status} - ${response.statusText}. ${await response.text()}`);
    }
    let json = await response.json();
    let card = await this.api!.createFromSerialized(json.data, this.localRealm.url, { loader: this.loaderService.loader });
    this.args.onSave?.(card);
  }
}
