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
  format: Format;
}

interface RouteInfoModelArgs {
  queryParams: ModelArgs;
}

export default class Application extends Route<Model> {
  queryParams = {
    url: {
      refreshModel: true,
    },
    format: {
      refreshModel: true,
    },
  };

  @service declare cardService: CardService;

  async model(args: ModelArgs | RouteInfoModelArgs): Promise<Model> {
    let url: string;
    let format: Format;
    if ('queryParams' in args) {
      url = args.queryParams.url;
      format = args.queryParams.format;
    } else {
      url = args.url;
      format = args.format;
    }
    let card = await this.cardService.loadModel(url, { absoluteURL: true });
    if (!card) {
      throw new Error(`could not load card for url ${url}`);
    }
    return { card, format: format as Format };
  }
}
