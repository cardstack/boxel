import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import ToElsewhere from 'ember-elsewhere/components/to-elsewhere';

import { cardTypeDisplayName } from '@cardstack/runtime-common';

import type { Query } from '@cardstack/runtime-common';

import consumeContext from '@cardstack/host/modifiers/consume-context';

import type { FieldDef } from 'https://cardstack.com/base/card-api';

import FieldPickerModal from './field-chooser-modal';

import InstanceSelectDropdown from './instance-chooser-dropdown';

import type { FieldOption, SelectedInstance } from './playground-content';
import type { PrerenderedCard } from '../../../prerendered-card-search';

interface Signature {
  Args: {
    makeCardResource: () => void;
    query: Query | undefined;
    recentRealms: string[];
    fieldOptions: FieldOption[] | undefined;
    selection: SelectedInstance | undefined;
    onSelect: (item: PrerenderedCard | FieldOption) => void;
    chooseCard: () => void;
    chooseField: (index: number) => void;
    createNew: () => void;
    createNewIsRunning: boolean;
    canWriteRealm: boolean;
    field?: FieldDef;
    onFieldSelect: (index: number) => void;
    closeFieldChooser: () => void;
    fieldChooserIsOpen: boolean;
  };
}

export default class PlaygroundTitle extends Component<Signature> {
  @action
  handleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }

  <template>
    <div class='playground-title' {{consumeContext consume=@makeCardResource}}>
      <span>Playground</span>
      <button
        class='instance-chooser-container'
        {{on 'click' this.handleClick}}
        {{on 'mouseup' this.handleClick}}
      >
        <InstanceSelectDropdown
          @prerenderedCardQuery={{hash query=@query realms=@recentRealms}}
          @fieldOptions={{@fieldOptions}}
          @selection={{@selection}}
          @onSelect={{@onSelect}}
          @chooseCard={{@chooseCard}}
          @createNew={{if @canWriteRealm @createNew}}
          @createNewIsRunning={{@createNewIsRunning}}
        />
      </button>
    </div>

    {{#if @fieldChooserIsOpen}}
      <ToElsewhere
        @named='playground-field-picker'
        @send={{component
          FieldPickerModal
          instances=@fieldOptions
          selectedIndex=@selection.fieldIndex
          onSelect=@chooseField
          onClose=@closeFieldChooser
          name=(if @field (cardTypeDisplayName @field))
        }}
      />
    {{/if}}

    <style scoped>
      .playground-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        gap: var(--boxel-sp-xxl);
      }
      .instance-chooser-container {
        display: flex;
        justify-content: end;
        background: none;
        border: none;
        cursor: auto;
        width: 271px;
      }
      .instance-chooser-container > :deep(.ember-basic-dropdown) {
        max-width: 100%;
      }
    </style>
  </template>
}
