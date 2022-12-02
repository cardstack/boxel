import Component from '@glimmer/component';
import { task } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { tracked } from '@glimmer/tracking';
import CardService from '../services/card-service';
import { service } from '@ember/service';
import type { ComponentLike } from '@glint/template';
import type { Card, Format } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    url: string;
    format: Format;
  }
}

export default class ServerRender extends Component<Signature> {
  <template>
    {{#if this.error}}
      <!--Card Error-->
      <span style="white-space: pre-wrap">{{this.error}}</span>
    {{else}}
      {{#if this.renderedCard}}
        <!--Server Side Rendered Card START-->
        <this.renderedCard/>
        <!--Server Side Rendered Card END-->
      {{/if}}
    {{/if}}
  </template>

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);
    taskFor(this.loadCard).perform(this.args.url, this.args.format);
  }

  @service declare cardService: CardService;
  @tracked error: string | undefined;
  @tracked renderedCard: ComponentLike<{ Args: {}, Blocks: {}}> | undefined;

  // TODO how to get fastboot to respect this promise?
  @task private async loadCard(url: string, format: Format){ 
    let card: Card | undefined;
    try {
      card = await this.cardService.loadModel(url, { absoluteURL: true });
    } catch (e: any) {
      this.error = e.message.replace(/\\n/g, '\n');
      return;
    }
    if (!card) {
      this.error = `Could not load card ${url}`;
    } else {
      this.renderedCard = card.constructor.getComponent(card, format);
    }
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    ServerRender: typeof ServerRender;
   }
}
