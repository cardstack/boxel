import Route from '@ember/routing/route';
import { service } from '@ember/service';
import CardService from '../services/card-service';
import type { Card, Format } from 'https://cardstack.com/base/card-api';

interface Model {
  card: Card;
  format: Format;
}

interface ModelArgs {
  url: string;
}

// TODO i think this actually goes away after we refactor the browser for card pre-rendering...
export default class Render extends Route<Model> {
  @service declare cardService: CardService;

  async model(_params: ModelArgs, transition: any): Promise<Model> {
    let format: Format = 'isolated';
    // model(params) results in an empty object when using router.recognizeAndLoad()...
    let params: ModelArgs = transition.routeInfos.pop().params;
    let { url } = params;
    let card = await this.cardService.loadModel(url, { absoluteURL: true });
    if (!card) {
      throw new Error(`could not load card for url ${url}`);
    }
    return { card, format };
  }
}
