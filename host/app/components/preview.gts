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
import LoaderService from '../services/loader-service';
import { importResource } from '../resources/import';
import { eq } from '../helpers/truth-helpers';
import { cardInstance } from '../resources/card-instance';
import {
  LooseCardDocument,
  isCardSingleResourceDocument,
  baseRealm,
  type NewCardArgs,
  type ExistingCardArgs
} from '@cardstack/runtime-common';
import type { Format } from 'https://cardstack.com/base/card-api';
import type LocalRealm from '../services/local-realm';
import { RenderedCard } from 'https://cardstack.com/base/render-card';

type CardAPI = typeof import('https://cardstack.com/base/card-api');
type RenderedCardModule = typeof import('https://cardstack.com/base/render-card');

interface Signature {
  Args: {
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
      {{/if}}
    {{/if}}
  </template>

  @service declare router: RouterService;
  @service declare loaderService: LoaderService;
  @service declare localRealm: LocalRealm;
  @tracked
  format: Format = this.args.card.type === 'new' ? 'edit' : this.args.card.format ?? 'isolated';
  @tracked
  resetTime = Date.now();
  @tracked
  rendered: RenderedCard | undefined;
  @tracked
  initialCardData: LooseCardDocument | undefined;
  @tracked cardError: string | undefined;
  private declare interval: ReturnType<typeof setInterval>;
  private lastModified: number | undefined;
  private apiModule = importResource(
    this,
    () => `${baseRealm.url}card-api`,
    () => this.loaderService.loader
  );
  private renderCardModule = importResource(
    this,
    () => `${baseRealm.url}render-card`,
    () => this.loaderService.loader
  );

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
  get cardInstance() {
    this.resetTime;
    return cardInstance(
      this,
      () => {
        if (this.args.card.type === 'new') {
          if (this.args.card.initialCardResource) {
            return this.args.card.initialCardResource;
          }
          return {
            attributes: {},
            meta: {
              adoptsFrom: {
                ...this.args.card.cardSource
              }
            }
          }
        } else if (this.initialCardData) {
          return this.initialCardData.data;
        }
        return;
      },
      () => this.loaderService.loader
    );
  }

  get card() {
    return this.cardInstance.instance;
  }
  
  private get api() {
    if (!this.apiModule.module) {
      throw new Error(
        `bug: card API has not loaded yet--make sure to await this.loaded before using the api`
      );
    }
    return this.apiModule.module as CardAPI;
  }

  private get renderCard() {
    if (!this.renderCardModule.module) {
      throw new Error(
        `bug: card API has not loaded yet--make sure to await this.loaded before using the api`
      );
    }
    return this.renderCardModule.module as RenderedCardModule;
  }

  private get apiLoaded() {
    return Promise.all([this.apiModule.loaded, this.renderCardModule.loaded]);
  }

  private _currentJSON(includeComputeds: boolean) {
    let json;
    if (this.args.card.type === 'new') {
      if (this.card === undefined) {
        throw new Error('bug: this should never happen');
      }
      json = {
        data: this.api.serializeCard(this.card, { includeComputeds })
      };
    } else {
      if (this.card && this.initialCardData) {
        json = {
          data: this.api.serializeCard(this.card, { includeComputeds })
        };
      } else {
        return undefined;
      }
    }
    if (!isCardSingleResourceDocument(json)) {
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
    await this.apiLoaded;
    if (!this.rendered) {
      this.rendered = this.renderCard.render(this, () => this.card, () => this.format);
    }
  }

  @restartableTask private async loadData(url: string | undefined): Promise<void> {
    if (!url) {
      return;
    }
    await this.apiLoaded;
    if (!this.rendered) {
      this.rendered = this.renderCard.render(this, () => this.card, () => this.format);
    }

    if (this.args.card.type === 'existing' && this.args.card.json) {
      this.initialCardData = await this.getComparableCardJson(this.args.card.json);
      return;
    }

    let response = await this.loaderService.loader.fetch(url, {
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
    if (!isCardSingleResourceDocument(json)) {
      throw new Error(`bug: server returned a non card document to us for ${url}`);
    }
    if (this.lastModified !== json.data.meta.lastModified) {
      this.lastModified = json.data.meta.lastModified;
      this.initialCardData = await this.getComparableCardJson(json);
    }
  }

  @restartableTask private async write(): Promise<void> {
    let url = this.args.card.type === 'new' ? this.args.card.realmURL : this.args.card.url;
    let method = this.args.card.type === 'new' ? 'POST' : 'PATCH';
    let response = await this.loaderService.loader.fetch(url, {
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
    this.initialCardData = await this.getComparableCardJson(this.currentJSON!);

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

  private async getComparableCardJson(json: LooseCardDocument): Promise<LooseCardDocument> {
    let card = await this.api.createFromSerialized(json.data, this.localRealm.url, { loader: this.loaderService.loader });
    return { data: this.api.serializeCard(card) };
  }
}
