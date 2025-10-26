import { FieldDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import ColorField from 'https://cardstack.com/base/color';
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';

export class VisualElement extends FieldDef {
  static displayName = 'Visual Element';

  @field type = contains(StringField); // 'arrow', 'circle', 'rectangle', 'icon'
  @field x = contains(NumberField);
  @field y = contains(NumberField);
  @field width = contains(NumberField);
  @field height = contains(NumberField);
  @field rotation = contains(NumberField);
  @field opacity = contains(NumberField);
  @field fillColor = contains(ColorField);
  @field strokeColor = contains(ColorField);
  @field strokeWidth = contains(NumberField);
  @field visible = contains(BooleanField);
  @field layer = contains(NumberField);
  @field iconName = contains(StringField); // for icon type elements
}
