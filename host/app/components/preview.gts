import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { task } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { importResource } from '../resources/import';
import { baseRealm } from '@cardstack/runtime-common';
import type { Format } from 'https://cardstack.com/base/card-api';
import { RenderedCard } from 'https://cardstack.com/base/render-card';
import FormatPicker from './format-picker';
import type { Card } from 'https://cardstack.com/base/card-api';

type RenderedCardModule = typeof import('https://cardstack.com/base/render-card');

interface Signature {
  Args: {
    formats?: Format[];
    selectedFormat?: Format;
    card: Card;
  }
}

export default class Preview extends Component<Signature> {
  <template>
    {{#if @formats}}
      <FormatPicker
        @formats={{@formats}}
        @selectedFormat={{this.format}}
        @setFormat={{this.setFormat}}
      />
    {{/if}}
    {{#if this.renderedCard}}
      <this.renderedCard/>
    {{/if}}
  </template>

  @tracked format: Format = this.args.selectedFormat ?? 'isolated';
  @tracked rendered: RenderedCard | undefined;
  private renderCardModule = importResource(this, () => `${baseRealm.url}render-card`);

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);
    taskFor(this.renderInstance).perform();
  }

  private get renderCard() {
    if (!this.renderCardModule.module) {
      throw new Error(
        `bug: card API has not loaded yet--make sure to await this.loaded before using the api`
      );
    }
    return this.renderCardModule.module as RenderedCardModule;
  }

  get renderedCard() {
    return this.rendered?.component
  }

  @action
  setFormat(format: Format) {
    this.format = format;
  }

  @task private async renderInstance(): Promise<void> {
    await this.renderCardModule.loaded;
    if (!this.rendered) {
      this.rendered = this.renderCard.render(this, () => this.args.card, () => this.format);
    }
  }
}
