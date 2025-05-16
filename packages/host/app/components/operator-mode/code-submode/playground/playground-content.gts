import { fn } from '@ember/helper';
import { action } from '@ember/object';

import { service } from '@ember/service';
import { htmlSafe, type SafeString } from '@ember/template';

import Component from '@glimmer/component';

import { task } from 'ember-concurrency';

import {
  CardContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { eq, MenuItem } from '@cardstack/boxel-ui/helpers';
import { Eye, IconCode, IconLink } from '@cardstack/boxel-ui/icons';

import {
  type Query,
  type ResolvedCodeRef,
  type CardErrorJSONAPI,
  specRef,
} from '@cardstack/runtime-common';

import consumeContext from '@cardstack/host/helpers/consume-context';

import { urlForRealmLookup } from '@cardstack/host/lib/utils';

import MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';

import type {
  CardDef,
  FieldDef,
  Format,
} from 'https://cardstack.com/base/card-api';

import CardError from '../../card-error';
import FormatChooser from '../format-chooser';

import PlaygroundPreview from './playground-preview';
import SpecSearch from './spec-search';

interface Signature {
  Args: {
    makeCardResource: () => void;
    moduleId: string;
    codeRef: ResolvedCodeRef;
    createNew: () => void;
    createNewIsRunning: boolean;
    isFieldDef?: boolean;
    card?: CardDef;
    field?: FieldDef;
    cardError?: CardErrorJSONAPI;
    cardCreationError?: boolean;
    persistSelections: (
      cardId: string,
      format?: Format,
      fieldIndex?: number,
    ) => void;
    canWriteRealm: boolean;
    format: Format;
    defaultFormat: Format;
    availableRealmURLs: string[];
  };
}

export default class PlaygroundContent extends Component<Signature> {
  <template>
    {{consumeContext @makeCardResource}}
    <section class='playground-panel' data-test-playground-panel>
      <div
        class='playground-panel-content'
        style={{this.styleForPlaygroundContent}}
      >
        {{#let (if @isFieldDef @field @card) as |card|}}
          {{#if this.showError}}
            {{! this is for types--@cardError is always true in this case !}}
            {{#if @cardError}}
              <CardContainer
                class='error-container'
                @displayBoundaries={{true}}
                data-test-error-container
              >
                <CardError
                  @error={{@cardError}}
                  @cardCreationError={{@cardError.meta.isCreationError}}
                  @fileToFixWithAi={{this.fileToFixWithAi}}
                />
              </CardContainer>
            {{/if}}
          {{else if card}}
            <div
              class='preview-area'
              data-test-field-preview-card={{@isFieldDef}}
            >
              <PlaygroundPreview
                @card={{card}}
                @format={{@format}}
                @realmInfo={{this.realmInfo}}
                @contextMenuItems={{this.contextMenuItems}}
                @onEdit={{if this.canEditCard (fn this.setFormat 'edit')}}
                @onFinishEditing={{if
                  (eq @format 'edit')
                  (fn this.setFormat @defaultFormat)
                }}
                @isFieldDef={{@isFieldDef}}
              />
            </div>
            <FormatChooser
              class='format-chooser'
              @formats={{if @isFieldDef this.fieldFormats}}
              @format={{@format}}
              @setFormat={{this.setFormat}}
              data-test-playground-format-chooser
            />
          {{else if @createNewIsRunning}}
            <LoadingIndicator @color='var(--boxel-light)' />
          {{else if this.maybeGenerateFieldSpec}}
            <SpecSearch
              @query={{this.specQuery}}
              @realms={{@availableRealmURLs}}
              @canWriteRealm={{@canWriteRealm}}
              @createNewCard={{@createNew}}
            />
          {{/if}}
        {{/let}}
      </div>
    </section>

    <style scoped>
      .playground-panel-content {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        min-height: 100%;
        margin-inline: auto;
      }
      .preview-area {
        flex-grow: 1;
        z-index: 0;
        display: flex;
        flex-direction: column;
      }
      .format-chooser {
        position: sticky;
        bottom: 0;
        margin-top: auto;

        --boxel-format-chooser-button-bg-color: var(--boxel-light);
        --boxel-format-chooser-button-width: 85px;
        --boxel-format-chooser-button-min-width: 85px;
      }
      .playground-panel {
        position: relative;
        background-image: url('./playground-background.png');
        background-position: left top;
        background-repeat: repeat;
        background-size: 22.5px;
        height: 100%;
        width: 100%;
        padding: var(--boxel-sp);
        background-color: var(--boxel-dark);
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        overflow: auto;
      }
      .error-container {
        flex-grow: 1;
        display: grid;
        grid-template-rows: max-content;
        margin-left: calc(-1 * var(--boxel-sp));
        width: calc(100% + calc(2 * var(--boxel-sp)));
      }
    </style>
  </template>

  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;
  @service private declare matrixService: MatrixService;

  private fieldFormats: Format[] = ['embedded', 'fitted', 'atom', 'edit'];

  private get specQuery(): Query {
    return {
      filter: {
        on: specRef,
        eq: { ref: this.args.codeRef },
      },
      sort: [
        {
          by: 'lastModified',
          direction: 'desc',
        },
      ],
    };
  }

  private get maybeGenerateFieldSpec() {
    return this.args.isFieldDef && !this.args.card;
  }

  private copyToClipboard = task(async (id: string) => {
    await navigator.clipboard.writeText(id);
  });

  private openInInteractMode = (id: string) => {
    this.operatorModeStateService.openCardInInteractMode(
      id,
      this.args.format === 'edit' ? 'edit' : 'isolated',
    );
  };

  private get showError() {
    // in edit format, prefer showing the stale card if possible so user can
    // attempt to fix the card error
    if (this.args.cardError && this.args.format === 'edit' && this.args.card) {
      return false;
    }
    return Boolean(this.args.cardError);
  }

  private get contextMenuItems() {
    if (!this.args.card?.id) {
      return undefined;
    }
    let cardId = this.args.card.id;
    let menuItems: MenuItem[] = [
      new MenuItem('Copy Card URL', 'action', {
        action: () => this.copyToClipboard.perform(cardId),
        icon: IconLink,
      }),
      new MenuItem('Open in Code Mode', 'action', {
        action: () =>
          this.operatorModeStateService.updateCodePath(new URL(cardId)),
        icon: IconCode,
      }),
      new MenuItem('Open in Interact Mode', 'action', {
        action: () => this.openInInteractMode(cardId),
        icon: Eye,
      }),
    ];
    return menuItems;
  }

  @action private setFormat(format: Format) {
    if (!this.args.card?.id) {
      return;
    }
    this.args.persistSelections(this.args.card.id, format);
  }

  private get realmInfo() {
    let url = this.args.card ? urlForRealmLookup(this.args.card) : undefined;
    if (!url) {
      return undefined;
    }
    return this.realm.info(url);
  }

  private get canEditCard() {
    return Boolean(
      this.args.format !== 'edit' &&
        this.args.card?.id &&
        this.realm.canWrite(this.args.card.id),
    );
  }

  private get isWideFormat() {
    if (!this.args.card) {
      return false;
    }
    let { constructor } = this.args.card;
    return Boolean(
      constructor &&
        'prefersWideFormat' in constructor &&
        constructor.prefersWideFormat,
    );
  }

  private get styleForPlaygroundContent(): SafeString {
    const maxWidth =
      this.args.format !== 'isolated' || this.isWideFormat ? '100%' : '50rem';
    return htmlSafe(`max-width: ${maxWidth};`);
  }

  private get fileToFixWithAi() {
    let codePath = this.operatorModeStateService.state.codePath?.href;
    if (!codePath) return undefined;

    return this.matrixService.fileAPI.createFileDef({
      sourceUrl: codePath,
      name: codePath.split('/').pop(),
    });
  }
}
