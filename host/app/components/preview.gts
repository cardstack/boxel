import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { task } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { importResource } from '../resources/import';
import { baseRealm } from '@cardstack/runtime-common';
import type { Format } from 'https://cardstack.com/base/card-api';
import { RenderedCard } from 'https://cardstack.com/base/render-card';
import type { Card } from 'https://cardstack.com/base/card-api';

type RenderedCardModule = typeof import('https://cardstack.com/base/render-card');

interface Signature {
  Args: {
    card: Card;
    format?: Format;
  }
}

export default class Preview extends Component<Signature> {
  <template>
    {{#if this.renderedCard}}
      <this.renderedCard/>
    {{/if}}
  </template>

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
    return this.rendered?.component;
  }

  @task private async renderInstance(): Promise<void> {
    await this.renderCardModule.loaded;
    if (!this.rendered) {
      this.rendered = this.renderCard.render(this, () => this.args.card, () => this.args.format ?? 'isolated');
    }
  }
}
