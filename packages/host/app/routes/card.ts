import Route from '@ember/routing/route';
import type { ComponentLike } from '@glint/template';
import { service } from '@ember/service';
import ENV from '@cardstack/host/config/environment';
import type CardService from '../services/card-service';

const { ownRealmURL } = ENV;

export default class RenderCard extends Route<
  ComponentLike<{ Args: {}; Blocks: {} }>
> {
  @service declare cardService: CardService;

  async model(params: { path: string }) {
    let { path } = params;
    let url = new URL(`/${path}`, ownRealmURL);
    let instance = await this.cardService.loadModel(url);
    return instance.constructor.getComponent(instance, 'isolated');
  }
}
