import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import {
  Card,
  Field,
  File,
  IconCircle,
  IconGlobe,
  IconHexagon,
} from '../../icons.gts';
import Picker, { type PickerOption } from './index.gts';

export default class PickerUsage extends Component {
  selectAllOption: PickerOption = {
    id: 'select-all',
    name: 'Select All',
    type: 'select-all',
  };
  anyTypeOption: PickerOption = {
    id: 'any-type',
    name: 'Any Type',
    type: 'select-all',
  };
  @tracked selectedRealms: PickerOption[] = [];
  @tracked selectedTypes: PickerOption[] = [];

  @tracked realmOptions: PickerOption[] = [
    this.selectAllOption,
    { id: '1', name: 'Boxel Catalog', icon: IconGlobe },
    { id: '2', name: 'Buffalo Exchange', icon: IconHexagon },
    { id: '3', name: 'Burritos Inc.', icon: IconCircle },
    { id: '4', name: 'Buzzsaw Club', icon: File },
    { id: '5', name: 'Canole Bros.', icon: IconGlobe },
    { id: '6', name: 'Capybara Mania', icon: IconHexagon },
    { id: '7', name: 'Cat Fancy Blog', icon: IconCircle },
  ];

  @tracked typeOptions: PickerOption[] = [
    this.anyTypeOption,
    { id: '1', name: 'Card', icon: Card },
    { id: '2', name: 'Field', icon: Field },
    { id: '3', name: 'Component', icon: File },
    { id: '4', name: 'Template', icon: File },
  ];

  @action
  onRealmChange(selected: PickerOption[]) {
    this.selectedRealms = selected;
  }

  @action
  onTypeChange(selected: PickerOption[]) {
    this.selectedTypes = selected;
  }

  <template>
    <FreestyleUsage @name='Picker'>
      <:description>
        <p>
          Picker is a reusable multi-select component that provides a labeled
          trigger, grouped options (selected first), search functionality, and a
          required "Select All" option.
        </p>
        <p>
          A picker option is a plain object with the shape:
          <code>{ id: string; name: string; icon?: Icon | string; type?:
            'select-all' | 'option'; }</code>. To create a search-all /
          select-all row, set
          <code>type: 'select-all'</code>
          and include it as the first element in your
          <code>@options</code>
          array; the component will keep this option at the top, even when
          searching or when options are re-grouped. The select-all option is
          required: the component throws an error if it is missing.
        </p>
        <p>
          When no selections are provided (<code>@selected</code>
          is empty), the component automatically selects the select-all option
          and calls
          <code>@onChange</code>
          so your state stays in sync.
        </p>
        <p>
          Options can use:
          <code>icon</code>
          as an icon component (e.g.
          <code>IconGlobe</code>), a URL string (rendered as an image), or an
          inline SVG string (rendered via
          <code>addClassToSVG</code>).
        </p>
        <p>
          In consumer code, import the component and its type from
          <code>@cardstack/boxel-ui/components</code>, for example:
          <code>import { Picker, type PickerOption } from
            '@cardstack/boxel-ui/components';</code>
          then define your options and selected values:
          <code>const options: PickerOption[] = [...]; const selected:
            PickerOption[] = [];</code>
          and render something like:
          <code>&lt;Picker @options=&#123;&#123;this.realmOptions&#125;&#125;
            @selected=&#123;&#123;this.selectedRealms&#125;&#125;
            @onChange=&#123;&#123;this.onRealmChange&#125;&#125; @label='Realm'
            /&gt;</code>.
        </p>
        <p>Key features include:</p>
        <ol>
          <li>Labeled trigger with selected items displayed as pills</li>
          <li>Required select-all option with default selection behavior</li>
          <li>Optional search input</li>
          <li>Grouped options (selected items appear first, then unselected)</li>
          <li>Option rows with checkbox, optional icon, and text</li>
          <li>Support for both Icon components and string URLs for icons</li>
        </ol>
      </:description>
      <:example>
        <div class='picker-usage-examples'>
          <div class='picker-usage-example'>
            <h3>Realm Picker (with icons)</h3>
            <Picker
              @options={{this.realmOptions}}
              @selected={{this.selectedRealms}}
              @onChange={{this.onRealmChange}}
              @label='Realm'
              @placeholder='Select realms'
              @searchPlaceholder='search for a realm'
            />
          </div>

          <div class='picker-usage-example'>
            <h3>Type Picker (no icons)</h3>
            <Picker
              @options={{this.typeOptions}}
              @selected={{this.selectedTypes}}
              @onChange={{this.onTypeChange}}
              @label='Type'
              @placeholder='Select types'
            />
          </div>
        </div>
      </:example>
    </FreestyleUsage>

    <style scoped>
      .picker-usage-examples {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }

      .picker-usage-example {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }

      .picker-usage-example h3 {
        font: var(--boxel-font-lg);
        font-weight: 600;
        margin: 0;
      }
    </style>
  </template>
}
