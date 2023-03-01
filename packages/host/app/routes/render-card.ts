import Route from '@ember/routing/route';
import type { ComponentLike } from '@glint/template';
import { service } from '@ember/service';
import ENV from '@cardstack/host/config/environment';
import type CardService from '../services/card-service';

const { demoRealmURL } = ENV;

export default class RenderCard extends Route<
  ComponentLike<{ Args: {}; Blocks: {} }>
> {
  @service declare cardService: CardService;

  async model(params: { path: string }) {
    let { path } = params;
    let url = new URL(path, demoRealmURL ?? 'http://local-realm/');
    let instance = await this.cardService.loadModel(url);
    return instance.constructor.getComponent(instance, 'isolated');
  }
}
