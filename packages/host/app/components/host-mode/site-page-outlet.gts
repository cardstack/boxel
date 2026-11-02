import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { consume, provide } from 'ember-provide-consume-context';

import { CardContextName } from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';
import SiteError from '@cardstack/host/components/host-mode/site-error';
import { getCard } from '@cardstack/host/resources/card-resource';

import type HostModeStateService from '@cardstack/host/services/host-mode-state-service';
import type HostNavigationService from '@cardstack/host/services/host-navigation';

import type { CardContext } from '@cardstack/base/card-api';

interface Signature {
  Element: HTMLElement;
}

// The page inside a site's frame: what the frame card's <SitePage /> renders
// on a published site. The page's own context says it is framed, so a card
// that draws its own header when it stands alone leaves that to the frame.
export default class SitePageOutlet extends Component<Signature> {
  @service declare private hostModeStateService: HostModeStateService;
  @service declare private hostNavigation: HostNavigationService;
  @consume(CardContextName) declare private outerContext: CardContext;

  @provide(CardContextName)
  // @ts-expect-error 'pageContext' is declared but not used
  private get pageContext(): CardContext {
    return { ...this.outerContext, sitePage: undefined, siteFramed: true };
  }

  get pageCardId(): string | null {
    let id = this.hostModeStateService.primaryCard;
    // The frame itself, visited at its own address, has no page inside it.
    if (!id || id === this.hostNavigation.frame) {
      return null;
    }
    return id;
  }

  @cached
  get cardResource() {
    if (!this.pageCardId) {
      return undefined;
    }
    return getCard(this, () => this.pageCardId!);
  }

  <template>
    <div data-host-mode-page ...attributes>
      {{#if this.cardResource.cardError}}
        {{#if (isNotFound this.cardResource.cardError)}}
          <p class='message'>This page could not be found.</p>
        {{else}}
          <SiteError @error={{this.cardResource.cardError}} />
        {{/if}}
      {{else if this.cardResource.card}}
        <CardRenderer
          @card={{this.cardResource.card}}
          @format='isolated'
          @displayContainer={{false}}
        />
      {{/if}}
    </div>
    <style scoped>
      .message {
        padding: var(--boxel-sp-xl) var(--boxel-sp);
        text-align: center;
      }
    </style>
  </template>
}

function isNotFound(error: { status?: number }) {
  return error.status === 404;
}
