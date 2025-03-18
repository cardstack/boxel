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

import type { CardDef } from 'https://cardstack.com/base/card-api';

import PrerenderedCardSearch, {
  type PrerenderedCard,
} from '../../../prerendered-card-search';

const getItemTitle = (item: CardDef) => {
  if (!item) {
    return;
  }
  return item.title ?? `Untitled ${cardTypeDisplayName(item)}`;
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
    query: Query;
    realms: string[];
    card: CardDef | undefined;
    onSelect: (card: PrerenderedCard) => void;
    chooseCard: () => void;
    createNew?: () => void;
    createNewIsRunning?: boolean;
  };
}

const InstanceSelectDropdown: TemplateOnlyComponent<Signature> = <template>
  <PrerenderedCardSearch @query={{@query}} @format='fitted' @realms={{@realms}}>
    <:loading>
      <LoadingIndicator class='loading-icon' @color='var(--boxel-light)' />
    </:loading>
    <:response as |cards|>
      <BoxelSelect
        class='instance-chooser'
        @dropdownClass='instances-dropdown-content'
        @options={{cards}}
        @selected={{@card}}
        @selectedItemComponent={{if
          @card
          (component SelectedItem title=(getItemTitle @card))
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
    .card {
      height: 75px;
      width: 375px;
      max-width: 100%;
      container-name: fitted-card;
      container-type: size;
      background-color: var(--boxel-light);
    }
  </style>
</template>;

export default InstanceSelectDropdown;
