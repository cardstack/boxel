import Component from '@glimmer/component';
import { service } from '@ember/service';
import Render from './render';
//@ts-ignore glint does not think this is consumed-but it is consumed in the template
import { hash } from '@ember/helper';
import { HTMLSnapshot } from '../modifiers/html-snapshot';
import type IndexerService from '../services/indexer-service';

export default class WorkerRender extends Component {
  <template>
    {{#if this.needsRender}}
      <div {{HTMLSnapshot this.card this.format}} class="worker-render">
        <Render @card={{this.card}} @format={{this.format}} @opts={{hash disableShadowDOM=true}}/>
      </div>
    {{/if}}
  </template>

  @service declare indexerService: IndexerService;

  get needsRender() {
    return this.indexerService.card != null && this.indexerService.format != null;
  }
  get card() {
    if (!this.indexerService.card) {
      throw new Error('bug: should never be here');
    }
    return this.indexerService.card;
  }
  get format() {
    if (!this.indexerService.format) {
      throw new Error('bug: should never be here');
    }
    return this.indexerService.format;
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    WorkerRender: typeof WorkerRender;
   }
}