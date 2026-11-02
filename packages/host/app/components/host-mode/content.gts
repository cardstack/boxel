import Helper from '@ember/component/helper';
import { cancel, scheduleOnce } from '@ember/runloop';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';
import { provide } from 'ember-provide-consume-context';

import { gt, not } from '@cardstack/boxel-ui/helpers';

import {
  CardCrudFunctionsContextName,
  isCardInstance,
} from '@cardstack/runtime-common';
import { meta } from '@cardstack/runtime-common/constants';

import { getCard } from '@cardstack/host/resources/card-resource';

import HostModeBreadcrumbs from './breadcrumbs';
import HostModeCard from './card';
import HostModeStack from './stack';

import type {
  CardDef,
  ViewCardFn,
  CardCrudFunctions,
} from '@cardstack/base/card-api';

interface Signature {
  Element: HTMLElement;
  Args: {
    primaryCardId: string | null;
    stackItemCardIds: string[];
    removeCardFromStack: (cardId: string) => void;
    openInteractSubmode?: () => void;
    viewCard: ViewCardFn;
    hrefFor?: CardCrudFunctions['hrefFor'];
    navigateTo?: CardCrudFunctions['navigateTo'];
    prefetch?: CardCrudFunctions['prefetch'];
  };
}

// Same width as the operator-mode phone breakpoint.
const NARROW_WIDTH_REM = 30;

export default class HostModeContent extends Component<Signature> {
  // Measured on this element rather than the viewport, so a narrow
  // host-submode panel gets the phone layout too. A CSS container would do
  // the same, but its containment would trap cards' position: fixed overlays.
  @tracked private isNarrow = false;

  private observeWidth = modifier((element: HTMLElement) => {
    // Layout width, not the bounding rect: a scaled ancestor (the test
    // harness is one) would otherwise move the breakpoint.
    let measure = () => {
      let rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      let isNarrow = element.offsetWidth <= NARROW_WIDTH_REM * rem;
      if (isNarrow !== this.isNarrow) {
        this.isNarrow = isNarrow;
      }
    };
    // Measured once right after the first render too, so a phone doesn't
    // briefly get the desktop stack before the first resize notification.
    let initial = scheduleOnce('afterRender', this, measure);
    let observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      cancel(initial);
      observer?.disconnect();
    };
  });

  get primaryCard() {
    return this.primaryCardResource?.card;
  }

  get primaryCardResource() {
    if (!this.args.primaryCardId) {
      return undefined;
    }

    return getCard(this, () => this.args.primaryCardId!);
  }

  get cardIds() {
    return [this.args.primaryCardId, ...this.args.stackItemCardIds].filter(
      (cardId): cardId is string => Boolean(cardId),
    );
  }

  get displayBreadcrumbs() {
    return this.args.stackItemCardIds.length > 0;
  }

  // An open stack item covers the primary card, behind the scrim. The card
  // stays rendered, and `inert` keeps focus, the find bar and assistive tech
  // out of it, and tells the card itself that nobody is working with it, so a
  // card that animates can rest until the stack closes.
  get isPrimaryCovered() {
    return this.args.stackItemCardIds.length > 0;
  }

  get isWideCard() {
    let primaryCard = this.primaryCard;
    if (!primaryCard || !isCardInstance(primaryCard)) {
      return false;
    }

    return (primaryCard.constructor as typeof CardDef).prefersWideFormat;
  }

  get backgroundImageStyle() {
    let primaryCard = this.primaryCard;
    if (!primaryCard || !isCardInstance(primaryCard) || this.isWideCard) {
      return htmlSafe('');
    }

    let backgroundImageUrl = primaryCard[meta]?.realmInfo?.backgroundURL;

    if (backgroundImageUrl) {
      return htmlSafe(`background-image: url(${backgroundImageUrl});`);
    }

    return htmlSafe('');
  }

  @provide(CardCrudFunctionsContextName)
  // @ts-ignore "cardCrudFunctions" is declared but not used
  private get cardCrudFunctions(): Optional<CardCrudFunctions> {
    return {
      viewCard: this.args.viewCard,
      hrefFor: this.args.hrefFor,
      navigateTo: this.args.navigateTo,
      prefetch: this.args.prefetch,
    };
  }

  <template>
    {{bodyClass 'boxel-ready'}}

    <div
      class='host-mode-content
        {{if this.isWideCard "is-wide"}}
        {{if this.isNarrow "is-narrow"}}'
      style={{this.backgroundImageStyle}}
      {{this.observeWidth}}
      data-test-host-mode-content
      data-test-host-mode-narrow={{this.isNarrow}}
      ...attributes
    >
      {{#if this.displayBreadcrumbs}}
        <div class='breadcrumb-container'>
          <HostModeBreadcrumbs
            @cardIds={{this.cardIds}}
            @close={{@removeCardFromStack}}
          />
        </div>
      {{/if}}
      <HostModeCard
        @cardId={{@primaryCardId}}
        @displayBoundaries={{not this.isWideCard}}
        @isPrimary={{true}}
        @openInteractSubmode={{@openInteractSubmode}}
        class='current-card'
        inert={{this.isPrimaryCovered}}
      />
      {{#if (gt @stackItemCardIds.length 0)}}
        <HostModeStack
          @stackItemCardIds={{@stackItemCardIds}}
          @isNarrow={{this.isNarrow}}
          @close={{@removeCardFromStack}}
        />
      {{/if}}
    </div>

    <style scoped>
      .host-mode-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        overflow: hidden;
        padding: var(--boxel-sp);
        position: relative;
        background-color: #686283;
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
      }

      @media screen {
        .host-mode-content {
          height: 100%;
          overscroll-behavior: none;
        }
      }

      @media print {
        .host-mode-content {
          min-height: 100vh;
        }
      }

      .breadcrumb-container {
        position: absolute;
        top: var(--boxel-sp);
        left: var(--boxel-sp);
        z-index: 2;
        max-width: calc(100% - 2 * var(--boxel-sp));
      }

      .host-mode-content.is-wide {
        padding: 0;
        --host-mode-card-width: 100%;
        --host-mode-card-padding: 0;
        --host-mode-card-border-radius: 0;
      }

      .current-card {
        flex: 1;
        max-height: 100%;
        display: flex;
        justify-content: center;
        align-items: stretch;
      }

      .host-mode-content.is-wide .breadcrumb-container {
        top: var(--boxel-sp-lg);
        left: var(--boxel-sp-lg);
        max-width: calc(100% - 2 * var(--boxel-sp-lg));
      }

      /* When narrow, the primary card fits the screen instead of keeping its
         desktop width and being clipped, with the same gutter as the top
         stack card. Wide cards keep their own zero padding. */
      .host-mode-content.is-narrow:not(.is-wide) {
        --host-mode-card-width: 100%;
        padding: var(--boxel-sp-xs);
      }

      /* When narrow, only the top stack card shows, so there is no trail to
         navigate; its close button steps back. */
      .host-mode-content.is-narrow .breadcrumb-container {
        display: none;
      }
    </style>
  </template>
}

interface BodyClassSignature {
  Args: {
    Positional: [string];
  };
  Return: void;
}

class bodyClass extends Helper<BodyClassSignature> {
  compute([className]: [string]) {
    document.body.classList.add(className);
  }
}
