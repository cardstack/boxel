import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import Folder from '@cardstack/boxel-icons/folder';

import {
  LoadingIndicator,
  BoxelSelect,
  CardContainer,
} from '@cardstack/boxel-ui/components';
import { IconPlusThin } from '@cardstack/boxel-ui/icons';

import {
  cardTypeDisplayName,
  trimJsonExtension,
  type Query,
} from '@cardstack/runtime-common';

import Preview from '@cardstack/host/components/preview';

import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';

import PrerenderedCardSearch, {
  type PrerenderedCard,
} from '../../../prerendered-card-search';

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
      {{@title}}
    </div>
    <style scoped>
      .selected-item {
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
  };
}
const AfterOptions: TemplateOnlyComponent<AfterOptionsSignature> = <template>
  <div class='after-options'>
    <span class='title'>
      Action
    </span>
    {{#if @createNew}}
      <button
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
      </button>
    {{/if}}
    <button
      class='action'
      {{on 'click' @chooseCard}}
      data-test-choose-another-instance
    >
      <Folder width='16px' height='16px' />
      <span>Choose another instance</span>
    </button>
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
      background-color: transparent;
      gap: var(--boxel-sp-xs);
      height: var(--boxel-form-control-height);
      padding: var(--boxel-sp-xs);
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
    .action > span {
      margin-left: var(--boxel-sp-xxs);
    }
    .action > * {
      vertical-align: middle;
    }
    .action-running {
      --boxel-loading-indicator-size: 16px;
    }
  </style>
</template>;

interface Signature {
  Args: {
    prerenderedCardQuery?: { query: Query | undefined; realms: string[] };
    fieldOptions?: FieldOption[];
    selection: SelectedInstance | undefined;
    onSelect: (item: PrerenderedCard | FieldOption) => void;
    chooseCard: () => void;
    createNew?: () => void;
    createNewIsRunning?: boolean;
    moduleId: string;
  };
}

export default class InstanceSelectDropdown extends Component<Signature> {
  <template>
    {{#if @prerenderedCardQuery.query}}
      <PrerenderedCardSearch
        @query={{@prerenderedCardQuery.query}}
        @format='fitted'
        @realms={{@prerenderedCardQuery.realms}}
      >
        <:loading>
          <LoadingIndicator class='loading-icon' @color='var(--boxel-light)' />
        </:loading>
        <:response as |cards|>
          <BoxelSelect
            class='instance-chooser'
            @dropdownClass='instances-dropdown-content'
            @options={{cards}}
            @selected={{this.findSelectedCard cards}}
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
            }}
            data-playground-instance-chooser
            data-test-instance-chooser
            as |card|
          >
            <CardContainer class='card' @displayBoundaries={{true}}>
              <card.component />
            </CardContainer>
          </BoxelSelect>
        </:response>
      </PrerenderedCardSearch>
    {{else}}
      <BoxelSelect
        class='instance-chooser'
        @dropdownClass='instances-dropdown-content'
        @options={{@fieldOptions}}
        @selected={{this.findSelectedField @fieldOptions}}
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
        }}
        data-playground-instance-chooser
        data-test-instance-chooser
        as |item|
      >
        <CardContainer class='field' @displayBoundaries={{true}}>
          <Preview @card={{item.field}} @format='atom' />
        </CardContainer>
      </BoxelSelect>
    {{/if}}

    <style scoped>
      .loading-icon {
        height: var(--boxel-form-control-height);
      }
      .instance-chooser {
        height: 26px;
        border: 1px solid var(--boxel-dark);
        outline: none;
      }
      .instance-chooser :deep(.boxel-trigger-content) {
        font: var(--boxel-font-xs);
        overflow: hidden;
      }
      :deep(
        .boxel-select__dropdown .ember-power-select-option[aria-current='true']
      ),
      :deep(.instances-dropdown-content .ember-power-select-option) {
        background-color: var(--boxel-light);
        flex-wrap: nowrap;
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
  </template>

  @service private declare playgroundPanelService: PlaygroundPanelService;

  private findSelectedCard = (prerenderedCards?: PrerenderedCard[]) => {
    if (!prerenderedCards?.length) {
      return;
    }

    if (!this.args.selection?.card) {
      let s = this.playgroundPanelService.peekSelection(this.args.moduleId);
      if (!s) {
        // if there's no selected card, choose the most recent card as selected
        this.playgroundPanelService.persistSelections(
          this.args.moduleId,
          trimJsonExtension(prerenderedCards[0].url),
          'isolated',
          undefined,
        );
      }
      return prerenderedCards[0];
    }

    let selectedCardId = this.args.selection.card.id;
    let card = prerenderedCards.find(
      (c) => trimJsonExtension(c.url) === selectedCardId,
    );
    return card;
  };

  @action private findSelectedField(fields?: FieldOption[]) {
    if (!fields?.length || !this.args.selection) {
      return;
    }
    let selection = this.args.selection;
    return fields.find((f) => f.index === selection.fieldIndex);
  }
}
