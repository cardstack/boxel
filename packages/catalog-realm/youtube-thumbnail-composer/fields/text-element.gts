import { FieldDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import ColorField from 'https://cardstack.com/base/color';
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';

export class TextElement extends FieldDef {
  static displayName = 'Text Element';

  @field content = contains(StringField);
  @field x = contains(NumberField);
  @field y = contains(NumberField);
  @field fontSize = contains(NumberField);
  @field fontFamily = contains(StringField);
  @field fontWeight = contains(StringField);
  @field color = contains(ColorField);
  @field strokeColor = contains(ColorField);
  @field strokeWidth = contains(NumberField);
  @field rotation = contains(NumberField);
  @field opacity = contains(NumberField);
  @field visible = contains(BooleanField);
  @field layer = contains(NumberField);
}
