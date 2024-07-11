import { getOwner } from '@ember/owner';
import Route from '@ember/routing/route';

import { getCard } from '@cardstack/host/resources/card-resource';

export default class PrerenderRoute extends Route {
  async model({ card_url }: { card_url: string }) {
    let opts: any = getOwner(this)!.lookup('prerender-options:main');
    opts.log();
    let cardResource = getCard(this, () => decodeURIComponent(card_url));
    await cardResource.loaded;
    return cardResource.card;
  }
}
