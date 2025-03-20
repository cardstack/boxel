import { registerDestructor } from '@ember/destroyable';
import { array } from '@ember/helper';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { task } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';
import Modifier from 'ember-modifier';

import { provide } from 'ember-provide-consume-context';

import {
  BoxelDropdown,
  IconButton,
  Menu as BoxelMenu,
  RealmIcon,
  Tooltip,
} from '@cardstack/boxel-ui/components';

import { eq, menuItem } from '@cardstack/boxel-ui/helpers';
import { IconLink, Eye, ThreeDotsHorizontal } from '@cardstack/boxel-ui/icons';

import {
  cardTypeDisplayName,
  RealmURLContextName,
} from '@cardstack/runtime-common';

import Preview from '@cardstack/host/components/preview';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import RealmService from '@cardstack/host/services/realm';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';

import FormatChooser from '../code-submode/format-chooser';

import EmbeddedPreview from './embedded-preview';
import FittedFormatGallery from './fitted-format-gallery';

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
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;

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

  @provide(RealmURLContextName)
  get realmURL() {
    return this.args.realmURL;
  }

  openInInteractMode = task(async () => {
    await this.operatorModeStateService.openCardInInteractMode(
      new URL(this.args.card.id),
    );
  });

  <template>
    <div
      class='preview-header'
      data-test-code-mode-card-preview-header={{@card.id}}
      ...attributes
    >
      <RealmIcon @realmInfo={{this.realm.info @realmURL.href}} />
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
            <BoxelMenu
              @closeMenu={{dd.close}}
              @items={{array
                (menuItem
                  'Open in Interact Mode'
                  (perform this.openInInteractMode)
                  icon=Eye
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
      <div class='preview-content'>
        {{#if (eq this.format 'fitted')}}
          <FittedFormatGallery @card={{@card}} />
        {{else if (eq this.format 'embedded')}}
          <EmbeddedPreview @card={{@card}} />
        {{else if (eq this.format 'atom')}}
          <div class='atom-wrapper'>
            <Preview @card={{@card}} @format={{this.format}} />
          </div>
        {{else}}
          <Preview @card={{@card}} @format={{this.format}} />
        {{/if}}
      </div>
    </div>
    <div class='preview-footer' data-test-code-mode-card-preview-footer>
      <div class='preview-footer-title'>Preview as</div>
      <FormatChooser @format={{this.format}} @setFormat={{@setFormat}} />
    </div>

    <style scoped>
      .preview-header {
        background-color: var(--boxel-light);
        padding: var(--boxel-sp);
        display: flex;
        gap: var(--boxel-sp-xxs);
        align-items: center;
      }

      .preview-body {
        flex-grow: 1;
        overflow-y: auto;
      }

      .preview-content {
        height: auto;
        margin: var(--boxel-sp-sm);
      }

      .preview-content > :deep(.boxel-card-container.boundaries) {
        overflow: hidden;
      }

      .header-actions {
        margin-left: auto;
      }

      .header-title {
        font: 600 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
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

      :deep(.format-chooser__buttons) {
        --boxel-format-chooser-border-color: var(--boxel-400);
        margin: auto var(--boxel-sp-sm);
        width: 100%;
        box-shadow: none;
      }

      :deep(.format-chooser__button) {
        padding: var(--boxel-sp-xxxs) 0;
        flex-grow: 1;
        flex-basis: 0;
        font: 600 var(--boxel-font-sm);
      }

      .icon-button {
        --boxel-icon-button-width: 28px;
        --boxel-icon-button-height: 28px;
        border-radius: var(--boxel-border-radius-xs);

        display: flex;
        align-items: center;
        justify-content: center;

        font: var(--boxel-font-sm);
        margin-left: var(--boxel-sp-xxxs);
        z-index: 1;
      }

      .icon-button:not(:disabled):hover {
        background-color: var(--boxel-dark-hover);
      }
      .atom-wrapper {
        padding: var(--boxel-sp);
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
