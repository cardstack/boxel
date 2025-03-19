import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import Folder from '@cardstack/boxel-icons/folder';

import {
  LoadingIndicator,
  BoxelSelect,
  CardContainer,
} from '@cardstack/boxel-ui/components';
import { IconPlusThin } from '@cardstack/boxel-ui/icons';

import { cardTypeDisplayName, type Query } from '@cardstack/runtime-common';

import Preview from '@cardstack/host/components/preview';

import PrerenderedCardSearch, {
  type PrerenderedCard,
} from '../../../prerendered-card-search';

import type { FieldOption, SelectedInstance } from './playground-content';

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
  };
}

const InstanceSelectDropdown: TemplateOnlyComponent<Signature> = <template>
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
          @selected={{findSelected @selection cards}}
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
      @selected={{findSelected @selection undefined @fieldOptions}}
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
      <div class='field-option'>
        <span class='field-option-index'>{{item.displayIndex}}.</span>
        <CardContainer class='field' @displayBoundaries={{true}}>
          <Preview @card={{item.field}} @format='atom' />
        </CardContainer>
      </div>
    </BoxelSelect>
  {{/if}}

  <style scoped>
    .loading-icon {
      height: var(--boxel-form-control-height);
    }
    .instance-chooser {
      width: 405px;
      max-width: 100%;
      height: var(--boxel-form-control-height);
      box-shadow: 0 5px 10px 0 rgba(0 0 0 / 40%);
    }
    .instance-chooser :deep(.boxel-trigger-content) {
      overflow: hidden;
    }
    .field-option {
      display: flex;
      align-items: center;
      gap: var(--boxel-sp-xs);
      width: 375px;
      max-width: 100%;
    }
    .field-option-index {
      width: var(--boxel-sp);
      text-align: center;
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

function findSelected(
  selection: SelectedInstance | undefined,
  cards: PrerenderedCard[] | undefined,
  fields?: FieldOption[],
) {
  if (!selection || !selection.card) {
    return;
  }
  if (cards) {
    return cards.find(
      (c) => c.url.replace(/\.json$/, '') === selection.card.id,
    );
  } else if (fields) {
    return fields.find((f) => f.index === selection.fieldIndex);
  }
  return;
}

export default InstanceSelectDropdown;
