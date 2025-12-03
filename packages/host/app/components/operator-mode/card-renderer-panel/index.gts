import { registerDestructor } from '@ember/destroyable';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import { service } from '@ember/service';

import Component from '@glimmer/component';

import Modifier from 'ember-modifier';
import { consume, provide } from 'ember-provide-consume-context';

import {
  CardHeader,
  BoxelButton,
  CardContainer,
} from '@cardstack/boxel-ui/components';
import { eq, toMenuItems } from '@cardstack/boxel-ui/helpers';
import { Eye, IconCode } from '@cardstack/boxel-ui/icons';

import {
  cardTypeDisplayName,
  cardTypeIcon,
  getCardMenuItems,
  identifyCard,
  isResolvedCodeRef,
} from '@cardstack/runtime-common';

import { CardContextName } from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';
import Overlays from '@cardstack/host/components/operator-mode/overlays';

import { urlForRealmLookup } from '@cardstack/host/lib/utils';

import ElementTracker, {
  type RenderedCardForOverlayActions,
} from '@cardstack/host/resources/element-tracker';
import type CommandService from '@cardstack/host/services/command-service';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type RealmService from '@cardstack/host/services/realm';

import type {
  CardContext,
  CardDef,
  Format,
  ViewCardFn,
} from 'https://cardstack.com/base/card-api';

import FormatChooser from '../code-submode/format-chooser';

import FittedFormatGallery from './fitted-format-gallery';

interface Signature {
  Element: HTMLElement;
  Args: {
    card: CardDef;
    format?: Format; // defaults to 'isolated'
    setFormat: (format: Format) => void;
    viewCard?: ViewCardFn;
  };
}

export default class CardRendererPanel extends Component<Signature> {
  @consume(CardContextName) private declare cardContext: CardContext;
  @service private declare commandService: CommandService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;

  private scrollPositions = new Map<string, number>();
  private cardTracker = new ElementTracker();

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

  private openInInteractMode = () => {
    this.operatorModeStateService.openCardInInteractMode(this.args.card.id);
  };

  private editTemplate = () => {
    // Get the card definition using identifyCard
    const type = identifyCard(this.args.card.constructor as any);
    if (type && isResolvedCodeRef(type)) {
      // Construct the GTS file URL
      const gtsFileUrl = type.module.endsWith('.gts')
        ? type.module
        : `${type.module}.gts`;
      this.operatorModeStateService.updateCodePath(new URL(gtsFileUrl));
    }
  };

  private get realmInfo() {
    let url = this.args.card ? urlForRealmLookup(this.args.card) : undefined;
    if (!url) {
      return undefined;
    }
    return this.realm.info(url);
  }

  private get contextMenuItems() {
    if (!this.args.card) {
      return [];
    }
    return toMenuItems(
      this.args.card[getCardMenuItems]({
        canEdit: this.realm.canWrite(this.args.card.id),
        cardCrudFunctions: {},
        menuContext: 'code-mode-preview',
        commandContext: this.commandService.commandContext,
      }),
    );
  }

  private get canEditCard() {
    return Boolean(
      this.format !== 'edit' && this.realm.canWrite(this.args.card.id),
    );
  }

  @provide(CardContextName)
  // @ts-ignore context is used via provider
  private get context(): CardContext {
    return {
      ...this.cardContext,
      cardComponentModifier: this.cardTracker.trackElement,
    };
  }

  private get renderedCardsForOverlayActions():
    | RenderedCardForOverlayActions[]
    | undefined {
    if (!this.args.viewCard) {
      return undefined;
    }
    let entries = this.cardTracker.filter(
      [{ fieldType: 'linksTo' }, { fieldType: 'linksToMany' }],
      'or',
    );
    return entries.length ? entries : undefined;
  }

  <template>
    <div class='preview-buttons'>
      <BoxelButton
        @kind='secondary-light'
        @size='small'
        {{on 'click' this.editTemplate}}
        data-test-edit-template-button
      >
        <IconCode class='button-icon' />
        Edit Template
      </BoxelButton>

      <span class='preview-text'>Preview</span>

      <BoxelButton
        @kind='secondary-light'
        @size='small'
        {{on 'click' this.openInInteractMode}}
        data-test-open-in-interact-button
      >
        <Eye class='button-icon' />
        Open in Interact
      </BoxelButton>
    </div>

    <div
      class='card-renderer-body'
      data-test-code-mode-card-renderer-body
      {{ScrollModifier
        initialScrollPosition=this.scrollPosition
        onScroll=this.onScroll
      }}
    >
      <div class='card-renderer-content'>
        <CardContainer>
          <CardHeader
            class='card-renderer-header'
            @cardTypeDisplayName={{cardTypeDisplayName @card}}
            @cardTypeIcon={{cardTypeIcon @card}}
            @cardTitle={{@card.title}}
            @realmInfo={{this.realmInfo}}
            @onEdit={{if this.canEditCard (fn @setFormat 'edit')}}
            @onFinishEditing={{if
              (eq this.format 'edit')
              (fn @setFormat 'isolated')
            }}
            @isTopCard={{true}}
            @moreOptionsMenuItems={{this.contextMenuItems}}
            data-test-code-mode-card-renderer-header={{@card.id}}
            ...attributes
          />
          {{#if (eq this.format 'fitted')}}
            <FittedFormatGallery @card={{@card}} />
          {{else}}
            {{#if this.renderedCardsForOverlayActions}}
              <Overlays
                @renderedCardsForOverlayActions={{this.renderedCardsForOverlayActions}}
                @viewCard={{@viewCard}}
              />
            {{/if}}
            <CardRenderer
              class='preview'
              @card={{@card}}
              @format={{this.format}}
            />
          {{/if}}
        </CardContainer>
      </div>
    </div>

    <div class='card-renderer-format-chooser'>
      <FormatChooser @format={{this.format}} @setFormat={{@setFormat}} />
    </div>

    <style scoped>
      .card-renderer-header {
        min-height: max-content;
      }
      .card-renderer-header:not(.is-editing) {
        background-color: var(--boxel-100);
      }
      .preview-buttons {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--boxel-sp-xs) 0;
        background-color: #75707e;
      }
      .preview-text {
        color: var(--boxel-light);
        font: 600 var(--boxel-font-sm);
        letter-spacing: 0.13px;
      }
      .button-icon {
        width: 16px;
        height: 16px;
        margin-right: var(--boxel-sp-xxs);
        --icon-color: var(--boxel-teal);
      }
      .preview-buttons :deep(.boxel-button) {
        color: var(--boxel-light);
        font: 500 var(--boxel-font-xs);
        letter-spacing: 0.17px;
        border: none;
        min-height: 19px;
        min-width: fit-content;
        padding: 0 var(--boxel-sp-xs);
      }
      .card-renderer-body {
        flex-grow: 1;
        overflow-y: auto;
        z-index: 0;
      }
      .card-renderer-content {
        height: auto;
      }
      .card-renderer-content > :deep(.boxel-card-container.boundaries) {
        overflow: hidden;
      }
      .card-renderer-format-chooser {
        background-color: var(--boxel-dark);
        right: 50%;
        transform: translateX(50%);
        position: absolute;
        bottom: var(--boxel-sp-sm);
        width: 380px;
        border-radius: var(--boxel-border-radius);
      }
      :deep(.fitted-format-gallery) {
        padding: var(--boxel-sp-sm);
      }
      .preview {
        box-shadow: none;
        border-radius: 0;
      }
      :deep(.format-chooser) {
        --boxel-format-chooser-border-color: var(--boxel-400);
        margin: 0;
        width: 100%;
        box-shadow: none;
        border-radius: var(--boxel-border-radius);
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
