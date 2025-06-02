import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import Folder from '@cardstack/boxel-icons/folder';

import {
  Button,
  LoadingIndicator,
  BoxelSelect,
  CardContainer,
} from '@cardstack/boxel-ui/components';
import { IconPlusThin } from '@cardstack/boxel-ui/icons';

import {
  cardTypeDisplayName,
  type Format,
  type PrerenderedCardLike,
} from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';

import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import type { FieldOption, SelectedInstance } from './playground-panel';

const getItemTitle = (selection: SelectedInstance | undefined) => {
  if (!selection) {
    return;
  }
  let { card, fieldIndex } = selection;
  let title = card.title ?? `Untitled ${cardTypeDisplayName(card)}`;
  if (fieldIndex === undefined) {
    return title;
  }
  return `${title} - Example ${fieldIndex + 1}`;
};

const SelectedItem: TemplateOnlyComponent<{ Args: { title?: string } }> =
  <template>
    <div class='selected-item' data-test-selected-item>
      <span class='label'>Instance:</span>
      <span class='item'>{{@title}}</span>
    </div>
    <style scoped>
      .selected-item {
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .label {
        font-weight: 600;
        margin-right: var(--boxel-sp-xxs);
      }
    </style>
  </template>;

const BeforeOptions: TemplateOnlyComponent = <template>
  <div class='before-options'>
    Recent
  </div>
  <style scoped>
    .before-options {
      width: 100%;
      background-color: var(--boxel-light);
      padding: var(--boxel-sp-xs) var(--boxel-sp);
      font: 500 var(--boxel-font-sm);
      letter-spacing: var(--boxel-lsp-xs);
      text-align: left;
    }
  </style>
</template>;

interface AfterOptionsSignature {
  Args: {
    chooseCard: () => void;
    createNew?: () => void;
    createNewIsRunning?: boolean;
    generateSampleData?: (card?: CardDef) => void;
    selectedCard?: CardDef;
  };
}
const AfterOptions: TemplateOnlyComponent<AfterOptionsSignature> = <template>
  <div class='after-options'>
    <span class='title'>
      Action
    </span>
    {{#if @createNew}}
      <Button
        @kind='text-only'
        class='action'
        {{on 'click' @createNew}}
        data-test-create-instance
      >
        {{#if @createNewIsRunning}}
          <LoadingIndicator class='action-running' />
        {{else}}
          <IconPlusThin width='16px' height='16px' />
        {{/if}}
        <span>Create new instance</span>
      </Button>
    {{/if}}
    {{#if @generateSampleData}}
      <Button
        @kind='text-only'
        class='action'
        {{on 'click' (fn @generateSampleData @selectedCard)}}
        data-test-generate-sample-data
      >
        <span class='ai-icon' />
        <span>Generate sample with AI</span>
      </Button>
    {{/if}}
    <Button
      @kind='text-only'
      class='action'
      {{on 'click' @chooseCard}}
      data-test-choose-another-instance
    >
      <Folder width='16px' height='16px' />
      <span>Choose another instance</span>
    </Button>
  </div>
  <style scoped>
    .after-options {
      display: flex;
      flex-direction: column;
      border-top: var(--boxel-border);
      background-color: var(--boxel-light);
    }
    .title {
      padding: var(--boxel-sp-xs) var(--boxel-sp);
      font: 500 var(--boxel-font-sm);
      letter-spacing: var(--boxel-lsp-xs);
      text-align: left;
    }
    .action {
      display: inline-block;
      font: 500 var(--boxel-font-sm);
      border: none;
      height: var(--boxel-form-control-height);
      padding: var(--boxel-sp-xs) var(--boxel-sp);
      border-radius: var(--boxel-border-radius);
      text-align: left;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
      transition: background-color var(--boxel-transition);
    }
    .action:hover {
      background-color: var(--boxel-100);
    }
    .action > span:not(.ai-icon) {
      margin-left: var(--boxel-sp-xxs);
    }
    .action > * {
      vertical-align: middle;
    }
    .action-running {
      --boxel-loading-indicator-size: var(var(--boxel-icon-xs));
    }
    .ai-icon {
      display: inline-block;
      width: var(--boxel-icon-xs);
      height: var(--boxel-icon-xs);
      background-image: image-set(
        url('../../../ai-assistant/ai-assist-icon-bw.png') 1x,
        url('../../../ai-assistant/ai-assist-icon-bw@2x.png') 2x,
        url('../../../ai-assistant/ai-assist-icon-bw@3x.png')
      );
      background-position: left center;
      background-repeat: no-repeat;
      background-size: contain;
    }
  </style>
</template>;

interface Signature {
  Args: {
    cardOptions: PrerenderedCardLike[] | undefined;
    fieldOptions?: FieldOption[];
    findSelectedCard: (
      cards?: PrerenderedCardLike[],
    ) => PrerenderedCardLike | SelectedInstance | undefined;
    selection: SelectedInstance | undefined;
    onSelect: (item: PrerenderedCardLike | FieldOption) => void;
    chooseCard: () => void;
    createNew?: () => void;
    createNewIsRunning?: boolean;
    generateSampleData?: (card?: CardDef) => void;
    moduleId: string;
    persistSelections?: (cardId: string, format: Format) => void;
    recentCardIds: string[];
  };
}

interface OptionsDropdownSignature {
  Args: {
    isField?: boolean;
    options: PrerenderedCardLike[] | FieldOption[] | undefined;
    selected?: PrerenderedCardLike | FieldOption | SelectedInstance;
    selection: SelectedInstance | undefined;
    onSelect: (item: PrerenderedCardLike | FieldOption) => void;
    chooseCard: () => void;
    createNew?: () => void;
    createNewIsRunning?: boolean;
    generateSampleData?: (card?: CardDef) => void;
  };
}

export const OptionsDropdown: TemplateOnlyComponent<OptionsDropdownSignature> =
  <template>
    <BoxelSelect
      class='instance-chooser'
      @dropdownClass='instances-dropdown-content'
      @options={{@options}}
      @selected={{@selected}}
      @selectedItemComponent={{component
        SelectedItem
        title=(getItemTitle @selection)
      }}
      @renderInPlace={{true}}
      @onChange={{@onSelect}}
      @placeholder='Please Select'
      @beforeOptionsComponent={{component BeforeOptions}}
      @afterOptionsComponent={{component
        AfterOptions
        chooseCard=@chooseCard
        createNew=@createNew
        createNewIsRunning=@createNewIsRunning
        generateSampleData=@generateSampleData
        selectedCard=@selection.card
      }}
      @verticalPosition='above'
      data-playground-instance-chooser
      data-test-instance-chooser
      as |item|
    >
      {{#if @isField}}
        <CardContainer class='field' @displayBoundaries={{true}}>
          <CardRenderer @card={{item.field}} @format='atom' />
        </CardContainer>
      {{else}}
        <CardContainer class='card' @displayBoundaries={{true}}>
          <item.component />
        </CardContainer>
      {{/if}}
    </BoxelSelect>
    <style scoped>
      .instance-chooser {
        height: 26px;
        border: 1px solid var(--boxel-dark);
        outline: none;
      }

      .instance-chooser :deep(.boxel-trigger) {
        padding: var(--boxel-sp-sm);
      }

      .instance-chooser :deep(.boxel-trigger-content) {
        font: var(--boxel-font-xs);
        overflow: hidden;
      }
      .instance-chooser :deep(.boxel-loading-indicator) {
        --boxel-loading-indicator-size: var(--boxel-icon-xs);
      }

      :deep(
        .boxel-select__dropdown .ember-power-select-option[aria-current='true']
      ),
      :deep(.instances-dropdown-content .ember-power-select-option) {
        background-color: var(--boxel-light);
        flex-wrap: nowrap;
      }

      .instance-chooser
        + :deep(
          .ember-basic-dropdown-content-wormhole-origin
            .instances-dropdown-content
        ) {
        border: 1px solid var(--boxel-450);
        border-radius: var(--boxel-border-radius);
      }

      :deep(.ember-basic-dropdown) {
        width: 100%;
      }

      :deep(.ember-power-select-option:hover .card) {
        background-color: var(--boxel-100);
      }
      .card,
      .field {
        height: 40px;
        width: 375px;
        max-width: 100%;
        container-name: fitted-card;
        container-type: size;
        background-color: var(--boxel-light);
      }
      .field {
        padding: var(--boxel-sp-xs);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
  </template>;

export default class InstanceSelectDropdown extends Component<Signature> {
  <template>
    {{#if @cardOptions}}
      <OptionsDropdown
        @options={{@cardOptions}}
        @selected={{@findSelectedCard @cardOptions}}
        @selection={{@selection}}
        @onSelect={{@onSelect}}
        @chooseCard={{@chooseCard}}
        @createNew={{@createNew}}
        @createNewIsRunning={{@createNewIsRunning}}
        @generateSampleData={{@generateSampleData}}
      />
    {{else}}
      <OptionsDropdown
        @isField={{true}}
        @options={{@fieldOptions}}
        @selected={{this.findSelectedField @fieldOptions}}
        @selection={{@selection}}
        @onSelect={{@onSelect}}
        @chooseCard={{@chooseCard}}
        @createNew={{@createNew}}
        @createNewIsRunning={{@createNewIsRunning}}
        @generateSampleData={{@generateSampleData}}
      />
    {{/if}}

    <style scoped>
      .loading-icon {
        height: var(--boxel-form-control-height);
      }
    </style>
  </template>

  @service private declare playgroundPanelService: PlaygroundPanelService;
  @service private declare recentFilesService: RecentFilesService;

  private findSelectedField = (fields?: FieldOption[]) => {
    if (!fields?.length || !this.args.selection) {
      return;
    }
    let selection = this.args.selection;
    return fields.find((f) => f.index === selection.fieldIndex);
  };
}
