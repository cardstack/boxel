import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import CardRenderer from '@cardstack/host/components/card-renderer';
import CardError from '@cardstack/host/components/operator-mode/card-error';
import { getCard } from '@cardstack/host/resources/card-resource';

import type HostNavigationService from '@cardstack/host/services/host-navigation';
import type { CardErrorJSONAPI } from '@cardstack/host/services/store';

interface Signature {
  Args: { error: CardErrorJSONAPI };
}

// What a visitor sees in place of a page whose card failed: the site's error
// card, as the server serves it, when the site has one. Otherwise, or when
// the error card fails too, the card's own error.
export default class SiteError extends Component<Signature> {
  @service declare private hostNavigation: HostNavigationService;

  @cached
  get errorCardResource() {
    let id = this.hostNavigation.errorCard;
    return id ? getCard(this, () => id) : undefined;
  }

  <template>
    {{#if this.errorCardResource.card}}
      <CardRenderer
        @card={{this.errorCardResource.card}}
        @format='isolated'
        @displayContainer={{false}}
        data-test-host-mode-error-card
      />
    {{else if this.errorCardResource.cardError}}
      <CardError @error={{@error}} @hideHeader={{true}} />
    {{else if this.errorCardResource}}
      {{! the error card is loading }}
    {{else}}
      <CardError @error={{@error}} @hideHeader={{true}} />
    {{/if}}
  </template>
}
