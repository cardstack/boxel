import Modifier from 'ember-modifier';
import { service } from '@ember/service';
import type IndexerService from '../services/indexer-service';

interface Signature {
  element: HTMLInputElement;
  Args: {
    Positional: [...any];
  };
}

export class HTMLSnapshot extends Modifier<Signature> {
  @service declare indexerService: IndexerService;
  modify(element: HTMLElement, [model]: Signature['Args']['Positional']) {
    consume(model);
    let html = element.innerHTML;
    this.indexerService.captureSnapshot(html);
  }
}

function consume(..._obj: any[]) {
  // this is a no-op to facilitate glimmer consumption of the parameters
}
