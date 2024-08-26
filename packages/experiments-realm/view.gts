import { tracked } from '@glimmer/tracking';
import {
  Component,
  FieldDef,
  StringField,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { action } from '@ember/object';

type SelectedView = 'grid' | 'list' | string;

class Edit extends Component<typeof ViewField> {
  views = ['grid', 'list'];

  @tracked selected: SelectedView =
    this.args.model.displayFormat || 'Select' || this.views[0]; //state for selection

  @action onSelect(selection: SelectedView) {
    this.args.model.displayFormat = selection;
    this.selected = selection;
  }

  <template>
    <BoxelSelect
      @placeholder={{'Select'}}
      @options={{this.views}}
      @onChange={{this.onSelect}}
      @selected={{this.selected}}
      @dropdownClass='boxel-select-usage'
      as |item|
    >
      {{item}}
    </BoxelSelect>
  </template>
}
// this view field controls the toggle to specify the view of the collection
export class ViewField extends FieldDef {
  static displayName = 'Collection View';
  @field displayFormat = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: ViewField) {
      return this.displayFormat;
    },
  });

  static edit = Edit;
}
