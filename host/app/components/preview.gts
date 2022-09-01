import Component from '@glimmer/component';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import isEqual from 'lodash/isEqual';
import { restartableTask, task } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { registerDestructor } from '@ember/destroyable';
import { service } from '@ember/service';
import RouterService from '@ember/routing/router-service';
import type { Card, Format } from 'https://cardstack.com/base/card-api';
import {
  CardJSON,
  isCardJSON,
  isCardDocument,
  Loader,
  type NewCardArgs,
  type ExistingCardArgs
} from '@cardstack/runtime-common';

import CardAPI, { RenderedCard } from '../services/card-api';
import { eq } from '../helpers/truth-helpers';

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
    {{#if this.cardError}}
      <h1>Error: {{this.cardError}}</h1>
    {{else}}
      {{#if @formats}}
        <div>
          Format:
          {{#each @formats as |format|}}
            {{!-- template-lint-disable require-button-type --}}
            <button {{on "click" (fn this.setFormat format)}}
              class="format-button {{format}} {{if (eq this.format format) 'selected'}}"
              disabled={{if (eq this.format format) true false}}>
              {{format}}
            </button>
          {{/each}}
        </div>
      {{/if}}

      {{#if this.renderedCard}}
        <div class="card">
          <this.renderedCard/>
          {{!-- @glint-ignore glint doesn't know about EC task properties --}}
          {{#if this.write.last.isRunning}}
            <span data-test-saving>Saving...</span>
          {{else}}
            {{#if this.isDirty}}
              <div>
                <button data-test-save-card {{on "click" this.save}}>Save</button>
                {{#if (eq @card.type "new")}}
                  <button data-test-cancel-create {{on "click" this.cancel}}>Cancel</button>
                {{else}}
                  <button data-test-reset {{on "click" this.reset}}>Reset</button>
                {{/if}}
              </div>
            {{/if}}
          {{/if}}
        </div>
      {{/if}}
    {{/if}}
  </template>

  @service declare router: RouterService;
  @service declare cardAPI: CardAPI;
  @tracked
  format: Format = this.args.card.type === 'new' ? 'edit' : this.args.card.format ?? 'isolated';
  @tracked
  resetTime = Date.now();
  @tracked
  rendered: RenderedCard | undefined;
  @tracked
  initialCardData: CardJSON | undefined;
  @tracked cardError: string | undefined;
  private declare interval: ReturnType<typeof setInterval>;
  private lastModified: number | undefined;

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);
    if (this.args.card.type === 'existing') {
      taskFor(this.loadData).perform(this.args.card.url);
      this.interval = setInterval(() => taskFor(this.loadData).perform((this.args.card as any).url), 1000);
    } else {
      taskFor(this.prepareNewInstance).perform();
    }
    registerDestructor(this, () => clearInterval(this.interval));
  }

  @cached
  get card() {
    this.resetTime; // just consume this
    if (this.args.card.type === 'new') {
      let cardClass = this.args.module[this.args.card.cardSource.name];
      return new cardClass(this.args.card.initialAttributes);
    }
    if (this.initialCardData) {
      let cardClass = this.args.module[this.initialCardData.data.meta.adoptsFrom.name];
      return cardClass.fromSerialized(this.initialCardData.data.attributes ?? {});
    }
    return undefined;
  }

  private _currentJSON(includeComputeds: boolean) {
    let json;
    if (this.args.card.type === 'new') {
      if (this.card === undefined) {
        throw new Error('bug: this should never happen');
      }
      json = {
        data: this.cardAPI.api.serializeCard(this.card, {
          adoptsFrom: this.args.card.cardSource,
          includeComputeds
        })
      };
    } else {
      if (this.card && this.initialCardData) {
        json = {
          data: this.cardAPI.api.serializeCard(this.card, {
            adoptsFrom: this.initialCardData.data.meta.adoptsFrom,
            includeComputeds
          })
        };
      } else {
        return undefined;
      }
    }
    if (!isCardJSON(json)) {
      throw new Error(`can't serialize card data for ${JSON.stringify(json)}`);
    }
    return json;
  }

  @cached
  get currentJSON() {
    return this._currentJSON(true);
  }

  @cached
  get comparableCurrentJSON() {
    return this._currentJSON(false);
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
    return !isEqual(this.initialCardData, this.comparableCurrentJSON);
  }

  get renderedCard() {
    return this.rendered?.component
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
  save() {
    taskFor(this.write).perform();
  }

  @task private async prepareNewInstance(): Promise<void> {
    await this.cardAPI.loaded;
    if (!this.rendered) {
      this.rendered = this.cardAPI.render(this, () => this.card, () => this.format);
    }
  }

  @restartableTask private async loadData(url: string | undefined): Promise<void> {
    if (!url) {
      return;
    }
    await this.cardAPI.loaded;
    if (!this.rendered) {
      this.rendered = this.cardAPI.render(this, () => this.card, () => this.format);
    }

    if (this.args.card.type === 'existing' && this.args.card.json) {
      this.initialCardData = this.getComparableCardJson(this.args.card.json);
      return;
    }

    let response = await Loader.fetch(url, {
      headers: {
        'Accept': 'application/vnd.api+json'
      },
    });
    let json = await response.json();
    if (!response.ok) {
      this.cardError = (json.errors as string[]).join();
      return;
    } 
    this.cardError = undefined;
    if (!isCardDocument(json)) {
      throw new Error(`bug: server returned a non card document to us for ${url}`);
    }
    if (this.lastModified !== json.data.meta.lastModified) {
      this.lastModified = json.data.meta.lastModified;
      this.initialCardData = this.getComparableCardJson(json);
    }
  }

  @restartableTask private async write(): Promise<void> {
    let url = this.args.card.type === 'new' ? this.args.card.realmURL : this.args.card.url;
    let method = this.args.card.type === 'new' ? 'POST' : 'PATCH';
    let response = await Loader.fetch(url, {
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

    // reset our dirty checking to be detect dirtiness from the
    // current JSON to reflect save that just happened
    this.initialCardData = this.getComparableCardJson(this.currentJSON!);

    if (json.data.links?.self) {
      // this is to notify the application route to load a
      // new source path, so we use the actual .json extension
      this.doSave(json.data.links.self + '.json');
    }
  }

  doSave(path: string) {
    if (this.args.onSave) {
      this.args.onSave(path);
    } else {
      this.setFormat('isolated')
    }
  }

  private getComparableCardJson(json: CardJSON): CardJSON {
    let CardClass = this.args.module[json.data.meta.adoptsFrom.name] as typeof Card;
    let card = CardClass.fromSerialized(json.data.attributes);
    let result = { data: this.cardAPI.api.serializeCard(card, { adoptsFrom: json.data.meta.adoptsFrom }) };
    if (!isCardJSON(result)) {
      throw new Error(`bug: card serialization resulted in non-Card JSON`);
    }
    return result;
  }
}
