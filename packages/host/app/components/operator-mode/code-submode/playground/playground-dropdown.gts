import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';

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

const PlaygroundDropdown: TemplateOnlyComponent<Signature> = <template>
  {{consumeContext @makeCardResource}}

  <InstanceSelectDropdown
    @prerenderedCardQuery={{hash query=@query realms=@recentRealms}}
    @fieldOptions={{@fieldOptions}}
    @selection={{@selection}}
    @onSelect={{@onSelect}}
    @chooseCard={{@chooseCard}}
    @createNew={{if @canWriteRealm @createNew}}
    @createNewIsRunning={{@createNewIsRunning}}
  />

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
</template>;

export default PlaygroundDropdown;
