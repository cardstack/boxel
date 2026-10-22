import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { Tooltip } from '@cardstack/boxel-ui/components';

import { realmURLDisplayText } from '@cardstack/host/lib/realm-utils';
import type NetworkService from '@cardstack/host/services/network';
import type RealmService from '@cardstack/host/services/realm';

interface Signature {
  Element: HTMLElement;
  Args: {
    // Pass the realm's own URL, or the URL of a card, file or module in it.
    // A `urlInRealm` resolves once the realm is known; pair it with the
    // `realm.info()` call for the same URL, which looks an unknown realm up.
    realmURL?: string;
    urlInRealm?: string;
    // A line above the URL, for a realm name the trigger truncates.
    label?: string;
    // Also reads the URL out to assistive tech. For a realm's name, where
    // telling same-named realms apart matters; an icon is hover-only.
    announce?: boolean;
  };
  Blocks: {
    default: [];
  };
}

// Shows a realm's URL on hover, so realms that share a name can be told
// apart.
export default class RealmURLTooltip extends Component<Signature> {
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;

  @cached
  private get resolvedRealmURL(): string | undefined {
    if (this.args.realmURL) {
      return this.args.realmURL;
    }
    return this.args.urlInRealm
      ? this.realm.realmURLOf(this.args.urlInRealm)
      : undefined;
  }

  @cached
  private get text() {
    let realmURL = this.resolvedRealmURL;
    return realmURL
      ? realmURLDisplayText(this.network.virtualNetwork, realmURL)
      : undefined;
  }

  // Present even while the realm is unresolved, so tests can always find it.
  private get testHookValue() {
    return this.resolvedRealmURL ?? '';
  }

  private get isDisabled() {
    return !this.text;
  }

  private get shouldAnnounce() {
    return Boolean(this.args.announce && this.text);
  }

  <template>
    <Tooltip
      @placement='top'
      @disabled={{this.isDisabled}}
      data-test-realm-url-tooltip-trigger={{this.testHookValue}}
      ...attributes
    >
      <:trigger>
        {{yield}}
        {{#if this.shouldAnnounce}}
          <span class='boxel-sr-only'>{{this.text}}</span>
        {{/if}}
      </:trigger>
      <:content>
        {{#if @label}}
          <span
            class='realm-url-tooltip-label'
            data-test-realm-url-tooltip-label
          >{{@label}}</span>
        {{/if}}
        <span
          class='realm-url-tooltip'
          data-test-realm-url-tooltip
        >{{this.text}}</span>
      </:content>
    </Tooltip>
    <style scoped>
      .realm-url-tooltip-label,
      .realm-url-tooltip {
        display: block;
        text-align: start;
      }
    </style>
  </template>
}
