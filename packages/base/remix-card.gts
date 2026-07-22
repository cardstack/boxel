import { CardDef, StringField, contains, field, linksTo } from './card-api';
import { ProcessCard } from './process-card';

import GitForkIcon from '@cardstack/boxel-icons/git-fork';

// A remix: a realm (or card) cloned/forked from a source. A remix is a
// specialized setup process — it runs through the same progress lifecycle —
// so it extends ProcessCard and the Workspace surfaces it in the same Home
// setup-bar job list (which queries for both types). It adds the source it
// was remixed from; the shared progress template is inherited unchanged.
export class RemixCard extends ProcessCard {
  static displayName = 'Remix';
  static icon = GitForkIcon;

  // The card or realm this space was remixed (cloned) from.
  @field remixedFrom = linksTo(() => CardDef);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: RemixCard) {
      return this.listingName ?? 'Remix';
    },
  });
}

export default RemixCard;
