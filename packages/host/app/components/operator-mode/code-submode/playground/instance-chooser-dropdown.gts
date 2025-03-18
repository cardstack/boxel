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

import type { CardDef } from 'https://cardstack.com/base/card-api';

import PrerenderedCardSearch, {
  type PrerenderedCard,
} from '../../../prerendered-card-search';

import type { FieldOption } from './playground-content';

const getItemTitle = (selection: { card?: CardDef; fieldIndex?: number }) => {
  let { card, fieldIndex } = selection;
  if (!card) {
    return;
  }
  let title = card.title ?? `Untitled ${cardTypeDisplayName(card)}`;
  if (fieldIndex === undefined) {
    return title;
  }
  return `${title} - Example ${fieldIndex + 1}`;
};

const SelectedItem: TemplateOnlyComponent<{ Args: { title?: string } }> =
  <template>
    <div class='selected-item'>
      Instance:
      <span class='title' data-test-selected-item>
        {{@title}}
      </span>
    </div>
    <style scoped>
      .selected-item {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        overflow: hidden;
        font: 600 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .title {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }
    </style>
  </template>;

const BeforeOptions: TemplateOnlyComponent = <template>
  <div class='before-options'>
    <span class='title'>
      Recent
    </span>
  </div>
  <style scoped>
    .before-options {
      width: 100%;
      background-color: var(--boxel-light);
      padding: var(--boxel-sp-xs) calc(var(--boxel-sp-xxs) + var(--boxel-sp-xs))
        0 calc(var(--boxel-sp-xxs) + var(--boxel-sp-xs));
    }
    .title {
      font: 600 var(--boxel-font-sm);
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
        Create new instance
      </button>
    {{/if}}
    <button
      class='action'
      {{on 'click' @chooseCard}}
      data-test-choose-another-instance
    >
      <Folder width='16px' height='16px' />
      Choose another instance
    </button>
  </div>
  <style scoped>
    .after-options {
      display: flex;
      flex-direction: column;
      border-top: var(--boxel-border);
      background-color: var(--boxel-light);
      padding: var(--boxel-sp-xs);
      gap: var(--boxel-sp-xxs);
    }
    .title {
      font: 600 var(--boxel-font-sm);
      padding: 0 var(--boxel-sp-xxs);
    }
    .action {
      display: flex;
      align-items: center;
      font: 500 var(--boxel-font-sm);
      border: none;
      background-color: transparent;
      gap: var(--boxel-sp-xs);
      padding: var(--boxel-sp-xs);
      border-radius: var(--boxel-border-radius);
    }
    .action:hover {
      background-color: var(--boxel-100);
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
    selection: { card: CardDef; fieldIndex?: number } | undefined;
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
          @selectedItemComponent={{if
            @selection
            (component SelectedItem title=(getItemTitle @selection))
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
  {{else if @fieldOptions}}
    <BoxelSelect
      class='instance-chooser'
      @dropdownClass='instances-dropdown-content'
      @options={{@fieldOptions}}
      @selected={{findSelected @selection undefined @fieldOptions}}
      @selectedItemComponent={{if
        @selection
        (component SelectedItem title=(getItemTitle @selection))
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
      data-test-field-instance-chooser
      as |item|
    >
      <div class='field-option'>
        {{item.displayIndex}}.
        <CardContainer class='field' @displayBoundaries={{true}}>
          <Preview @card={{item.field}} @format='fitted' />
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
    :deep(
      .boxel-select__dropdown .ember-power-select-option[aria-current='true']
    ),
    :deep(.instances-dropdown-content .ember-power-select-option) {
      background-color: var(--boxel-light);
    }
    :deep(.ember-power-select-option:hover .card) {
      background-color: var(--boxel-100);
    }
    .field-option {
      display: flex;
      align-items: center;
      gap: var(--boxel-sp-xs);
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
  </style>
</template>;

function findSelected(
  selection: { card: CardDef; fieldIndex?: number } | undefined,
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
