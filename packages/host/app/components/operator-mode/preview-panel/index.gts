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
import { and, eq, not, or, toMenuItems } from '@cardstack/boxel-ui/helpers';
import { Eye, IconCode } from '@cardstack/boxel-ui/icons';

import {
  baseCardRef,
  cardTypeDisplayName,
  cardTypeIcon,
  getMenuItems,
  identifyCard,
  isCardInstance,
  isFileDefInstance,
  isResolvedCodeRef,
  cardDefFormats,
  fileDefFormats,
  fieldDefFormats,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { CardContextName } from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';
import Overlays from '@cardstack/host/components/operator-mode/overlays';

import ElementTracker, {
  type RenderedCardForOverlayActions,
} from '@cardstack/host/resources/element-tracker';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type RealmService from '@cardstack/host/services/realm';
import type ToolService from '@cardstack/host/services/tool-service';

import FormatChooser from '../code-submode/format-chooser';

import FittedFormatGallery from './fitted-format-gallery';
import MarkdownPreview from './markdown-preview';
import MetadataPanel from './metadata-panel';

import type {
  BaseDef,
  CardContext,
  CardDef,
  Format,
  ViewCardFn,
} from '@cardstack/base/card-api';

interface Signature {
  Element: HTMLElement;
  Args: {
    card: BaseDef;
    format?: Format; // defaults to 'isolated'
    setFormat: (format: Format) => void;
    viewCard?: ViewCardFn;
  };
}

export default class PreviewPanel extends Component<Signature> {
  @consume(CardContextName) declare private cardContext: CardContext;
  @service declare private toolService: ToolService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;

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
    let format = this.args.format ?? 'isolated';
    if (!this.availableFormats.includes(format)) {
      return 'isolated';
    }
    return format;
  }

  // 'form' is a synthetic chooser option for "auto-generated standard
  // view" — same mechanism as interact mode's "Toggle Standard View".
  // The renderer doesn't know about 'form', so we render it as 'edit'
  // and pin @codeRef to baseCardRef, which makes getComponent fall back
  // to CardDef's auto-generated template instead of the subclass's
  // custom edit template. Chooser-facing logic still uses `this.format`.
  private get effectiveFormat(): Format {
    return this.format === ('form' as Format) ? 'edit' : this.format;
  }
  private get effectiveCodeRef(): ResolvedCodeRef | undefined {
    return this.format === ('form' as Format) ? baseCardRef : undefined;
  }

  private get cardId(): string | undefined {
    return (this.args.card as CardDef).id;
  }

  private get isCard(): boolean {
    return isCardInstance(this.args.card);
  }

  private openInInteractMode = () => {
    if (this.cardId) {
      this.operatorModeStateService.openCardInInteractMode(
        this.cardId,
        'isolated',
        isFileDefInstance(this.args.card) ? 'file' : 'card',
      );
    }
  };

  private editTemplate = () => {
    const type = identifyCard(this.args.card.constructor as any);
    if (type && isResolvedCodeRef(type)) {
      const gtsFileUrl = type.module.endsWith('.gts')
        ? type.module
        : `${type.module}.gts`;
      this.operatorModeStateService.updateCodePath(new URL(gtsFileUrl));
    }
  };

  private get realmInfo() {
    if (!this.cardId) {
      return undefined;
    }
    return this.realm.info(this.cardId);
  }

  private get contextMenuItems() {
    if (!this.args.card || !(getMenuItems in this.args.card)) {
      return [];
    }
    return toMenuItems(
      (this.args.card as CardDef)[getMenuItems]({
        canEdit: this.cardId ? this.realm.canWrite(this.cardId) : false,
        cardCrudFunctions: {},
        menuContext: 'code-mode-preview',
        toolContext: this.toolService.toolContext,
      }),
    );
  }

  private get canEditCard() {
    return Boolean(
      this.isCard &&
      this.format !== 'edit' &&
      this.cardId &&
      this.realm.canWrite(this.cardId),
    );
  }

  private get cardTitle(): string | undefined {
    if (this.isCard) {
      return (this.args.card as CardDef).cardTitle;
    }
    return (this.args.card as any).name;
  }

  private get isFileDef(): boolean {
    return isFileDefInstance(this.args.card);
  }

  private get availableFormats() {
    if (this.isFileDef) {
      return fileDefFormats;
    }
    if (this.isCard) {
      const ctor = (this.args.card as CardDef).constructor as typeof CardDef;
      const hasCustomEdit = ctor.hasCustomEditTemplate;
      // Insert 'form' (toggle standard view) right after 'edit' ONLY
      // when this card has a custom edit template. Note: a card that
      // shares the same component for edit and isolated (e.g.
      // Polymorph: `static edit = PolymorphIsolated`) still counts as
      // having a custom edit — `hasCustomEditTemplate` is `edit !==
      // CardDef.edit`, regardless of whether it equals isolated.
      const result: Format[] = [];
      for (const f of cardDefFormats) {
        result.push(f);
        if (f === 'edit' && hasCustomEdit) {
          result.push('form' as Format);
        }
      }
      return result;
    }
    return fieldDefFormats;
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
      [
        { format: 'data' },
        { fieldType: 'linksTo' },
        { fieldType: 'linksToMany' },
      ],
      'or',
      // the only linksTo field with isolated format is in the index card,
      // we don't want to show overlays for those cards here
      { exclude: [{ fieldType: 'linksTo', format: 'isolated' }] },
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
            @cardTitle={{this.cardTitle}}
            @realmInfo={{this.realmInfo}}
            {{! Form is edit-with-base-template — visually the same as
                edit for the header's green bar. Hide the pencil while
                in either mode and let the X (finish editing) take you
                back to isolated. }}
            @onEdit={{if
              (and
                this.canEditCard
                (not (or (eq this.format 'edit') (eq this.format 'form')))
              )
              (fn @setFormat 'edit')
            }}
            @onFinishEditing={{if
              (or (eq this.format 'edit') (eq this.format 'form'))
              (fn @setFormat 'isolated')
            }}
            @isTopCard={{true}}
            @moreOptionsMenuItems={{this.contextMenuItems}}
            data-test-code-mode-card-renderer-header={{this.cardId}}
            ...attributes
          />
          {{#if (eq this.format 'metadata')}}
            <MetadataPanel @card={{@card}} />
          {{else if (eq this.format 'fitted')}}
            <FittedFormatGallery @card={{@card}} />
          {{else if (eq this.format 'markdown')}}
            {{#if this.renderedCardsForOverlayActions}}
              <Overlays
                @renderedCardsForOverlayActions={{this.renderedCardsForOverlayActions}}
                @viewCard={{@viewCard}}
              />
            {{/if}}
            <MarkdownPreview @card={{@card}} />
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
              @format={{this.effectiveFormat}}
              @codeRef={{this.effectiveCodeRef}}
            />
          {{/if}}
        </CardContainer>
      </div>
    </div>
    <div class='card-renderer-format-chooser-container'>
      <FormatChooser
        class='card-renderer-format-chooser'
        @format={{this.format}}
        @setFormat={{@setFormat}}
        @formats={{this.availableFormats}}
      />
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
        padding-bottom: calc(
          var(--operator-mode-spacing) * 2 + var(--container-button-size)
        );
        z-index: 0;
      }
      .card-renderer-content {
        height: auto;
      }
      .card-renderer-content > :deep(.boxel-card-container.boundaries) {
        overflow: hidden;
      }
      /* Full-width centering shell for the floating chooser. Its
         width tracks the card preview area so the chooser inside can
         measure available width honestly (a `width: max-content`
         shell would hug the chooser and create a stuck-compact loop
         when room becomes available again). The dark capsule +
         radius lives on the chooser itself in this layout. */
      .card-renderer-format-chooser-container {
        position: absolute;
        bottom: var(--operator-mode-spacing);
        left: 0;
        right: 0;
        display: flex;
        justify-content: center;
        padding: 0 var(--operator-mode-spacing);
        padding-right: calc(
          var(--operator-mode-spacing) * 2 + var(--container-button-size)
        );
      }
      .card-renderer-format-chooser {
        --boxel-format-chooser-border-color: var(--boxel-400);
        margin: 0;
        max-width: 100%;
        box-shadow: none;
        border-radius: var(--boxel-border-radius-2xl);
      }
      :deep(.fitted-format-gallery) {
        padding: var(--boxel-sp-sm);
      }
      .preview {
        box-shadow: none;
        border-radius: 0;
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
