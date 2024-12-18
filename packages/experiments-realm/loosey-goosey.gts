import {
  FieldDef,
  field,
  contains,
  StringField,
  Component,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import type IconComponent from '@cardstack/boxel-icons/captions';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { BoxelSelect } from '@cardstack/boxel-ui/components';

export interface LooseyGooseyData {
  index: number;
  label: string;
  color?: string;
  colorScheme?: {
    foregroundColor?: string | null;
    backgroundColor?: string | null;
  };
  icon?: typeof IconComponent;
}

class ColorScheme extends FieldDef {
  @field foregroundColor = contains(StringField);
  @field backgroundColor = contains(StringField);
}

class LooseyGooseyEditTemplate extends Component<typeof LooseGooseyField> {
  @tracked label: string | undefined = this.args.model.label;

  get statuses() {
    if (!this.args.model) {
      return [];
    }
    return (this.args.model.constructor as any).values as LooseyGooseyData[];
  }
  get selectedStatus() {
    return this.statuses.find((status) => {
      return status.label === this.label;
    });
  }

  @action onSelectStatus(status: LooseyGooseyData): void {
    this.label = status.label;
    this.args.model.label = this.selectedStatus?.label;
    this.args.model.index = this.selectedStatus?.index;
    this.args.model.color = this.selectedStatus?.color;
    this.args.model.colorScheme = new ColorScheme({
      foregroundColor: this.selectedStatus?.colorScheme?.foregroundColor,
      backgroundColor: this.selectedStatus?.colorScheme?.backgroundColor,
    });
  }

  get placeholder() {
    return `Fill in ${this.args.model?.constructor?.displayName}`;
  }

  <template>
    <BoxelSelect
      @placeholder={{this.placeholder}}
      @options={{this.statuses}}
      @selected={{this.selectedStatus}}
      @onChange={{this.onSelectStatus}}
      as |item|
    >
      <div> {{item.label}}</div>
    </BoxelSelect>
  </template>
}

export class LooseGooseyField extends FieldDef {
  @field index = contains(NumberField); //sorting order
  @field label = contains(StringField);
  @field color = contains(StringField);
  @field colorScheme = contains(ColorScheme);
  @field title = contains(StringField, {
    computeVia: function (this: LooseGooseyField) {
      return this.label;
    },
  });
  static values: LooseyGooseyData[] = []; //help with the types

  static edit = LooseyGooseyEditTemplate;
}
