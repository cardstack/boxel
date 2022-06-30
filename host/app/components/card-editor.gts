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
import { registerDestructor } from '@ember/destroyable';
import { CardJSON, isCardJSON } from '@cardstack/runtime-common';

export interface NewCardArgs {
  type: 'new';
  class: typeof Card;
  name: string;
}
export interface ExistingCardArgs {
  type: 'existing';
  url: string;
  // this is just used for test fixture data. as soon as we
  // have an actual ember service for the API we should just
  //  mock that instead
  json?: CardJSON;
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
  @tracked
  initialCardData: CardJSON | undefined;
  private interval: ReturnType<typeof setInterval>;

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);
    if (this.args.card.type === 'existing') {
      taskFor(this.loadData).perform(this.args.card.url);
    }
    this.interval = setInterval(() => taskFor(this.loadData).perform((this.args.card as any).url ?? ''), 1000);
    registerDestructor(this, () => clearInterval(this.interval));
  }

  @cached
  get card() {
    this.resetTime; // just consume this
    if (this.args.card.type === 'new') {
      return new this.args.card.class();
    }
    if (this.initialCardData) {
      let cardClass = this.args.module[this.initialCardData.data.meta.adoptsFrom.name];
      return cardClass.fromSerialized(this.initialCardData.data.attributes ?? {});
    }
    return undefined;
  }

  get currentJSON() {
    let json;
    if (this.args.card.type === 'new') {
      if (this.card === undefined) {
        throw new Error('bug: this should never happen');
      }
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
      if (this.card && this.initialCardData) {
        json = { data: serializeCard(this.card, { adoptsFrom: this.initialCardData.data.meta.adoptsFrom }) };
      } else {
        return undefined;
      }
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
    if (!this.currentJSON) {
      return false;
    }
    return !isEqual(this.currentJSON, this.initialCardData);
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

  @restartableTask private async loadData(url: string): Promise<void> {
    // this is just for loading fixtures for testing. remove once we
    // have an actual service we can mock
    if (this.args.card.type === 'existing' && this.args.card.json) {
      this.initialCardData = this.args.card.json;
      return;
    }

    let response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.api+json'
      },
    });
    if (!response.ok) {
      throw new Error(`could not load card data: ${response.status} - ${response.statusText}. ${await response.text()}`);
    }
    let json = await response.json();
    delete json.data.links;
    delete json.data.id;
    if (!isCardJSON(json)) {
      throw new Error(`the url ${url} is not card data`);
    }
    this.initialCardData = json;
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
      // this is to notify the application route to load a
      // new source path, so we use the actual .json extension
      this.args.onSave(json.data.links.self + '.json');
    }
  }
}
