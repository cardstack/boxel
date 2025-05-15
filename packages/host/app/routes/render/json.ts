import Route from '@ember/routing/route';

import { service } from '@ember/service';

import { LooseSingleCardDocument } from '@cardstack/runtime-common';

import CardService from '@cardstack/host/services/card-service';

import type { Model as ParentModel } from '../render';

export interface Model {
  payload: LooseSingleCardDocument;
}

export default class RenderRoute extends Route<Model> {
  @service declare cardService: CardService;

  async model() {
    let instance = this.modelFor('render') as ParentModel;
    let payload = await this.cardService.serializeCard(instance, {
      includeComputeds: true,
    });

    return { payload };
  }
}
