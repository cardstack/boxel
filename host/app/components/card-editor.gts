import Component from '@glimmer/component';
import { render } from '../resources/rendered-card';
//@ts-ignore cached not available yet in definitely typed
import { tracked, cached } from '@glimmer/tracking';
import { Card, Format, serializeCard } from '../lib/card-api';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { moduleURL } from 'runtime-spike/resources/import';
import { action } from '@ember/object';
import isEqual from 'lodash/isEqual';
import { eq } from '../helpers/truth-helpers';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { CardJSON, isCardJSON } from '@cardstack/runtime-common';
import {
  DirectoryEntryRelationship,
} from '@cardstack/runtime-common';
import cloneDeep from 'lodash/cloneDeep';

export interface NewCardArgs {
  type: 'new';
  class: typeof Card;
  name: string;
}
export interface ExistingCardArgs {
  type: 'existing';
  json: CardJSON;
  url: string;
}

interface Signature {
  Args: {
    module: Record<string, typeof Card>;
    formats?: Format[];
    onCancel?: () => void;
    onSave?: (url: string) => void;
    card: NewCardArgs | ExistingCardArgs;
  }
}

export default class Preview extends Component<Signature> {
  <template>
    {{#if this.args.formats}}
      <div>
        Format:
        {{#each this.args.formats as |format|}}
          <button {{on "click" (fn this.setFormat format)}}
            class="format-button {{format}} {{if (eq this.format format) 'selected'}}"
            disabled={{if (eq this.format format) true false}}>
            {{format}}
          </button>
        {{/each}}
      </div>
    {{/if}}

    {{#if this.rendered.component}}
      <this.rendered.component/>
      {{!-- @glint-ignore glint doesn't know about EC task properties --}}
      {{#if this.write.last.isRunning}}
        <span>Saving...</span>
      {{else}}
        {{#if this.isDirty}}
          <div>
            <button data-test-save-card {{on "click" this.save}}>Save</button>
            {{#if (eq this.args.card.type 'new')}}
              <button data-test-cancel-create {{on "click" this.cancel}}>Cancel</button>
            {{else}}
              <button data-test-reset {{on "click" this.reset}}>Reset</button>
            {{/if}}
          </div>
        {{/if}}
      {{/if}}
    {{/if}}
  </template>

  @tracked
  format: Format = this.args.card.type === 'new' ? 'edit' : 'isolated';
  @tracked
  resetTime = Date.now();
  rendered = render(this, () => this.card, () => this.format)

  @cached
  get card() {
    this.resetTime; // just consume this
    if (this.args.card.type === 'new') {
      return new this.args.card.class();
    }
    let cardClass = this.args.module[this.args.card.json.data.meta.adoptsFrom.name];
    return cardClass.fromSerialized(this.args.card.json.data.attributes ?? {});
  }

  get currentJSON() {
    let json;
    if (this.args.card.type === 'new') {
      let mod = moduleURL(this.args.module);
      if (!mod) {
        throw new Error(`can't save card in unknown module.`);
      }
      json = {
        data: serializeCard(this.card, {
          adoptsFrom: {
            module: mod,
            name: this.args.card.name
          }
        })
      };
    } else {
      json = { data: serializeCard(this.card, { adoptsFrom: this.args.card.json.data.meta.adoptsFrom }) };
    }
    if (!isCardJSON(json)) {
      throw new Error(`can't serialize card data for ${JSON.stringify(json)}`);
    }
    return json;
  }

  // i would expect that this finds a new home after we start refactoring and
  // perhaps end up with a card model more similar to the one the compiler uses
  get isDirty() {
    if (this.args.card.type === 'new') {
      return true;
    }
    let json = cloneDeep(this.currentJSON);
    delete (json.data as any).id;

    return !isEqual(json, this.initialComparisonJSON);
  }

  @cached
  get initialComparisonJSON() {
    if (this.args.card.type === 'new') {
      return undefined;
    }

    let json = cloneDeep(this.args.card.json);
    delete (json.data as any).id;
    return json;
  }

  @action
  setFormat(format: Format) {
    this.format = format;
  }

  @action
  reset() {
    if (this.isDirty) {
      this.resetTime = Date.now();
    }
  }

  @action
  cancel() {
    if (this.args.onCancel) {
      this.args.onCancel();
    }
  }

  @action
  async save() {
    taskFor(this.write).perform();
  }

  @restartableTask private async write(): Promise<void> {
    let url = this.args.card.type === 'new' ? 'http://local-realm/' : this.args.card.url;
    let method = this.args.card.type === 'new' ? 'POST' : 'PATCH';
    let response = await fetch(url, {
      method,
      headers: {
        'Accept': 'application/vnd.api+json'
      },
      body: JSON.stringify(this.currentJSON, null, 2)
    });

    if (!response.ok) {
      throw new Error(`could not save file, status: ${response.status} - ${response.statusText}. ${await response.text()}`);
    }
    let json = await response.json();
    if (json.data.links?.self && this.args.onSave) {
      this.args.onSave(json.data.links.self + '.json');
    }
  }
}
