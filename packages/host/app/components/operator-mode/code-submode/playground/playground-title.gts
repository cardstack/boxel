import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import ToElsewhere from 'ember-elsewhere/components/to-elsewhere';

import { cardTypeDisplayName } from '@cardstack/runtime-common';

import type { Query } from '@cardstack/runtime-common';

import { consumeContext } from '@cardstack/host/helpers/consume-context';

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
    {{consumeContext @makeCardResource}}
    <div class='playground-title'>
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
        min-width: 0;
        gap: var(--boxel-sp);
      }
      .instance-chooser-container {
        display: flex;
        justify-content: end;
        background: none;
        border: none;
        cursor: auto;
        max-width: 271px;
        min-width: 45px;
        flex: 1;
        padding: 0;
      }
      .instance-chooser-container > :deep(.ember-basic-dropdown) {
        width: 100%;
      }
    </style>
  </template>
}
