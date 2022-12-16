import Component from '@glimmer/component';
import { service } from '@ember/service';
import Render from './render';
import Modifier from 'ember-modifier';
import type WorkerRenderer from '../services/worker-renderer';

export default class WorkerRender extends Component {
  <template>
    {{#if this.needsRender}}
      <div {{HTMLSnapshot}} class="worker-render">
        <Render @card={{this.card}} @format={{this.format}}/>
      </div>
    {{/if}}
  </template>

  @service declare workerRenderer: WorkerRenderer;

  get needsRender() {
    return this.workerRenderer.card != null && this.workerRenderer.format != null;
  }
  get card() {
    if (!this.workerRenderer.card) {
      throw new Error('bug: should never be here');
    }
    return this.workerRenderer.card;
  }
  get format() {
    if (!this.workerRenderer.format) {
      throw new Error('bug: should never be here');
    }
    return this.workerRenderer.format;
  }
}

interface Signature {
  element: HTMLInputElement;
  Args: {
    Positional: []
  }
}

class HTMLSnapshot extends Modifier<Signature> {
  @service declare workerRenderer: WorkerRenderer;
  modify(
    element: HTMLElement,
  ) {
    // hmmmm, this seems to render only once. I'm not seeing re-renders
    // as the workerRenderer.card changes (which I confirmed it is)
    let html = element.outerHTML;
    // This approach cannot see thru a shadow DOM. we'll need to make
    // special tools that will allow us to gather HTML as we descend
    // thru an arbitrary amount of shadow DOM
    console.log(`took snapshot of ${html}`);
    this.workerRenderer.captureSnapshot(html);
  }
}
declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    WorkerRender: typeof WorkerRender;
   }
}