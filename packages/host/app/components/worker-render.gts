import Component from '@glimmer/component';
import { service } from '@ember/service';
import Render from './render';
import Modifier from 'ember-modifier';
//@ts-ignore glint does not think this is consumed-but it is consumed in the template
import { hash } from '@ember/helper';
import type WorkerRenderer from '../services/worker-renderer';
import type { Card, Format } from 'https://cardstack.com/base/card-api';

export default class WorkerRender extends Component {
  <template>
    {{#if this.needsRender}}
      <div {{HTMLSnapshot this.card this.format}} class="worker-render">
        <Render @card={{this.card}} @format={{this.format}} @opts={{hash disableShadowDOM=true}}/>
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
    Positional: [
      Card,
      Format
    ]
  }
}

class HTMLSnapshot extends Modifier<Signature> {
  @service declare workerRenderer: WorkerRenderer;
  modify(
    element: HTMLElement,
    [card, format]: Signature["Args"]["Positional"]
  ) {
    consume(card, format);
    let html = element.outerHTML;
    this.workerRenderer.captureSnapshot(html);
  }
}
declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    WorkerRender: typeof WorkerRender;
   }
}

function consume(..._obj: any[]) {
  // this is a no-op to facilitate glimmer consumption of the parameters
}