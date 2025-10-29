import type { TemplateOnlyComponent } from '@ember/component/template-only';
import Component from '@glimmer/component';

import {
  BoxelSelect,
  CardContainer,
  Menu,
} from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';

import {
  cardTypeDisplayName,
  type Format,
  type PrerenderedCardLike,
} from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';

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
    menuItems: MenuItem[];
    closeMenu?: () => void;
  };
}
const AfterOptions: TemplateOnlyComponent<AfterOptionsSignature> = <template>
  <div class='after-options'>
    <span class='title'>
      Action
    </span>
    <Menu
      class='after-options-menu'
      @items={{@menuItems}}
      @closeMenu={{@closeMenu}}
    />
  </div>
  <style scoped>
    .after-options {
      --boxel-loading-indicator-size: var(--boxel-icon-xs);
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
    .after-options-menu {
      --boxel-menu-item-content-padding: var(--boxel-sp-xs);
    }
    :deep(.boxel-menu__item) {
      border-radius: var(--boxel-border-radius-sm);
    }
    :deep(.boxel-menu__item .menu-item) {
      width: 100%;
    }
    :deep(.boxel-menu__item .ai-icon) {
      order: 1;
      margin-left: auto;
    }
    :deep(.boxel-menu__item .check-icon) {
      display: none;
    }
  </style>
</template>;

interface Signature {
  Args: {
    isFieldDef: boolean;
    cardOptions: PrerenderedCardLike[] | undefined;
    fieldOptions?: FieldOption[];
    findSelectedCard: (
      cards?: PrerenderedCardLike[],
    ) => PrerenderedCardLike | SelectedInstance | undefined;
    selection: SelectedInstance | undefined;
    onSelect: (item: PrerenderedCardLike | FieldOption) => void;
    moduleId: string;
    persistSelections?: (cardId: string, format: Format) => void;
    recentCardIds: string[];
    afterMenuOptions: MenuItem[];
  };
}

interface OptionsDropdownSignature {
  Args: {
    isField?: boolean;
    options: PrerenderedCardLike[] | FieldOption[] | undefined;
    selected?: PrerenderedCardLike | FieldOption | SelectedInstance;
    selection: SelectedInstance | undefined;
    onSelect: (item: PrerenderedCardLike | FieldOption) => void;
    afterMenuOptions: MenuItem[];
  };
}

function closeInstanceChooser() {
  (
    document.querySelector(
      '[data-playground-instance-chooser][aria-expanded="true"]',
    ) as BoxelSelect | null
  )?.click();
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
      @placeholder='Select {{if @isField "field" "card"}} instance'
      @beforeOptionsComponent={{component BeforeOptions}}
      @afterOptionsComponent={{component
        AfterOptions
        menuItems=@afterMenuOptions
        closeMenu=closeInstanceChooser
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
        height: var(
          --boxel-instance-chooser-height,
          var(--boxel-form-control-height)
        );
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
        --boxel-select-max-height: fit-content;
        --boxel-select-options-list-max-height: 12.25rem;
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
    {{#if @isFieldDef}}
      <OptionsDropdown
        @isField={{true}}
        @options={{@fieldOptions}}
        @selected={{this.findSelectedField @fieldOptions}}
        @selection={{@selection}}
        @onSelect={{@onSelect}}
        @afterMenuOptions={{@afterMenuOptions}}
      />
    {{else}}
      <OptionsDropdown
        @options={{@cardOptions}}
        @selected={{@findSelectedCard @cardOptions}}
        @selection={{@selection}}
        @onSelect={{@onSelect}}
        @afterMenuOptions={{@afterMenuOptions}}
      />
    {{/if}}
  </template>

  private findSelectedField = (fields?: FieldOption[]) => {
    if (!fields?.length || !this.args.selection) {
      return;
    }
    let selection = this.args.selection;
    return fields.find((f) => f.index === selection.fieldIndex);
  };
}
