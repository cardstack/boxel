import Component from '@glimmer/component';
// import Modifier from 'ember-modifier';
import { service } from '@ember/service';
import Render from './render';
//@ts-ignore glint does not think this is consumed-but it is consumed in the template
import { hash } from '@ember/helper';
import Serializer from '@simple-dom/serializer';
import voidMap from '@simple-dom/void-map';
import type IndexerService from '../services/indexer-service';
import type { SimpleDocument } from '@simple-dom/interface';

export default class WorkerRender extends Component {
  <template>
    {{#if this.indexerService.card}}
      <div class="worker-render">
        <Render @card={{this.indexerService.card}} @format="isolated" @opts={{hash disableShadowDOM=true}}/>
      </div>
    {{/if}}
  </template>

  @service declare indexerService: IndexerService;
  document = service('-document') as unknown as SimpleDocument;
  // @service('-document') document;

  constructor(owner: unknown, args: any) {
    super(owner, args);
    debugger;
    // TODO hopefully this.document contains this component (???)
    let serializer = new Serializer(voidMap);
    let html = serializer.serialize(this.document); // TODO use simple DOM to get this component's element instead of using whole doc
    // TODO use our tokens to trim out our card's HTML from the document
    this.indexerService.captureSnapshot(html);
  
    // TODO when this.args.card changes, does that trigger a new
    // WorkerRender component? if not how weill we hook into the 
    // change to be able to call captureHTML again?
  }
}
    

// interface Signature {
//   element: HTMLInputElement;
//   Args: {
//     Positional: [...any];
//   };
// }

// class HTMLSnapshot extends Modifier<Signature> {
//   @service declare indexerService: IndexerService;
//   modify(element: HTMLElement, [model]: Signature['Args']['Positional']) {
//     consume(model);
//     let html = element.innerHTML;
//     this.indexerService.captureSnapshot(html);
//   }
// }

// function consume(..._obj: any[]) {
//   // this is a no-op to facilitate glimmer consumption of the parameters
// }

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    WorkerRender: typeof WorkerRender;
   }
}