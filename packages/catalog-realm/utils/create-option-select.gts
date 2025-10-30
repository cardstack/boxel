import { fn } from '@ember/helper';
import { Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { BoxelSelect, RadioInput } from '@cardstack/boxel-ui/components';

type OptionLike = string | { label: string; value: string };
type OptionSelectConfig = {
  displayName: string; // Field name shown in UI
  options: OptionLike[]; // List of options (strings or {label, value})
  view?: 'boxel-select' | 'radio'; // Determines whether to render as dropdown or radio buttons
  placeholder?: string; // Placeholder text
};

// Store data in StringField
export function createOptionSelectField(config: OptionSelectConfig) {
  const {
    displayName,
    options,
    view = 'boxel-select',
    placeholder = 'Select option',
  } = config;

  return class OptionSelectField extends StringField {
    static displayName = displayName;

    static embedded = class Embedded extends Component<typeof this> {
      <template>
        {{@model}}
      </template>
    };
    static atom = this.embedded;

    static edit = class Edit extends Component<typeof this> {
      // Use arrow function to avoid decorators and preserve `this`
      selectOption = (opt: { label: string; value: string }) => {
        this.args.set(opt.value);
      };

      // Helper function to convert text to title case
      toTitleCase = (str: string) => {
        return str.replace(/\w\S*/g, (txt) => {
          return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        });
      };

      get items() {
        return options.map((o) => {
          if (typeof o === 'string') {
            return { label: this.toTitleCase(o), value: o };
          } else {
            return { label: this.toTitleCase(o.label), value: o.value };
          }
        });
      }

      get isRadio() {
        return view === 'radio';
      }
      get placeholder() {
        return placeholder;
      }
      get selectedItem() {
        return this.items.find((i) => {
          return i.value === this.args.model;
        });
      }

      <template>
        {{#if this.isRadio}}
          <RadioInput
            @name='option-select'
            @groupDescription='Option selection'
            @items={{this.items}}
            @checkedId={{@model}}
            @keyName='value'
            as |item|
          >
            <item.component @onChange={{fn this.selectOption item.data}}>
              {{item.data.label}}
            </item.component>
          </RadioInput>
        {{else}}
          <BoxelSelect
            @placeholder={{this.placeholder}}
            @options={{this.items}}
            @selected={{this.selectedItem}}
            @onChange={{this.selectOption}}
            @searchField='label'
            as |opt|
          >
            {{opt.label}}
          </BoxelSelect>
        {{/if}}
      </template>
    };
  };
}
