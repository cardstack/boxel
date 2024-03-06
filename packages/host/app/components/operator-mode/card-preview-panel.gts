import { registerDestructor } from '@ember/destroyable';
import { fn, array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';
import Modifier from 'ember-modifier';

import {
  BoxelDropdown,
  IconButton,
  Menu as BoxelMenu,
  Tooltip,
} from '@cardstack/boxel-ui/components';

import { eq, menuItem } from '@cardstack/boxel-ui/helpers';
import { IconLink, ThreeDotsHorizontal } from '@cardstack/boxel-ui/icons';

import { cardTypeDisplayName } from '@cardstack/runtime-common';

import RealmIcon from '@cardstack/host/components/operator-mode/realm-icon';
import RealmInfoProvider from '@cardstack/host/components/operator-mode/realm-info-provider';
import Preview from '@cardstack/host/components/preview';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';

interface Signature {
  Element: HTMLElement;
  Args: {
    card: CardDef;
    realmURL: URL;
    format?: Format; // defaults to 'isolated'
    setFormat: (format: Format) => void;
  };
  Blocks: {};
}

export default class CardPreviewPanel extends Component<Signature> {
  @tracked footerWidthPx = 0;

  private scrollPositions = new Map<string, number>();
  private copyToClipboard = task(async () => {
    await navigator.clipboard.writeText(this.args.card.id);
  });

  private onScroll = (event: Event) => {
    let scrollPosition = (event.target as HTMLElement).scrollTop;
    this.scrollPositions.set(this.format, scrollPosition);
  };

  private get scrollPosition() {
    return this.scrollPositions.get(this.format);
  }

  private get format(): Format {
    return this.args.format ?? 'isolated';
  }

  @action setFooterWidthPx(footerWidthPx: number) {
    this.footerWidthPx = footerWidthPx;
  }

  get footerButtonsClass() {
    if (this.footerWidthPx < 380) {
      // Adjust this as needed - it's where the buttons in single line start to get too squished
      return 'collapsed';
    }
    return null;
  }

  <template>
    <div
      class='preview-header'
      data-test-code-mode-card-preview-header={{@card.id}}
      ...attributes
    >
      <div class='header-icon'>
        <RealmInfoProvider @realmURL={{@realmURL}}>
          <:ready as |realmInfo|>
            <RealmIcon
              @realmIconURL={{realmInfo.iconURL}}
              @realmName={{realmInfo.name}}
              class='icon'
            />
          </:ready>
        </RealmInfoProvider>
      </div>
      <div class='header-title'>
        {{cardTypeDisplayName @card}}
      </div>
      <div class='header-actions'>
        <BoxelDropdown class='card-options'>
          <:trigger as |bindings|>
            <Tooltip @placement='top'>
              <:trigger>
                <IconButton
                  @icon={{ThreeDotsHorizontal}}
                  @width='20px'
                  @height='20px'
                  class='icon-button'
                  aria-label='Options'
                  data-test-more-options-button
                  {{bindings}}
                />
              </:trigger>
              <:content>
                More Options
              </:content>
            </Tooltip>
          </:trigger>
          <:content as |dd|>
            <BoxelMenu
              @closeMenu={{dd.close}}
              @items={{array
                (menuItem
                  'Copy Card URL' (perform this.copyToClipboard) icon=IconLink
                )
              }}
            />
          </:content>
        </BoxelDropdown>
      </div>
    </div>

    <div
      class='preview-body'
      data-test-code-mode-card-preview-body
      {{ScrollModifier
        initialScrollPosition=this.scrollPosition
        onScroll=this.onScroll
      }}
    >
      <Preview @card={{@card}} @format={{this.format}} />
    </div>

    <div
      class='preview-footer'
      {{ResizeModifier setFooterWidthPx=this.setFooterWidthPx}}
      data-test-code-mode-card-preview-footer
    >
      <div class='preview-footer-title'>Preview as</div>
      <div class='footer-buttons {{this.footerButtonsClass}}'>
        <button
          class='footer-button {{if (eq this.format "isolated") "active"}}'
          {{on 'click' (fn @setFormat 'isolated')}}
          data-test-preview-card-footer-button-isolated
        >Isolated</button>
        <button
          class='footer-button {{if (eq this.format "atom") "active"}}'
          {{on 'click' (fn @setFormat 'atom')}}
          data-test-preview-card-footer-button-atom
        >
          Atom</button>
        <button
          class='footer-button {{if (eq this.format "embedded") "active"}}'
          {{on 'click' (fn @setFormat 'embedded')}}
          data-test-preview-card-footer-button-embedded
        >
          Embedded</button>
        <button
          class='footer-button {{if (eq this.format "edit") "active"}}'
          {{on 'click' (fn @setFormat 'edit')}}
          data-test-preview-card-footer-button-edit
        >Edit</button>
      </div>
    </div>

    <style>
      .preview-header {
        background: white;
        border-top-left-radius: var(--boxel-border-radius);
        border-top-right-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-lg);
        display: flex;
      }

      .header-icon > img {
        height: 25px;
        width: 25px;
      }

      .header-icon {
        margin-right: var(--boxel-sp-xxs);
      }

      .preview-body {
        flex-grow: 1;
        overflow-y: auto;
      }

      .header-actions {
        margin-left: auto;
      }

      .preview-body > :deep(.boxel-card-container) {
        border-radius: 0;
        box-shadow: none;
      }

      .header-title {
        font-weight: 600;
        font-size: 1.2rem;
      }

      .preview-footer {
        background-color: var(--boxel-200);
        border-bottom-left-radius: var(--boxel-border-radius);
        border-bottom-right-radius: var(--boxel-border-radius);
        padding-bottom: var(--boxel-sp-sm);
      }

      .preview-footer-title {
        text-align: center;
        padding: var(--boxel-sp-xs) 0;
        text-transform: uppercase;
        font-weight: 600;
        color: var(--boxel-400);
        letter-spacing: 0.6px;
      }

      .footer-buttons {
        margin: auto var(--boxel-sp-sm);
        display: flex;
        width: 100% - calc(2 * var(--boxel-sp));
      }

      .footer-buttons.collapsed {
        display: block;
        gap: var(--boxel-sp-sm);
        width: 100% - calc(2 * var(--boxel-sp));
      }

      .footer-button {
        padding: var(--boxel-sp-xxxs) 0;
        flex-grow: 1;
        flex-basis: 0;
        font-weight: 600;
        background: transparent;
        color: var(--boxel-dark);
        border: 1px solid var(--boxel-400);
      }

      .footer-buttons.collapsed .footer-button {
        padding: var(--boxel-sp-xxxs) var(--boxel-sp-xs);
        border-radius: 6px;
        margin-top: var(--boxel-sp-xxxs);
        margin-right: var(--boxel-sp-xxs);
      }

      .footer-button:first-child {
        border-top-left-radius: var(--boxel-border-radius);
        border-bottom-left-radius: var(--boxel-border-radius);
      }

      .footer-button:last-child {
        border-top-right-radius: var(--boxel-border-radius);
        border-bottom-right-radius: var(--boxel-border-radius);
      }

      .footer-button + .footer-button {
        margin-left: -1px;
      }

      .footer-button.active {
        background: #27232f;
        color: var(--boxel-teal);
      }

      .icon-button {
        --icon-color: var(--boxel-highlight);
        --boxel-icon-button-width: 28px;
        --boxel-icon-button-height: 28px;
        border-radius: 4px;

        display: flex;
        align-items: center;
        justify-content: center;

        font: var(--boxel-font-sm);
        margin-left: var(--boxel-sp-xxxs);
        z-index: 1;
      }

      .icon-button:hover {
        --icon-color: var(--boxel-light);
        background-color: var(--boxel-highlight);
      }
    </style>
  </template>
}

interface ScrollSignature {
  Args: {
    Named: {
      initialScrollPosition?: number;
      onScroll?: (event: Event) => void;
    };
  };
}

class ScrollModifier extends Modifier<ScrollSignature> {
  modify(
    element: HTMLElement,
    _positional: [],
    { initialScrollPosition = 0, onScroll }: ScrollSignature['Args']['Named'],
  ) {
    // note that when testing make sure "disable cache" in chrome network settings is unchecked,
    // as this assumes that previously loaded images will be cached. otherwise the scroll will
    // happen *before* the geometry is altered by images that haven't completed loading yet.
    element.scrollTop = initialScrollPosition;
    if (onScroll) {
      element.addEventListener('scroll', onScroll);
      registerDestructor(this, () => {
        element.removeEventListener('scroll', onScroll);
      });
    }
  }
}

interface ResizeSignature {
  Args: {
    Named: {
      setFooterWidthPx: (footerWidthPx: number) => void;
    };
  };
}

class ResizeModifier extends Modifier<ResizeSignature> {
  modify(
    element: HTMLElement,
    _positional: [],
    { setFooterWidthPx }: ResizeSignature['Args']['Named'],
  ) {
    let resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        setFooterWidthPx(element.clientWidth);
      });
    });

    resizeObserver.observe(element);

    registerDestructor(this, () => {
      resizeObserver.disconnect();
    });
  }
}
