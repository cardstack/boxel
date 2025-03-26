import { fn } from '@ember/helper';
import { action } from '@ember/object';

import { service } from '@ember/service';

import Component from '@glimmer/component';

import { task } from 'ember-concurrency';

import { consume } from 'ember-provide-consume-context';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';
import { eq, MenuItem } from '@cardstack/boxel-ui/helpers';
import { Eye, IconCode, IconLink } from '@cardstack/boxel-ui/icons';

import {
  GetCardContextName,
  type getCard,
  type Query,
  type ResolvedCodeRef,
  specRef,
} from '@cardstack/runtime-common';

import type CardService from '@cardstack/host/services/card-service';
import type LoaderService from '@cardstack/host/services/loader-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import { CardDef, FieldDef, Format } from 'https://cardstack.com/base/card-api';

import FormatChooser from '../format-chooser';

import PlaygroundPreview from './playground-preview';
import SpecSearch from './spec-search';

export type FieldOption = {
  index: number;
  displayIndex: number;
  field: FieldDef;
};

export type SelectedInstance = {
  card: CardDef;
  fieldIndex: number | undefined;
};

interface Signature {
  Args: {
    moduleId: string;
    codeRef: ResolvedCodeRef;
    createNew: () => void;
    createNewIsRunning: boolean;
    isFieldDef?: boolean;
    card?: CardDef;
    field?: FieldDef;
  };
}

export default class PlaygroundContent extends Component<Signature> {
  <template>
    <section class='playground-panel' data-test-playground-panel>
      <div class='playground-panel-content'>
        {{#let (if @isFieldDef @field @card) as |card|}}
          {{#if card}}
            <div
              class='preview-area'
              data-test-field-preview-card={{@isFieldDef}}
            >
              <PlaygroundPreview
                @card={{card}}
                @format={{this.format}}
                @realmInfo={{this.realmInfo}}
                @contextMenuItems={{this.contextMenuItems}}
                @onEdit={{if this.canEditCard (fn this.setFormat 'edit')}}
                @onFinishEditing={{if
                  (eq this.format 'edit')
                  (fn this.setFormat this.defaultFormat)
                }}
                @isFieldDef={{@isFieldDef}}
              />
            </div>
            <FormatChooser
              class='format-chooser'
              @formats={{if @isFieldDef this.fieldFormats}}
              @format={{this.format}}
              @setFormat={{this.setFormat}}
              data-test-playground-format-chooser
            />
          {{else if @createNewIsRunning}}
            <LoadingIndicator @color='var(--boxel-light)' />
          {{else if this.maybeGenerateFieldSpec}}
            <SpecSearch
              @query={{this.specQuery}}
              @realms={{this.realmServer.availableRealmURLs}}
              @canWriteRealm={{this.canWriteRealm}}
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
    </style>
  </template>

  @consume(GetCardContextName) private declare getCard: getCard;

  @service private declare cardService: CardService;
  @service private declare loaderService: LoaderService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;
  @service private declare realmServer: RealmServerService;
  @service private declare recentFilesService: RecentFilesService;
  @service private declare playgroundPanelService: PlaygroundPanelService;

  private fieldFormats: Format[] = ['embedded', 'fitted', 'atom', 'edit'];

  private get specQuery(): Query {
    return {
      filter: {
        on: specRef,
        eq: { ref: this.args.codeRef },
      },
    };
  }

  private get maybeGenerateFieldSpec() {
    return this.args.isFieldDef && !this.args.card;
  }

  private get defaultFormat() {
    return this.args.isFieldDef ? 'embedded' : 'isolated';
  }

  private get format(): Format {
    return (
      this.playgroundPanelService.getSelection(this.args.moduleId)?.format ??
      this.defaultFormat
    );
  }

  private get fieldIndex(): number | undefined {
    let index = this.playgroundPanelService.getSelection(
      this.args.moduleId,
    )?.fieldIndex;
    if (index !== undefined && index >= 0) {
      return index;
    }
    return this.args.isFieldDef ? 0 : undefined;
  }

  private copyToClipboard = task(async (id: string) => {
    await navigator.clipboard.writeText(id);
  });

  private openInInteractMode = (id: string) => {
    this.operatorModeStateService.openCardInInteractMode(
      id,
      this.format === 'edit' ? 'edit' : 'isolated',
    );
  };

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
        action: () => this.openInInteractMode,
        icon: Eye,
      }),
    ];
    return menuItems;
  }

  private persistSelections = (
    selectedCardId: string,
    selectedFormat = this.format,
    index = this.fieldIndex,
  ) => {
    let selection = this.playgroundPanelService.getSelection(
      this.args.moduleId,
    );
    if (selection?.cardId) {
      let { cardId, format, fieldIndex } = selection;
      if (
        cardId === selectedCardId &&
        format === selectedFormat &&
        fieldIndex === index
      ) {
        return;
      }
    }
    this.playgroundPanelService.persistSelections(
      this.args.moduleId,
      selectedCardId,
      selectedFormat,
      index,
    );
  };

  @action private setFormat(format: Format) {
    if (!this.args.card?.id) {
      return;
    }
    this.persistSelections(this.args.card.id, format);
  }

  private get realmInfo() {
    if (!this.args.card?.id) {
      return undefined;
    }
    return this.realm.info(this.args.card.id);
  }

  private get canEditCard() {
    return Boolean(
      this.format !== 'edit' &&
        this.args.card?.id &&
        this.realm.canWrite(this.args.card.id),
    );
  }

  private get canWriteRealm() {
    return this.realm.canWrite(this.operatorModeStateService.realmURL.href);
  }
}
